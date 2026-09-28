/**
 * @fileoverview 판례 수집 모듈
 * @description 대법원 종합법률정보 시스템을 통해 부동산 관련 판례를 자동으로 수집하고
 * 구조화된 데이터로 변환하는 서비스 모듈이다.
 *
 * @requirements 2.1 - 대법원 종합법률정보 시스템 연동하여 부동산 관련 판례 수집
 * @requirements 2.2 - 임대차, 매매, 등기, 중개, 재건축/재개발 분쟁 카테고리별 수집
 * @requirements 2.3 - 사건번호, 선고일자, 법원명, 사건 유형, 판결 요지, 판결 전문, 참조 법령 구조화
 * @requirements 2.5 - 30초 고정 간격, 최대 3회 재시도
 * @requirements 2.8 - 동일 사건번호 존재 시 신규 저장 생략 (중복 판별)
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../common/interfaces/index.js';
import { CourtCase } from '../../common/interfaces/index.js';
import { CaseApiClient, CaseApiClientConfig, CaseListItem, TARGET_CATEGORIES } from './case-api-client.js';

/**
 * 판례 수집 결과
 */
export interface CaseCollectionResult {
  /** 수집된 판례 목록 */
  cases: CourtCase[];
  /** 수집 성공한 카테고리 수 */
  successCount: number;
  /** 수집 실패한 카테고리 수 */
  failureCount: number;
  /** 중복으로 건너뛴 판례 수 */
  skippedDuplicates: number;
  /** 수집 실패 상세 정보 */
  errors: Array<{ category: string; error: string }>;
}

/**
 * 판례 수집 모듈
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * 대법원 종합법률정보 API를 통해 대상 카테고리의 판례를 수집하고 구조화된 데이터로 변환한다.
 */
export class CaseCollectorModule implements ServiceModule {
  private apiClient: CaseApiClient | null = null;
  private config: ModuleConfig | null = null;
  private initialized = false;

  /**
   * 모듈 초기화
   * API 클라이언트 설정을 구성한다.
   *
   * @param config - 모듈 설정 (config 필드에 apiKey, baseUrl, existingCaseNumbers 등 포함)
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const apiClientConfig: Partial<CaseApiClientConfig> = {
      apiKey: (config.config['apiKey'] as string) || '',
      timeoutMs: (config.config['timeoutMs'] as number) || 30000,
    };

    if (config.config['baseUrl']) {
      apiClientConfig.baseUrl = config.config['baseUrl'] as string;
    }

    this.apiClient = new CaseApiClient(apiClientConfig);

    // 기존 사건번호 목록 설정 (중복 판별용)
    const existingCaseNumbers = config.config['existingCaseNumbers'] as string[] | undefined;
    if (existingCaseNumbers) {
      this.apiClient.setExistingCaseNumbers(existingCaseNumbers);
    }

    this.initialized = true;
  }

  /**
   * 판례 수집 실행
   * 설정된 대상 카테고리 목록을 순회하며 API에서 판례 데이터를 수집한다.
   * 동일 사건번호가 이미 존재하는 경우 신규 저장을 생략한다.
   *
   * @param input - 모듈 입력 (type: 'collect', payload에 categories 선택적 지정 가능)
   * @returns 수집 결과 (성공 시 CaseCollectionResult 포함)
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

    const categories = (input.payload as { categories?: string[] })?.categories || TARGET_CATEGORIES;
    const result = await this.collectCases(categories);

    return {
      success: result.failureCount === 0,
      data: result,
      metadata: {
        totalCases: String(result.cases.length),
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
   *
   * @returns 현재 헬스 상태
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
      // 간단한 검색으로 API 연결 상태 확인
      await this.apiClient.fetchCaseList('임대차', 1);
      return {
        status: HealthStatusEnum.HEALTHY,
        lastCheck: new Date().toISOString(),
        details: { apiConnected: true },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { apiConnected: false, error: errorMessage },
      };
    }
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'case-collector';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 대상 카테고리 목록을 순회하며 판례 수집 수행
   * 개별 카테고리 수집 실패 시 에러를 기록하고 나머지 카테고리 수집을 계속한다.
   *
   * @param categories - 수집할 카테고리 목록
   * @returns 수집 결과
   */
  private async collectCases(categories: string[]): Promise<CaseCollectionResult> {
    const allCases: CourtCase[] = [];
    const errors: Array<{ category: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;
    let skippedDuplicates = 0;

    for (const category of categories) {
      try {
        const { cases, duplicatesSkipped } = await this.collectByCategory(category);
        allCases.push(...cases);
        skippedDuplicates += duplicatesSkipped;
        successCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ category, error: errorMessage });
        failureCount++;
      }
    }

    return {
      cases: allCases,
      successCount,
      failureCount,
      skippedDuplicates,
      errors,
    };
  }

  /**
   * 단일 카테고리 판례 수집
   * 카테고리 검색 → 중복 확인 → 상세 조회 순서로 데이터를 수집하고,
   * 중복되지 않는 판례만 상세 조회하여 구조화된 데이터를 반환한다.
   *
   * @param category - 수집할 카테고리 (예: '임대차 분쟁')
   * @returns 수집된 판례 목록 및 건너뛴 중복 수
   */
  private async collectByCategory(category: string): Promise<{ cases: CourtCase[]; duplicatesSkipped: number }> {
    if (!this.apiClient) {
      throw new Error('API 클라이언트가 초기화되지 않았습니다.');
    }

    // 1. 판례 목록 조회
    const caseList: CaseListItem[] = await this.apiClient.fetchCaseList(category);

    if (caseList.length === 0) {
      return { cases: [], duplicatesSkipped: 0 };
    }

    // 2. 중복 확인 후 상세 조회
    const cases: CourtCase[] = [];
    let duplicatesSkipped = 0;

    for (const item of caseList) {
      // 동일 사건번호 존재 시 신규 저장 생략
      if (this.apiClient.isDuplicate(item.caseNumber)) {
        duplicatesSkipped++;
        continue;
      }

      try {
        const caseDetail = await this.apiClient.fetchCaseDetail(item.caseId);
        cases.push(caseDetail);
      } catch (error) {
        // 개별 판례 상세 조회 실패 시 건너뛰고 계속 진행
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`판례 상세 조회 실패 (caseId: ${item.caseId}): ${errorMessage}`);
      }
    }

    return { cases, duplicatesSkipped };
  }
}
