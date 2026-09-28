/**
 * @fileoverview 판례 검색 엔진 모듈
 * @description 사실관계 분석 결과를 기반으로 OpenSearch에서 유사 판례를 검색하는
 * 모듈의 진입점이다. CaseVectorSearch와 RelevanceScorer를 조합하여
 * 하이브리드 벡터 검색 → 유사도 정규화 → 정렬 → 저관련도 감지 파이프라인을 제공한다.
 *
 * @requirements 2.1 - 사실관계 임베딩 변환 후 kNN 검색
 * @requirements 2.2 - 분쟁유형 필터 적용
 * @requirements 2.3 - 유사도 점수 0.0~1.0 정규화
 * @requirements 2.4 - 유사도 내림차순 정렬
 * @requirements 2.5 - 동일 유사도 시 대법원 판례 우선
 * @requirements 2.6 - 저관련도 감지 (전체 결과 0.3 미만)
 * @requirements 10.1 - 기존 court-cases 인덱스 공유, 최대 10건 반환
 */

import type { CaseSearchModuleInput, CaseSearchModuleOutput } from '../interfaces/index.js';
import { CaseVectorSearch, CaseVectorSearchConfig } from './vector-search.js';
import { RelevanceScorer } from './relevance-scorer.js';

/**
 * 판례 검색 엔진 모듈 설정
 */
export interface CaseSearchEngineConfig {
  /** 벡터 검색 설정 */
  vectorSearchConfig?: CaseVectorSearchConfig;
  /** 최대 결과 수 (기본값: 10) */
  maxResults?: number;
  /** 저관련도 임계값 (기본값: 0.3) */
  lowRelevanceThreshold?: number;
}

/**
 * 판례 검색 엔진 모듈 클래스
 *
 * 사실관계 분석에서 생성된 검색 쿼리를 받아 유사 판례를 검색하고,
 * 유사도 정규화, 정렬, 저관련도 감지를 수행한다.
 *
 * 처리 흐름:
 * 1. CaseVectorSearch로 벡터 검색 실행 (분쟁유형 필터 + 부스팅)
 * 2. RelevanceScorer로 유사도 정규화
 * 3. 유사도 내림차순 정렬 (동일 유사도 시 대법원 우선)
 * 4. 최대 10건 제한
 * 5. 저관련도 감지
 *
 * @requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.1
 */
export class CaseSearchEngineModule {
  private readonly vectorSearch: CaseVectorSearch;
  private readonly relevanceScorer: RelevanceScorer;
  private readonly maxResults: number;

  /**
   * CaseSearchEngineModule 생성자
   *
   * @param config - 모듈 설정
   * @param deps - 의존 모듈 주입 (테스트용)
   */
  constructor(
    config?: CaseSearchEngineConfig,
    deps?: {
      vectorSearch?: CaseVectorSearch;
      relevanceScorer?: RelevanceScorer;
    },
  ) {
    this.maxResults = config?.maxResults ?? 10;

    this.vectorSearch = deps?.vectorSearch ?? new CaseVectorSearch(config?.vectorSearchConfig);
    this.relevanceScorer = deps?.relevanceScorer ?? new RelevanceScorer(
      this.maxResults,
      config?.lowRelevanceThreshold,
    );
  }

  /**
   * 판례 검색을 수행한다.
   *
   * @param input - 검색 모듈 입력 (검색 쿼리 목록 + 최대 결과 수)
   * @returns 검색 모듈 출력 (검색 결과 + 관련도 정보 + 검색 시간)
   *
   * @example
   * ```typescript
   * const engine = new CaseSearchEngineModule();
   * const result = await engine.search({
   *   searchQueries: [
   *     { queryText: '임대차보증금 반환', emphasis: ['보증금'], disputeTypeFilter: 'lease' }
   *   ],
   *   maxResults: 10
   * });
   * ```
   */
  async search(input: CaseSearchModuleInput): Promise<CaseSearchModuleOutput> {
    const startTime = Date.now();

    try {
      // 1. 벡터 검색 실행
      const rawResults = await this.vectorSearch.search(input.searchQueries);

      // 2. 유사도 점수 정규화
      const normalizedResults = this.relevanceScorer.normalizeResults(rawResults);

      // 3. 정렬 및 결과 수 제한
      const maxResults = input.maxResults ?? this.maxResults;
      const sortedResults = this.relevanceScorer.sortAndLimit(normalizedResults);
      const limitedResults = sortedResults.slice(0, maxResults);

      // 4. 저관련도 감지
      const isLowRelevance = this.relevanceScorer.detectLowRelevance(limitedResults);

      const searchTimeMs = Date.now() - startTime;

      return {
        cases: limitedResults,
        totalFound: rawResults.length,
        isLowRelevance,
        searchTimeMs,
      };
    } catch (error) {
      const searchTimeMs = Date.now() - startTime;

      // 검색 실패 시 빈 결과 반환
      return {
        cases: [],
        totalFound: 0,
        isLowRelevance: true,
        searchTimeMs,
      };
    }
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'case-search-engine';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { CaseVectorSearch } from './vector-search.js';
export { RelevanceScorer } from './relevance-scorer.js';
export type { CaseVectorSearchConfig } from './vector-search.js';
