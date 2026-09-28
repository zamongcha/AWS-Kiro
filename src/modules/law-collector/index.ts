/**
 * @fileoverview 법령 수집 모듈
 * @description 국가법령정보센터 Open API를 통해 부동산 관련 법령을 자동으로 수집하고
 * 구조화된 데이터로 변환하는 서비스 모듈이다.
 *
 * @requirements 1.1 - 국가법령정보센터 Open API를 통해 부동산 관련 법령을 자동으로 수집
 * @requirements 1.2 - 주택임대차보호법, 부동산 거래신고법, 공인중개사법, 부동산등기법, 민법(물권편), 상가건물임대차보호법
 * @requirements 1.3 - 법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력을 구조화하여 저장
 * @requirements 1.5 - 5초 초기 간격, 지수 백오프, 최대 3회 재시도
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
import { LawArticle, RevisionEntry } from '../../common/interfaces/index.js';
import { LawApiClient, LawApiClientConfig, LawListItem } from './law-api-client.js';

/**
 * 수집 대상 법령 목록
 *
 * 부동산 법률 AI 자문 시스템에서 사용하는 핵심 법령 6종을 정의한다.
 */
export const TARGET_LAWS: string[] = [
  '주택임대차보호법',
  '부동산 거래신고 등에 관한 법률',
  '공인중개사법',
  '부동산등기법',
  '민법',
  '상가건물 임대차보호법',
];

/**
 * 법령 수집 결과
 */
export interface LawCollectionResult {
  /** 수집된 법령 조문 목록 */
  articles: LawArticle[];
  /** 수집 성공한 법령 수 */
  successCount: number;
  /** 수집 실패한 법령 수 */
  failureCount: number;
  /** 수집 실패 상세 정보 */
  errors: Array<{ lawName: string; error: string }>;
}

/**
 * 법령 수집 모듈
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * 국가법령정보센터 Open API를 통해 대상 법령을 수집하고 구조화된 데이터로 변환한다.
 */
export class LawCollectorModule implements ServiceModule {
  private apiClient: LawApiClient | null = null;
  private config: ModuleConfig | null = null;
  private initialized = false;

  /**
   * 모듈 초기화
   * API 클라이언트 및 스토리지 설정을 구성한다.
   *
   * @param config - 모듈 설정 (config 필드에 apiKey, baseUrl 등 포함)
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const apiClientConfig: Partial<LawApiClientConfig> = {
      apiKey: (config.config['apiKey'] as string) || '',
      timeoutMs: (config.config['timeoutMs'] as number) || 30000,
    };

    if (config.config['baseUrl']) {
      apiClientConfig.baseUrl = config.config['baseUrl'] as string;
    }

    this.apiClient = new LawApiClient(apiClientConfig);
    this.initialized = true;
  }

  /**
   * 법령 수집 실행
   * 설정된 대상 법령 목록을 순회하며 API에서 법령 데이터를 수집한다.
   *
   * @param input - 모듈 입력 (type: 'collect', payload에 targetLaws 선택적 지정 가능)
   * @returns 수집 결과 (성공 시 LawCollectionResult 포함)
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

    const targetLaws = (input.payload as { targetLaws?: string[] })?.targetLaws || TARGET_LAWS;
    const result = await this.collectLaws(targetLaws);

    return {
      success: result.failureCount === 0,
      data: result,
      metadata: {
        totalArticles: String(result.articles.length),
        successCount: String(result.successCount),
        failureCount: String(result.failureCount),
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
      await this.apiClient.fetchLawList('민법');
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
    return 'law-collector';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 대상 법령 목록을 순회하며 수집 수행
   * 개별 법령 수집 실패 시 에러를 기록하고 나머지 법령 수집을 계속한다.
   *
   * @param targetLaws - 수집할 법령명 목록
   * @returns 수집 결과
   */
  private async collectLaws(targetLaws: string[]): Promise<LawCollectionResult> {
    const allArticles: LawArticle[] = [];
    const errors: Array<{ lawName: string; error: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (const lawName of targetLaws) {
      try {
        const articles = await this.collectSingleLaw(lawName);
        allArticles.push(...articles);
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
      errors,
    };
  }

  /**
   * 단일 법령 수집
   * 법령 검색 → 상세 조회 → 개정 이력 조회 순서로 데이터를 수집하고,
   * 조문별로 개정 이력을 매핑하여 구조화된 데이터를 반환한다.
   *
   * @param lawName - 수집할 법령명
   * @returns 수집된 조문 목록
   */
  private async collectSingleLaw(lawName: string): Promise<LawArticle[]> {
    if (!this.apiClient) {
      throw new Error('API 클라이언트가 초기화되지 않았습니다.');
    }

    // 1. 법령 검색하여 법령 ID 확인
    const lawList: LawListItem[] = await this.apiClient.fetchLawList(lawName);

    if (lawList.length === 0) {
      throw new Error(`법령을 찾을 수 없습니다: ${lawName}`);
    }

    // 가장 첫 번째 결과 사용 (정확도 높은 순)
    const targetLaw = lawList[0];

    // 2. 법령 상세 조회 (조문 목록)
    const articles: LawArticle[] = await this.apiClient.fetchLawDetail(targetLaw.lawId);

    // 3. 개정 이력 조회
    const revisions: RevisionEntry[] = await this.apiClient.fetchLawRevisions(targetLaw.lawId);

    // 4. 조문에 개정 이력 매핑
    const enrichedArticles = articles.map(article => ({
      ...article,
      revisions,
    }));

    return enrichedArticles;
  }
}
