/**
 * @fileoverview 예규/심판례 수집 모듈
 * @description 국세법령정보시스템 API를 통해 부동산 세무 관련 유권해석, 예규, 심판례를
 * 자동으로 수집하고 구조화된 데이터로 변환하는 서비스 모듈이다.
 *
 * @requirements 2.1 - 국세법령정보시스템 API 연동하여 예규/심판례 수집
 * @requirements 2.2 - 취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세 카테고리별 수집
 * @requirements 2.3 - 문서번호, 회신일자, 문서 유형, 세목 분류, 질의 요지, 회신 내용, 참조 세법 조항
 * @requirements 2.5 - 30초 고정 간격, 최대 3회 재시도
 * @requirements 2.6 - 최대 재시도 실패 시 SNS 알림 발행
 * @requirements 2.8 - 동일 문서번호 존재 시 신규 저장 생략 (중복 판별)
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../../common/interfaces/index.js';
import { CircuitBreaker } from '../../../common/utils/index.js';
import type { TaxRuling, RulingCollectorOutput, RulingFailedItem } from '../interfaces/index.js';
import type { TaxType } from '../interfaces/index.js';
import { RulingApiClient, RulingApiClientConfig, TARGET_TAX_CATEGORIES } from './ruling-api-client.js';

/**
 * 예규 수집 결과
 */
export interface RulingCollectionResult {
  /** 수집된 예규 목록 */
  rulings: TaxRuling[];
  /** 수집 성공한 카테고리 수 */
  successCount: number;
  /** 수집 실패한 카테고리 수 */
  failureCount: number;
  /** 중복으로 건너뛴 예규 수 */
  skippedDuplicates: number;
  /** 수집 실패 상세 정보 */
  errors: Array<{ category: string; error: string }>;
}

/**
 * SNS 알림 클라이언트 인터페이스
 * 실제 SNS 클라이언트를 주입하여 테스트 가능하도록 인터페이스를 분리한다.
 */
export interface SnsNotifier {
  /** 실패 알림 발행 */
  publishFailureNotification(subject: string, message: string): Promise<void>;
}

/**
 * 기본 SNS 알림 구현 (console.error로 로깅 — 실제 배포 시 AWS SNS로 교체)
 */
class DefaultSnsNotifier implements SnsNotifier {
  async publishFailureNotification(subject: string, message: string): Promise<void> {
    console.error(`[SNS NOTIFICATION] ${subject}: ${message}`);
  }
}

/**
 * 예규/심판례 수집 모듈
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * 국세법령정보시스템 API를 통해 대상 카테고리의 예규/심판례를 수집하고
 * 구조화된 데이터로 변환한다.
 *
 * servicePrefix: 'TAX' — 모든 데이터 키에 TAX# 접두사를 사용한다.
 */
export class RulingCollectorModule implements ServiceModule {
  /** 서비스 접두사 */
  public readonly servicePrefix = 'TAX';

  private apiClient: RulingApiClient | null = null;
  private config: ModuleConfig | null = null;
  private initialized = false;
  private circuitBreaker: CircuitBreaker;
  private snsNotifier: SnsNotifier;

