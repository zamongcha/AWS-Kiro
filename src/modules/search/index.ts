/**
 * @fileoverview 검색 모듈
 * @description OpenSearch Serverless를 활용한 벡터 검색 및 하이브리드 검색을 수행하는
 * 서비스 모듈이다. 법령/판례 네임스페이스를 분리하여 검색하고, 유사도 점수 기반으로
 * 내림차순 정렬된 결과를 반환한다.
 *
 * @requirements 3.1 - 벡터 유사도 검색 (3초 이내 임베딩 변환)
 * @requirements 3.2 - 5초 이내 결과 반환
 * @requirements 3.3 - 유사도 점수 내림차순 정렬, 각 유형 최대 5건 반환
 * @requirements 3.4 - 관련도 기준 미달 문서에 isLowRelevance 표시
 * @requirements 8.4 - ServiceModule 인터페이스 구현
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../common/interfaces/service-module.js';
import {
  SearchInput,
  SearchOutput,
  SearchResult,
} from '../../common/interfaces/search.js';
import { EmbeddingClient, EmbeddingClientConfig } from './embedding-client.js';
import { OpenSearchSearchClient, OpenSearchClientConfig } from './opensearch-client.js';
import { QueryDecomposer } from './query-decomposer.js';
import { KoreanNLPModule } from './korean-nlp.js';
import { SynonymDictionary } from './synonym-dictionary.js';

/** 관련도 임계값 기본값 (0.0 ~ 1.0) */
const DEFAULT_RELEVANCE_THRESHOLD = 0.5;

/** 각 유형별 최대 검색 결과 수 */
const DEFAULT_MAX_RESULTS_PER_TYPE = 5;

/**
 * 검색 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * OpenSearch Serverless kNN 검색을 통해 법령/판례 유사 문서를 검색한다.
 *
 * - Titan Embeddings V2로 질문을 1024차원 벡터로 변환 (3초 이내)
 * - 법령(law-articles)과 판례(court-cases) 네임스페이스 분리 검색
 * - 유사도 점수 내림차순 정렬, 각 유형 최대 5건 반환
 * - 관련도 임계값(0.5) 미달 문서에 isLowRelevance: true 표시
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 8.4
 */
export class SearchModule implements ServiceModule {
  private config: ModuleConfig | null = null;
  private embeddingClient: EmbeddingClient | null = null;
  private openSearchClient: OpenSearchSearchClient | null = null;
  private queryDecomposer: QueryDecomposer | null = null;
  private initialized = false;

