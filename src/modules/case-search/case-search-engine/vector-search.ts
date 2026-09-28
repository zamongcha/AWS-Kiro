/**
 * @fileoverview 판례 벡터 검색 클라이언트
 * @description 기존 EmbeddingClient와 OpenSearchSearchClient를 재활용하여
 * 판례 전용 벡터 검색을 수행한다.
 * 하이브리드 검색: 벡터 유사도 + case_type 필터 + court_level 부스팅 + 시간 부스팅
 *
 * @requirements 2.1 - 사실관계 임베딩 변환 후 kNN 검색
 * @requirements 2.2 - 분쟁유형 필터 적용
 * @requirements 10.1 - 기존 court-cases 인덱스 공유
 */

import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { EmbeddingClient, EmbeddingClientConfig } from '../../search/embedding-client.js';
import type { CaseSearchResult, DisputeType, SearchQuery } from '../interfaces/index.js';

/**
 * 판례 벡터 검색 설정
 */
export interface CaseVectorSearchConfig {
  /** OpenSearch Serverless 엔드포인트 URL */
  openSearchEndpoint?: string;
  /** 판례 인덱스 이름 (기본값: 'court-cases') */
  caseIndex?: string;
  /** 임베딩 클라이언트 설정 */
  embeddingConfig?: EmbeddingClientConfig;
  /** 최대 결과 수 (기본값: 10) */
  maxResults?: number;
  /** 대법원 판례 부스팅 가중치 (기본값: 1.2) */
  supremeCourtBoost?: number;
  /** 최근 판결 부스팅 기간 (년, 기본값: 3) */
  recentYearsBoost?: number;
}

/**
 * OpenSearch kNN 검색 히트 인터페이스
 */
interface CaseSearchHit {
  _id: string;
  _score: number;
  _source: Record<string, unknown>;
}

/**
 * OpenSearch 검색 응답 인터페이스
 */
interface CaseSearchResponse {
  hits: {
    total: { value: number };
    hits: CaseSearchHit[];
  };
}

/**
 * 판례 벡터 검색 클래스
 *
 * 기존 EmbeddingClient를 재활용하여 사실관계를 임베딩으로 변환하고,
 * OpenSearch court-cases 인덱스에서 kNN 검색을 수행한다.
 * 하이브리드 검색 전략:
 * - 벡터 유사도 (kNN 코사인)
 * - case_type 필터 (분쟁 유형)
 * - court_level 부스팅 (대법원 우선)
 * - 시간 부스팅 (최근 판결)
 *
 * @requirements 2.1, 2.2, 10.1
 */
export class CaseVectorSearch {
  private readonly embeddingClient: EmbeddingClient;
  private readonly openSearchClient: OpenSearchClient | null;
  private readonly caseIndex: string;
  private readonly maxResults: number;
  private readonly supremeCourtBoost: number;
  private readonly recentYearsBoost: number;

  /**
   * CaseVectorSearch 생성자
   *
   * @param config - 검색 설정
   * @param deps - 의존 모듈 주입 (테스트용)
   */
  constructor(
    config?: CaseVectorSearchConfig,
    deps?: {
      embeddingClient?: EmbeddingClient;
      openSearchClient?: OpenSearchClient;
    },
  ) {
    this.caseIndex = config?.caseIndex ?? 'court-cases';
    this.maxResults = config?.maxResults ?? 10;
    this.supremeCourtBoost = config?.supremeCourtBoost ?? 1.2;
    this.recentYearsBoost = config?.recentYearsBoost ?? 3;

    // 임베딩 클라이언트 (기존 재활용)
    this.embeddingClient = deps?.embeddingClient ?? new EmbeddingClient(config?.embeddingConfig);

    // OpenSearch 클라이언트
    if (deps?.openSearchClient) {
      this.openSearchClient = deps.openSearchClient;
    } else if (config?.openSearchEndpoint) {
      this.openSearchClient = new OpenSearchClient({
        node: config.openSearchEndpoint,
        ssl: { rejectUnauthorized: true },
      });
    } else {
      this.openSearchClient = null;
    }
  }

  /**
   * 검색 쿼리 기반 판례 벡터 검색을 수행한다.
   *
   * 모든 SearchQuery에 대해 병렬 검색을 수행하고 결과를 병합한다.
   *
   * @param searchQueries - 검색 쿼리 목록
   * @returns 검색된 판례 결과 배열 (중복 제거)
   */
  async search(searchQueries: SearchQuery[]): Promise<CaseSearchResult[]> {
    if (!this.openSearchClient || searchQueries.length === 0) {
      return [];
    }

    // 각 쿼리에 대해 병렬 검색 수행
    const searchPromises = searchQueries.map((query) =>
      this.searchSingleQuery(query),
    );

    const allResults = await Promise.all(searchPromises);

    // 결과 병합 및 중복 제거 (caseId 기준)
    return this.mergeAndDeduplicate(allResults.flat());
  }

