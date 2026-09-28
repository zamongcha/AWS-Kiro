/**
 * OpenSearch Serverless kNN 검색 클라이언트
 *
 * OpenSearch Serverless에서 코사인 유사도 기반 kNN 벡터 검색을 수행한다.
 * 법령(law-articles)과 판례(court-cases) 인덱스를 분리하여 검색하며,
 * 각 유형당 최대 5건을 유사도 점수 내림차순으로 반환한다.
 * 관련도 임계값(0.5) 미달 문서에 isLowRelevance 표시를 추가한다.
 *
 * @module OpenSearchSearchClient
 * @requirements 3.2, 3.3, 3.4, 8.4
 */

import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import {
  SearchResult,
  SearchResultType,
  SearchOptions,
} from '../../common/interfaces/index.js';

/**
 * OpenSearch 검색 클라이언트 설정 인터페이스
 */
export interface OpenSearchClientConfig {
  /** OpenSearch Serverless 엔드포인트 URL */
  endpoint: string;
  /** 법령 인덱스 이름 (기본값: 'law-articles') */
  lawIndex?: string;
  /** 판례 인덱스 이름 (기본값: 'court-cases') */
  caseIndex?: string;
  /** 관련도 임계값 (기본값: 0.5) */
  relevanceThreshold?: number;
  /** 유형별 최대 결과 수 (기본값: 5) */
  defaultMaxResults?: number;
}

/**
 * OpenSearch kNN 검색 히트 인터페이스
 */
interface OpenSearchHit {
  _id: string;
  _score: number;
  _source: Record<string, unknown>;
}

/**
 * OpenSearch 검색 응답 인터페이스
 */
interface OpenSearchSearchResponse {
  hits: {
    total: { value: number };
    hits: OpenSearchHit[];
  };
}

/**
 * OpenSearch Serverless kNN 검색 클라이언트
 *
 * 법령과 판례 인덱스에 대해 코사인 유사도 기반 kNN 벡터 검색을 수행한다.
 * 네임스페이스 분리(law-articles, court-cases)를 통해 독립적인 검색을 지원한다.
 *
 * @requirements 3.2, 3.3, 3.4, 8.4
 */
export class OpenSearchSearchClient {
  private client: OpenSearchClient;
  private lawIndex: string;
  private caseIndex: string;
  private relevanceThreshold: number;
  private defaultMaxResults: number;

  constructor(config: OpenSearchClientConfig) {
    this.client = new OpenSearchClient({
      node: config.endpoint,
      ssl: { rejectUnauthorized: true },
    });

    this.lawIndex = config.lawIndex ?? 'law-articles';
    this.caseIndex = config.caseIndex ?? 'court-cases';
    this.relevanceThreshold = config.relevanceThreshold ?? 0.5;
    this.defaultMaxResults = config.defaultMaxResults ?? 5;
  }

  /**
   * 법령 인덱스에서 kNN 벡터 검색을 수행한다.
   *
   * 질문 벡터와 코사인 유사도가 높은 법령 문서를 검색한다.
   * 결과는 유사도 점수 내림차순으로 정렬되며 최대 5건을 반환한다.
   * 임계값(0.5) 미달 문서에는 isLowRelevance: true를 표시한다.
   *
   * @param queryVector - 질문 임베딩 벡터 (1024차원)
   * @param options - 검색 옵션 (maxResults, threshold 등)
   * @returns 법령 검색 결과 배열
   *
   * @requirements 3.2, 3.3, 3.4
   */
  async searchLaws(
    queryVector: number[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const maxResults = options?.maxResults ?? this.defaultMaxResults;
    const threshold = options?.threshold ?? this.relevanceThreshold;

    return this.executeKnnSearch(
      this.lawIndex,
      queryVector,
      maxResults,
      threshold,
      SearchResultType.LAW
    );
  }

  /**
   * 판례 인덱스에서 kNN 벡터 검색을 수행한다.
   *
   * 질문 벡터와 코사인 유사도가 높은 판례 문서를 검색한다.
   * 결과는 유사도 점수 내림차순으로 정렬되며 최대 5건을 반환한다.
   * 임계값(0.5) 미달 문서에는 isLowRelevance: true를 표시한다.
   *
   * @param queryVector - 질문 임베딩 벡터 (1024차원)
   * @param options - 검색 옵션 (maxResults, threshold 등)
   * @returns 판례 검색 결과 배열
   *
   * @requirements 3.2, 3.3, 3.4
   */
  async searchCases(
    queryVector: number[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const maxResults = options?.maxResults ?? this.defaultMaxResults;
    const threshold = options?.threshold ?? this.relevanceThreshold;

    return this.executeKnnSearch(
      this.caseIndex,
      queryVector,
      maxResults,
      threshold,
      SearchResultType.CASE
    );
  }

  /**
   * OpenSearch 클러스터 연결 상태를 확인한다.
   *
   * @returns 연결 성공 시 true, 실패 시 false
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.client.cluster.health();
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * kNN 벡터 검색을 실행한다.
   *
   * OpenSearch의 kNN 검색 기능을 사용하여 코사인 유사도 기반으로
   * 가장 유사한 문서를 검색한다. 결과는 점수 내림차순으로 정렬된다.
   *
   * @param index - 검색 대상 인덱스 이름
   * @param queryVector - 질문 임베딩 벡터
   * @param maxResults - 최대 결과 수
   * @param threshold - 관련도 임계값
   * @param resultType - 검색 결과 문서 유형
   * @returns 검색 결과 배열
   */
  private async executeKnnSearch(
    index: string,
    queryVector: number[],
    maxResults: number,
    threshold: number,
    resultType: SearchResultType
  ): Promise<SearchResult[]> {
    const searchBody = {
      size: maxResults,
      query: {
        knn: {
          embedding_vector: {
            vector: queryVector,
            k: maxResults,
          },
        },
      },
      _source: true,
    };

    const response = await this.client.search({
      index,
      body: searchBody,
    });

    const body = response.body as OpenSearchSearchResponse;
    const hits = body.hits?.hits ?? [];

    // 점수 내림차순 정렬 (OpenSearch가 기본으로 정렬하지만 명시적으로 보장)
    const sortedHits = [...hits].sort((a, b) => b._score - a._score);

    // 최대 결과 수 제한
    const limitedHits = sortedHits.slice(0, maxResults);

    return limitedHits.map((hit) =>
      this.mapHitToSearchResult(hit, resultType, threshold)
    );
  }

  /**
   * OpenSearch 히트를 SearchResult로 변환한다.
   *
   * @param hit - OpenSearch 검색 히트
   * @param resultType - 문서 유형 (LAW/CASE)
   * @param threshold - 관련도 임계값
   * @returns 변환된 SearchResult
   */
  private mapHitToSearchResult(
    hit: OpenSearchHit,
    resultType: SearchResultType,
    threshold: number
  ): SearchResult {
    const source = hit._source;
    const score = hit._score;
    const isLowRelevance = score < threshold;

    if (resultType === SearchResultType.LAW) {
      return {
        id: hit._id,
        type: SearchResultType.LAW,
        content: (source['article_content'] as string) ?? '',
        score,
        source: {
          title: (source['law_name'] as string) ?? '',
          date: (source['effective_date'] as string) ?? undefined,
          isLowRelevance,
        },
      };
    }

    // 판례 결과
    return {
      id: hit._id,
      type: SearchResultType.CASE,
      content: (source['chunk_content'] as string) ?? '',
      score,
      source: {
        title: (source['case_number'] as string) ?? '',
        date: (source['judgment_date'] as string) ?? undefined,
        isLowRelevance,
      },
    };
  }
}