  /**
   * 모듈 초기화
   *
   * 임베딩 클라이언트, OpenSearch 클라이언트, 한국어 NLP 모듈,
   * 동의어 사전, 질문 분해 모듈을 초기화한다.
   *
   * @param config - 모듈 설정
   *   config.config에 다음 필드를 포함할 수 있다:
   *   - openSearchEndpoint: OpenSearch Serverless 엔드포인트 URL
   *   - region: AWS 리전 (기본값: 'ap-northeast-2')
   *   - synonymTableName: DynamoDB 동의어 테이블 이름
   *   - relevanceThreshold: 관련도 임계값 (기본값: 0.5)
   *   - maxResultsPerType: 유형별 최대 결과 수 (기본값: 5)
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const region = (config.config['region'] as string) || 'ap-northeast-2';
    const openSearchEndpoint = (config.config['openSearchEndpoint'] as string) || '';
    const relevanceThreshold = (config.config['relevanceThreshold'] as number) || DEFAULT_RELEVANCE_THRESHOLD;
    const maxResultsPerType = (config.config['maxResultsPerType'] as number) || DEFAULT_MAX_RESULTS_PER_TYPE;

    // 임베딩 클라이언트 초기화 (3초 타임아웃)
    const embeddingConfig: EmbeddingClientConfig = {
      region,
      timeoutMs: 3000,
    };
    this.embeddingClient = new EmbeddingClient(embeddingConfig);

    // OpenSearch 클라이언트 초기화 (법령/판례 네임스페이스 분리)
    if (openSearchEndpoint) {
      const osConfig: OpenSearchClientConfig = {
        endpoint: openSearchEndpoint,
        lawIndex: 'law-articles',
        caseIndex: 'court-cases',
        relevanceThreshold,
        defaultMaxResults: maxResultsPerType,
      };
      this.openSearchClient = new OpenSearchSearchClient(osConfig);
    }

    // 한국어 NLP 및 동의어 사전 초기화
    const nlpModule = new KoreanNLPModule();
    const synonymDictionary = new SynonymDictionary();
    const synonymTableName = (config.config['synonymTableName'] as string) || '';
    if (synonymTableName) {
      await synonymDictionary.loadFromDynamoDB(synonymTableName);
    }

    // 질문 분해 모듈 초기화
    this.queryDecomposer = new QueryDecomposer(nlpModule, synonymDictionary);

    this.initialized = true;
  }

  /**
   * 검색 실행
   *
   * 사용자 질문을 받아 벡터 검색을 수행하고
   * 유사도 점수 내림차순으로 정렬된 결과를 반환한다.
   *
   * 처리 흐름:
   * 1. 질문 분해 (복합 질문 → 주제별 하위 쿼리)
   * 2. 하이브리드 검색 쿼리 생성 (형태소 분석 + 동의어 확장)
   * 3. Titan Embeddings V2로 질문 벡터 변환 (3초 이내)
   * 4. OpenSearch kNN 검색 (법령/판례 네임스페이스 분리)
   * 5. 결과 병합, 유사도 점수 내림차순 정렬, 각 유형 최대 5건 제한
   *
   * @param input - 모듈 입력 (type: 'search', payload에 SearchInput 포함)
   * @returns 검색 결과 (ModuleOutput 형식, data에 SearchOutput 포함)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.embeddingClient || !this.queryDecomposer) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '검색 모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const searchInput = input.payload as SearchInput;
    const searchStartTime = Date.now();

    try {
      // 1. 질문 분해 (복합 질문 처리)
      const decomposed = this.queryDecomposer.decomposeQuery(searchInput.query);

      // 2. 임베딩 변환 (벡터 검색용, 3초 타임아웃)
      const queryVector = await this.embeddingClient.embedQuery(searchInput.query);

      // 3. 검색 옵션 구성
      const maxResults = searchInput.options?.maxResults ?? DEFAULT_MAX_RESULTS_PER_TYPE;
      const threshold = searchInput.options?.threshold ?? DEFAULT_RELEVANCE_THRESHOLD;
      const searchOptions = { maxResults, threshold };

      // 4. OpenSearch 검색 수행 (법령/판례 네임스페이스 분리)
      let lawResults: SearchResult[] = [];
      let caseResults: SearchResult[] = [];

      if (this.openSearchClient) {
        // OpenSearchSearchClient를 사용한 kNN 벡터 검색
        [lawResults, caseResults] = await Promise.all([
          this.openSearchClient.searchLaws(queryVector, searchOptions),
          this.openSearchClient.searchCases(queryVector, searchOptions),
        ]);
      }

      // 5. 결과 병합 및 유사도 점수 내림차순 정렬
      const allResults = [...lawResults, ...caseResults]
        .sort((a, b) => b.score - a.score);

      const searchTime = Date.now() - searchStartTime;

      const searchOutput: SearchOutput = {
        results: allResults,
        totalCount: allResults.length,
        searchTime,
        metadata: {
          topics: decomposed.topics,
          isRealEstateLaw: decomposed.isRealEstateLaw,
          subQueryCount: decomposed.subQueries.length,
          lawResultCount: lawResults.length,
          caseResultCount: caseResults.length,
        },
      };

      return {
        success: true,
        data: searchOutput,
        metadata: {
          searchTimeMs: String(searchTime),
          resultCount: String(allResults.length),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: [{
          code: 'SEARCH_FAILED',
          message: errorMessage,
          severity: ErrorSeverity.HIGH,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

  /**
   * 모듈 헬스체크
   *
   * 모듈 초기화 상태와 OpenSearch 연결 상태를 확인한다.
   *
   * @returns 현재 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { reason: 'Module not initialized' },
      };
    }

    // OpenSearch 연결 확인
    if (this.openSearchClient) {
      const pingOk = await this.openSearchClient.ping();
      if (!pingOk) {
        return {
          status: HealthStatusEnum.DEGRADED,
          lastCheck: new Date().toISOString(),
          details: {
            initialized: true,
            openSearchConnected: false,
            reason: 'OpenSearch connection failed',
          },
        };
      }
    }

    return {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: true,
        openSearchConnected: !!this.openSearchClient,
      },
    };
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'search';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }
}
