/**
 * @fileoverview 세법 수집 모듈
 * @description 국가법령정보센터 Open API 및 국세법령정보시스템을 통해 부동산 관련 세법을
 * 자동으로 수집하고 구조화된 데이터로 변환하는 서비스 모듈이다.
 *
 * @requirements 1.1 - 국가법령정보센터 Open API + 국세법령정보시스템 연동
 * @requirements 1.2 - 소득세법, 지방세법, 종합부동산세법, 상속세 및 증여세법, 조세특례제한법
 * @requirements 1.3 - 법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력, 적용 세목, hasRateTable
 * @requirements 1.5 - 5초 초기 간격, 지수 백오프(배수 2), 최대 3회 재시도
 * @requirements 1.6 - 최대 재시도 실패 시 SNS 알림 발행
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
import type { TaxLawArticle, TaxLawCollectorOutput, FailedItem } from '../interfaces/index.js';
import { TaxLawApiClient, TaxLawApiClientConfig, TARGET_TAX_LAWS } from './tax-law-api-client.js';

/**
 * 세법 수집 결과
 */
export interface TaxLawCollectionResult {
  /** 수집된 세법 조문 목록 */
  articles: TaxLawArticle[];
  /** 수집 성공한 세법 수 */
  successCount: number;
  /** 수집 실패한 세법 수 */
  failureCount: number;
  /** 세율 테이블이 포함된 조문 수 */
  rateTablesDetected: number;
  /** 수집 실패 상세 정보 */
  errors: Array<{ lawName: string; error: string }>;
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
 * 세법 수집 모듈
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * 국가법령정보센터 Open API 및 국세법령정보시스템을 통해 대상 세법을 수집하고
 * 구조화된 데이터로 변환한다.
 *
 * servicePrefix: 'TAX' — 모든 데이터 키에 TAX# 접두사를 사용한다.
 */
export class TaxLawCollectorModule implements ServiceModule {
  /** 서비스 접두사 */
  public readonly servicePrefix = 'TAX';

  private apiClient: TaxLawApiClient | null = null;
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

    const apiClientConfig: Partial<TaxLawApiClientConfig> = {
      molegApiKey: (config.config['molegApiKey'] as string) || '',
      ntsApiKey: (config.config['ntsApiKey'] as string) || '',
      timeoutMs: (config.config['timeoutMs'] as number) || 30000,
    };

    if (config.config['molegBaseUrl']) {
      apiClientConfig.molegBaseUrl = config.config['molegBaseUrl'] as string;
    }
    if (config.config['ntsBaseUrl']) {
      apiClientConfig.ntsBaseUrl = config.config['ntsBaseUrl'] as string;
    }

    this.apiClient = new TaxLawApiClient(apiClientConfig);
    this.initialized = true;
  }

  /**
   * 세법 수집 실행
   * 설정된 대상 세법 목록을 순회하며 API에서 세법 데이터를 수집한다.
   * 개별 세법 수집 실패 시 에러를 기록하고 나머지 세법 수집을 계속한다.
   * 최대 재시도 후에도 실패하면 SNS 알림을 발행한다.
   *
   * @param input - 모듈 입력 (payload에 targetLaws, forceUpdate 선택적 지정)
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

    const payload = input.payload as { targetLaws?: string[]; forceUpdate?: boolean } | undefined;
    const targetLaws = payload?.targetLaws || TARGET_TAX_LAWS;
    const result = await this.collectTaxLaws(targetLaws);

    // 최종 실패 항목이 있으면 SNS 알림 발행
    if (result.failureCount > 0) {
      await this.notifyFailure(result.errors);
    }

    const output: TaxLawCollectorOutput = {
      collectedCount: result.articles.length,
      updatedCount: result.successCount,
      rateTablesExtracted: result.rateTablesDetected,
      failedItems: result.errors.map(err => ({
        itemId: err.lawName,
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
        totalArticles: String(result.articles.length),
        successCount: String(result.successCount),
        failureCount: String(result.failureCount),
        rateTablesDetected: String(result.rateTablesDetected),
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
      const testResult = await this.apiClient.fetchTaxLaws(['소득세법'.slice(0, 3)]);
      // 간단한 검색만 수행하여 연결 상태 확인 — 실제로는 빈 결과를 허용
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
    return 'tax-law-collector';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 대상 세법 목록을 순회하며 수집 수행
   * 개별 세법 수집 실패 시 에러를 기록하고 나머지 세법 수집을 계속한다.
   *
   * @param targetLaws - 수집할 세법명 목록
   * @returns 수집 결과
   */
  private async collectTaxLaws(targetLaws: string[]): Promise<TaxLawCollectionResult> {
    const allArticles: TaxLawArticle[] = [];
    const errors: Array<{ lawName: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;
    let rateTablesDetected = 0;

    for (const lawName of targetLaws) {
      try {
        const articles = await this.circuitBreaker.execute(async () => {
          return this.apiClient!.fetchTaxLaws([lawName]);
        });

        allArticles.push(...articles);
        rateTablesDetected += articles.filter(a => a.hasRateTable).length;
        successCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ lawName, error: errorMessage });
        failureCount++;
      }
    }

    return {
      articles: allArticles,
      successCount,
      failureCount,
      rateTablesDetected,
      errors,
    };
  }

  /**
   * SNS 실패 알림 발행
   * 최대 재시도 후에도 실패한 세법 수집 항목에 대해 알림을 보낸다.
   *
   * @param errors - 실패 상세 정보
   */
  private async notifyFailure(errors: Array<{ lawName: string; error: string }>): Promise<void> {
    const subject = `[세무 AI] 세법 수집 실패 알림 (${errors.length}건)`;
    const message = errors
      .map(err => `- ${err.lawName}: ${err.error}`)
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
