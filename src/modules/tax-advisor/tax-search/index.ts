/**
 * 세무 검색 모듈 (TaxSearchModule)
 *
 * OpenSearch Serverless를 활용하여 세법(tax-laws)과 예규/심판례(tax-rulings)
 * 인덱스에 대한 벡터 유사도 검색을 수행하는 서비스 모듈이다.
 *
 * 주요 기능:
 * - Titan Embeddings V2로 질문을 1024차원 벡터로 변환 (3초 이내)
 * - 세법(tax-laws)과 예규/심판례(tax-rulings) 네임스페이스 분리 검색
 * - 유사도 점수 내림차순 정렬, 각 유형 최대 5건 반환
 * - 관련도 임계값(0.5) 미달 문서에 isLowRelevance: true 표시
 * - TaxNLPModule 연동: 동의어 확장, 일상 용어 매핑, 세목 분류, 수치 추출
 *
 * @module TaxSearchModule
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../../common/interfaces/service-module.js';
import { EmbeddingClient, EmbeddingClientConfig } from '../../search/embedding-client.js';
import { OpenSearchSearchClient, OpenSearchClientConfig } from '../../search/opensearch-client.js';
import { TaxQueryProcessor } from './tax-query-processor.js';
import type {
  TaxSearchInput,
  TaxSearchOutput,
  TaxSearchResult,
  TaxType,
} from '../interfaces/index.js';

/** 관련도 임계값 기본값 (0.0~1.0) */
const DEFAULT_RELEVANCE_THRESHOLD = 0.5;

/** 각 유형별 최대 검색 결과 수 */
const DEFAULT_MAX_RESULTS_PER_TYPE = 5;

/** 세법 인덱스 이름 */
const TAX_LAW_INDEX = 'tax-laws';

/** 예규/심판례 인덱스 이름 */
const TAX_RULING_INDEX = 'tax-rulings';

/**
 * OpenSearch 히트 인터페이스 (세무 전용)
 */
interface TaxOpenSearchHit {
  _id: string;
  _score: number;
  _source: Record<string, unknown>;
}

/**
 * OpenSearch 검색 응답 인터페이스
 */
interface TaxOpenSearchResponse {
  hits: {
    total: { value: number };
    hits: TaxOpenSearchHit[];
  };
}