  /**
   * 단일 검색 쿼리에 대한 벡터 검색을 수행한다.
   *
   * @param query - 검색 쿼리
   * @returns 검색된 판례 결과 배열
   */
  private async searchSingleQuery(query: SearchQuery): Promise<CaseSearchResult[]> {
    if (!this.openSearchClient) {
      return [];
    }

    // 쿼리 텍스트를 임베딩 벡터로 변환
    const queryVector = await this.embeddingClient.embedQuery(query.queryText);

    // 하이브리드 검색 쿼리 구성
    const searchBody = this.buildSearchBody(queryVector, query.disputeTypeFilter);

    const response = await this.openSearchClient.search({
      index: this.caseIndex,
      body: searchBody,
    });

    const body = response.body as CaseSearchResponse;
    const hits = body.hits?.hits ?? [];

    return hits.map((hit) => this.mapHitToCaseSearchResult(hit));
  }

  /**
   * 하이브리드 검색 쿼리 본문을 구성한다.
   *
   * 벡터 유사도 + case_type 필터 + court_level 부스팅 + 시간 부스팅
   *
   * @param queryVector - 쿼리 임베딩 벡터
   * @param disputeTypeFilter - 분쟁 유형 필터
   * @returns OpenSearch 검색 쿼리 본문
   */
  private buildSearchBody(
    queryVector: number[],
    disputeTypeFilter: DisputeType,
  ): Record<string, unknown> {
    // 최근 N년 기준 날짜 계산
    const recentDate = new Date();
    recentDate.setFullYear(recentDate.getFullYear() - this.recentYearsBoost);
    const recentDateStr = recentDate.toISOString().split('T')[0];

    return {
      size: this.maxResults,
      query: {
        bool: {
          must: [
            {
              knn: {
                embedding_vector: {
                  vector: queryVector,
                  k: this.maxResults,
                },
              },
            },
          ],
          filter: [
            {
              term: {
                case_type: disputeTypeFilter,
              },
            },
          ],
          should: [
            // 대법원 판례 부스팅
            {
              term: {
                court_level: {
                  value: 'supreme',
                  boost: this.supremeCourtBoost,
                },
              },
            },
            // 최근 판결 부스팅
            {
              range: {
                judgment_date: {
                  gte: recentDateStr,
                  boost: 1.1,
                },
              },
            },
          ],
        },
      },
      _source: true,
    };
  }

  /**
   * OpenSearch 히트를 CaseSearchResult로 변환한다.
   *
   * @param hit - OpenSearch 검색 히트
   * @returns CaseSearchResult 인스턴스
   */
  private mapHitToCaseSearchResult(hit: CaseSearchHit): CaseSearchResult {
    const source = hit._source;

    return {
      caseId: (source['metadata'] as Record<string, unknown>)?.['case_id'] as string ?? hit._id,
      caseNumber: (source['case_number'] as string) ?? '',
      courtName: (source['court_name'] as string) ?? '',
      courtLevel: ((source['court_level'] as string) ?? 'lower') as 'supreme' | 'lower',
      judgmentDate: (source['judgment_date'] as string) ?? '',
      caseType: ((source['case_type'] as string) ?? 'lease') as DisputeType,
      summary: (source['chunk_content'] as string)?.substring(0, 500) ?? '',
      fullText: (source['chunk_content'] as string) ?? '',
      referencedLaws: (source['referenced_laws'] as string[]) ?? [],
      similarityScore: Math.max(0, Math.min(1, hit._score)),
      matchedFacts: [],
    };
  }

  /**
   * 여러 검색 결과를 병합하고 중복을 제거한다.
   *
   * 동일 caseId의 결과는 유사도가 높은 것을 유지한다.
   *
   * @param results - 병합할 결과 배열
   * @returns 중복 제거된 결과 배열
   */
  private mergeAndDeduplicate(results: CaseSearchResult[]): CaseSearchResult[] {
    const uniqueMap = new Map<string, CaseSearchResult>();

    for (const result of results) {
      const existing = uniqueMap.get(result.caseId);
      if (!existing || result.similarityScore > existing.similarityScore) {
        uniqueMap.set(result.caseId, result);
      }
    }

    return Array.from(uniqueMap.values());
  }
}