  constructor(snsNotifier?: SnsNotifier) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 60000,
      monitoringWindow: 120000,
    });
    this.snsNotifier = snsNotifier || new DefaultSnsNotifier();
  }

  /**
   * 모듈 초기화
   * API 클라이언트 설정을 구성한다.
   *
   * @param config - 모듈 설정
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const apiClientConfig: Partial<RulingApiClientConfig> = {
      apiKey: (config.config['apiKey'] as string) || '',
      timeoutMs: (config.config['timeoutMs'] as number) || 30000,
    };

    if (config.config['baseUrl']) {
      apiClientConfig.baseUrl = config.config['baseUrl'] as string;
    }

    this.apiClient = new RulingApiClient(apiClientConfig);

    // 기존 문서번호 목록 설정 (중복 판별용)
    const existingDocumentNumbers = config.config['existingDocumentNumbers'] as string[] | undefined;
    if (existingDocumentNumbers) {
      this.apiClient.setExistingDocumentNumbers(existingDocumentNumbers);
    }

    this.initialized = true;
  }

  /**
   * 예규 수집 실행
   * 설정된 대상 세목 카테고리를 순회하며 API에서 예규 데이터를 수집한다.
   * 동일 문서번호가 이미 존재하는 경우 신규 저장을 생략한다.
   * 최대 재시도 후에도 실패하면 SNS 알림을 발행한다.
   *
   * @param input - 모듈 입력 (payload에 targetCategories, dateFrom 선택적 지정)
   * @returns 수집 결과
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.apiClient) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const payload = input.payload as { targetCategories?: string[]; dateFrom?: string } | undefined;
    const categories = payload?.targetCategories || TARGET_TAX_CATEGORIES;
    const dateFrom = payload?.dateFrom;

    const result = await this.collectRulings(categories, dateFrom);

    // 최종 실패 항목이 있으면 SNS 알림 발행
    if (result.failureCount > 0) {
      await this.notifyFailure(result.errors);
    }

    const output: RulingCollectorOutput = {
      collectedCount: result.rulings.length,
      duplicateCount: result.skippedDuplicates,
      failedItems: result.errors.map(err => ({
        itemId: err.category,
        error: err.error,
        retryable: true,
      })),
      lastSyncTimestamp: new Date().toISOString(),
    };

    return {
      success: result.failureCount === 0,
      data: output,
      metadata: {
        servicePrefix: this.servicePrefix,
        totalRulings: String(result.rulings.length),
        successCount: String(result.successCount),
        failureCount: String(result.failureCount),
        skippedDuplicates: String(result.skippedDuplicates),
        collectedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * 모듈 헬스체크
   * API 연결 상태를 확인한다.
   */
  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized || !this.apiClient) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { reason: 'Module not initialized' },
      };
    }

    try {
      // 간단한 목록 조회로 API 연결 상태 확인
      await this.apiClient.fetchRulingList('취득세');
      return {
        status: HealthStatusEnum.HEALTHY,
        lastCheck: new Date().toISOString(),
        details: {
          apiConnected: true,
          circuitBreakerState: this.circuitBreaker.getState(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: {
          apiConnected: false,
          error: errorMessage,
          circuitBreakerState: this.circuitBreaker.getState(),
        },
      };
    }
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'ruling-collector';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 대상 세목 카테고리를 순회하며 예규 수집 수행
   * 개별 카테고리 수집 실패 시 에러를 기록하고 나머지 카테고리 수집을 계속한다.
   *
   * @param categories - 수집할 세목 카테고리 목록 (한글)
   * @param dateFrom - 수집 시작 일자
   * @returns 수집 결과
   */
  private async collectRulings(categories: string[], dateFrom?: string): Promise<RulingCollectionResult> {
    const allRulings: TaxRuling[] = [];
    const errors: Array<{ category: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;
    let skippedDuplicates = 0;

    for (const category of categories) {
      try {
        const { rulings, duplicatesSkipped } = await this.collectByCategory(category, dateFrom);
        allRulings.push(...rulings);
        skippedDuplicates += duplicatesSkipped;
        successCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ category, error: errorMessage });
        failureCount++;
      }
    }

    return {
      rulings: allRulings,
      successCount,
      failureCount,
      skippedDuplicates,
      errors,
    };
  }

  /**
   * 단일 카테고리 예규 수집
   * 목록 조회 → 중복 확인 → 상세 조회 순서로 데이터를 수집한다.
   * CircuitBreaker를 통해 외부 API 장애를 격리한다.
   *
   * @param category - 세목 카테고리 (한글)
   * @param dateFrom - 수집 시작 일자
   * @returns 수집된 예규 목록 및 건너뛴 중복 수
   */
  private async collectByCategory(
    category: string,
    dateFrom?: string
  ): Promise<{ rulings: TaxRuling[]; duplicatesSkipped: number }> {
    if (!this.apiClient) {
      throw new Error('API 클라이언트가 초기화되지 않았습니다.');
    }

    // CircuitBreaker를 통해 API 호출
    const rulingList = await this.circuitBreaker.execute(async () => {
      return this.apiClient!.fetchRulingList(category, dateFrom);
    });

    if (rulingList.length === 0) {
      return { rulings: [], duplicatesSkipped: 0 };
    }

    // 중복 확인 후 상세 조회
    const rulings: TaxRuling[] = [];
    let duplicatesSkipped = 0;

    for (const item of rulingList) {
      // 동일 문서번호 존재 시 신규 저장 생략
      if (this.apiClient.isDuplicate(item.documentNumber)) {
        duplicatesSkipped++;
        continue;
      }

      try {
        const ruling = await this.circuitBreaker.execute(async () => {
          return this.apiClient!.fetchRulingDetail(item.rulingId, category);
        });
        rulings.push(ruling);
      } catch (error) {
        // 개별 예규 상세 조회 실패 시 건너뛰고 계속 진행
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`예규 상세 조회 실패 (rulingId: ${item.rulingId}): ${errorMessage}`);
      }
    }

    return { rulings, duplicatesSkipped };
  }

  /**
   * SNS 실패 알림 발행
   * 최대 재시도 후에도 실패한 예규 수집 항목에 대해 알림을 보낸다.
   *
   * @param errors - 실패 상세 정보
   */
  private async notifyFailure(errors: Array<{ category: string; error: string }>): Promise<void> {
    const subject = `[세무 AI] 예규/심판례 수집 실패 알림 (${errors.length}건)`;
    const message = errors
      .map(err => `- ${err.category}: ${err.error}`)
      .join('\n');

    try {
      await this.snsNotifier.publishFailureNotification(subject, message);
    } catch (notifyError) {
      // SNS 알림 실패는 수집 결과에 영향을 주지 않음
      const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
      console.error(`SNS 알림 발행 실패: ${errorMessage}`);
    }
  }
}