/**
 * 세무 검색 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * OpenSearch Serverless kNN 검색을 통해 세법/예규 유사 문서를 검색한다.
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
export class TaxSearchModule implements ServiceModule {
  private config: ModuleConfig | null = null;
  private embeddingClient: EmbeddingClient | null = null;
  private openSearchClient: OpenSearchSearchClient | null = null;
  private queryProcessor: TaxQueryProcessor | null = null;
  private relevanceThreshold: number = DEFAULT_RELEVANCE_THRESHOLD;
  private maxResultsPerType: number = DEFAULT_MAX_RESULTS_PER_TYPE;
  private initialized = false;

  /**
   * 모듈 초기화
   *
   * 임베딩 클라이언트, OpenSearch 클라이언트, 세무 질문 전처리기를 초기화한다.
   *
   * @param config - 모듈 설정
   *   config.config에 다음 필드를 포함할 수 있다:
   *   - openSearchEndpoint: OpenSearch Serverless 엔드포인트 URL
   *   - region: AWS 리전 (기본값: 'ap-northeast-2')
   *   - relevanceThreshold: 관련도 임계값 (기본값: 0.5)
   *   - maxResultsPerType: 유형별 최대 결과 수 (기본값: 5)
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const region = (config.config['region'] as string) || 'ap-northeast-2';
    const openSearchEndpoint = (config.config['openSearchEndpoint'] as string) || '';
    this.relevanceThreshold = (config.config['relevanceThreshold'] as number) || DEFAULT_RELEVANCE_THRESHOLD;
    this.maxResultsPerType = (config.config['maxResultsPerType'] as number) || DEFAULT_MAX_RESULTS_PER_TYPE;

    // 임베딩 클라이언트 초기화 (3초 타임아웃)
    const embeddingConfig: EmbeddingClientConfig = {
      region,
      timeoutMs: 3000,
    };
    this.embeddingClient = new EmbeddingClient(embeddingConfig);

    // OpenSearch 클라이언트 초기화 (세법/예규 인덱스)
    if (openSearchEndpoint) {
      const osConfig: OpenSearchClientConfig = {
        endpoint: openSearchEndpoint,
        lawIndex: TAX_LAW_INDEX,
        caseIndex: TAX_RULING_INDEX,
        relevanceThreshold: this.relevanceThreshold,
        defaultMaxResults: this.maxResultsPerType,
      };
      this.openSearchClient = new OpenSearchSearchClient(osConfig);
    }

    // 세무 질문 전처리기 초기화
    this.queryProcessor = new TaxQueryProcessor();

    this.initialized = true;
  }

  /**
   * 검색 실행
   *
   * 사용자 세무 질문을 받아 NLP 전처리 후 벡터 검색을 수행하고
   * 유사도 점수 내림차순으로 정렬된 결과를 반환한다.
   *
   * 처리 흐름:
   * 1. TaxQueryProcessor로 NLP 전처리 (형태소 분석 + 동의어 확장 + 세목 분류 + 수치 추출)
   * 2. Titan Embeddings V2로 질문 벡터 변환 (3초 이내)
   * 3. OpenSearch kNN 검색 (tax-laws + tax-rulings 인덱스)
   * 4. 결과 정렬, 유형별 최대 5건 제한, isLowRelevance 플래그
   *
   * @param input - 모듈 입력 (type: 'tax_search', payload에 TaxSearchInput 포함)
   * @returns 검색 결과 (ModuleOutput 형식, data에 TaxSearchOutput 포함)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.embeddingClient || !this.queryProcessor) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '세무 검색 모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const searchInput = input.payload as TaxSearchInput;

    try {
      // 1. NLP 전처리 (동의어 확장, 세목 분류, 수치 추출)
      const processedQuery = this.queryProcessor.processQuery(searchInput.query);

      // 2. 임베딩 변환 (3초 타임아웃)
      // 확장된 용어를 포함한 질문으로 임베딩 생성
      const embeddingText = processedQuery.expandedQueryText || searchInput.query;
      const queryVector = await this.embeddingClient.embedQuery(embeddingText);

      // 3. 검색 옵션 구성
      const maxResults = searchInput.maxResults ?? this.maxResultsPerType;
      const searchOptions = {
        maxResults,
        threshold: this.relevanceThreshold,
      };

      // 4. OpenSearch 검색 수행 (세법/예규 인덱스 분리)
      let taxLawHits: TaxOpenSearchHit[] = [];
      let rulingHits: TaxOpenSearchHit[] = [];

      if (this.openSearchClient) {
        const [lawResults, rulingResults] = await Promise.all([
          this.searchTaxLawIndex(queryVector, maxResults),
          this.searchRulingIndex(queryVector, maxResults),
        ]);
        taxLawHits = lawResults;
        rulingHits = rulingResults;
      }

      // 5. 결과 변환 및 정렬 (유사도 내림차순)
      const taxLawDocuments = this.mapTaxLawHits(taxLawHits, maxResults);
      const rulingDocuments = this.mapRulingHits(rulingHits, maxResults);

      const searchOutput: TaxSearchOutput = {
        taxLawDocuments,
        rulingDocuments,
        decomposedTaxTypes: processedQuery.taxTypes,
        extractedNumerics: processedQuery.extractedNumerics,
      };

      return {
        success: true,
        data: searchOutput,
        metadata: {
          taxLawCount: String(taxLawDocuments.length),
          rulingCount: String(rulingDocuments.length),
          detectedTaxTypes: processedQuery.taxTypes.join(','),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: [{
          code: 'TAX_SEARCH_FAILED',
          message: `세무 검색 실패: ${errorMessage}`,
          severity: ErrorSeverity.HIGH,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

  /**
   * 모듈 헬스체크
   */
  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { reason: 'Module not initialized' },
      };
    }

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
        indices: [TAX_LAW_INDEX, TAX_RULING_INDEX],
      },
    };
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'tax-search';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * tax-laws 인덱스에서 kNN 검색을 수행한다.
   */
  private async searchTaxLawIndex(
    queryVector: number[],
    maxResults: number
  ): Promise<TaxOpenSearchHit[]> {
    if (!this.openSearchClient) {
      return [];
    }

    const results = await this.openSearchClient.searchLaws(queryVector, {
      maxResults,
      threshold: this.relevanceThreshold,
    });

    // SearchResult를 TaxOpenSearchHit 형태로 변환 (내부 사용)
    return results.map((r) => ({
      _id: r.id,
      _score: r.score,
      _source: {
        law_name: r.source.title,
        article_content: r.content,
        effective_date: r.source.date ?? '',
        tax_type: '',
        article_number: '',
        has_rate_table: false,
        source: 'MOLEG',
        isLowRelevance: r.source.isLowRelevance,
      },
    }));
  }

  /**
   * tax-rulings 인덱스에서 kNN 검색을 수행한다.
   */
  private async searchRulingIndex(
    queryVector: number[],
    maxResults: number
  ): Promise<TaxOpenSearchHit[]> {
    if (!this.openSearchClient) {
      return [];
    }

    const results = await this.openSearchClient.searchCases(queryVector, {
      maxResults,
      threshold: this.relevanceThreshold,
    });

    // SearchResult를 TaxOpenSearchHit 형태로 변환 (내부 사용)
    return results.map((r) => ({
      _id: r.id,
      _score: r.score,
      _source: {
        document_number: r.source.title,
        chunk_content: r.content,
        reply_date: r.source.date ?? '',
        document_type: 'ruling',
        tax_category: '',
        source: 'NTS',
        isLowRelevance: r.source.isLowRelevance,
      },
    }));
  }

  /**
   * 세법 히트를 TaxSearchResult 배열로 변환한다.
   * 유사도 점수 내림차순 정렬, 최대 maxResults건 제한.
   */
  private mapTaxLawHits(
    hits: TaxOpenSearchHit[],
    maxResults: number
  ): TaxSearchResult[] {
    return hits
      .sort((a, b) => b._score - a._score)
      .slice(0, maxResults)
      .map((hit) => ({
        documentId: hit._id,
        documentType: 'tax_law' as const,
        content: (hit._source['article_content'] as string) ?? '',
        similarityScore: hit._score,
        isLowRelevance: hit._score < this.relevanceThreshold,
        metadata: {
          title: (hit._source['law_name'] as string) ?? '',
          source: (hit._source['source'] as string) ?? 'MOLEG',
          date: (hit._source['effective_date'] as string) ?? '',
          taxType: (hit._source['tax_type'] as TaxType) ?? 'acquisition',
          articleNumber: (hit._source['article_number'] as string) ?? '',
          hasRateTable: (hit._source['has_rate_table'] as boolean) ?? false,
        },
      }));
  }

  /**
   * 예규/심판례 히트를 TaxSearchResult 배열로 변환한다.
   * 유사도 점수 내림차순 정렬, 최대 maxResults건 제한.
   */
  private mapRulingHits(
    hits: TaxOpenSearchHit[],
    maxResults: number
  ): TaxSearchResult[] {
    return hits
      .sort((a, b) => b._score - a._score)
      .slice(0, maxResults)
      .map((hit) => ({
        documentId: hit._id,
        documentType: 'ruling' as const,
        content: (hit._source['chunk_content'] as string) ?? '',
        similarityScore: hit._score,
        isLowRelevance: hit._score < this.relevanceThreshold,
        metadata: {
          title: (hit._source['document_number'] as string) ?? '',
          source: (hit._source['source'] as string) ?? 'NTS',
          date: (hit._source['reply_date'] as string) ?? '',
          taxType: (hit._source['tax_category'] as TaxType) ?? 'acquisition',
          documentType: (hit._source['document_type'] as string) ?? '',
        },
      }));
  }
}
