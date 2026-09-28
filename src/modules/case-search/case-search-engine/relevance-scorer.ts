/**
 * @fileoverview 유사도 점수 산출 및 관련도 판별 모듈
 * @description 판례 검색 결과의 유사도 점수를 정규화하고, 결과를 정렬하며,
 * 저관련도 여부를 감지한다.
 *
 * 정렬 규칙:
 * 1. 유사도 점수 내림차순
 * 2. 동일 유사도 시 대법원(supreme) 판례 우선
 *
 * 저관련도 감지:
 * - 전체 결과의 유사도 점수가 모두 0.3 미만이면 isLowRelevance = true
 *
 * @requirements 2.3 - 유사도 점수 0.0~1.0 정규화
 * @requirements 2.4 - 유사도 내림차순 정렬
 * @requirements 2.5 - 동일 유사도 시 대법원 판례 우선
 * @requirements 2.6 - 저관련도 감지 (전체 결과 0.3 미만)
 */

import type { CaseSearchResult } from '../interfaces/index.js';

/** 저관련도 임계값 */
const LOW_RELEVANCE_THRESHOLD = 0.3;

/** 최대 결과 수 */
const DEFAULT_MAX_RESULTS = 10;

/**
 * 유사도 점수 산출 및 결과 정렬 클래스
 *
 * 검색 결과의 유사도 점수를 정규화하고, 정렬 규칙에 따라 결과를 정렬한다.
 * 저관련도를 감지하여 사용자에게 추가 안내가 필요한지 판별한다.
 *
 * @requirements 2.3, 2.4, 2.5, 2.6
 */
export class RelevanceScorer {
  private readonly maxResults: number;
  private readonly lowRelevanceThreshold: number;

  /**
   * RelevanceScorer 생성자
   *
   * @param maxResults - 최대 결과 수 (기본값: 10)
   * @param lowRelevanceThreshold - 저관련도 임계값 (기본값: 0.3)
   */
  constructor(maxResults?: number, lowRelevanceThreshold?: number) {
    this.maxResults = maxResults ?? DEFAULT_MAX_RESULTS;
    this.lowRelevanceThreshold = lowRelevanceThreshold ?? LOW_RELEVANCE_THRESHOLD;
  }

  /**
   * 검색 결과를 정렬하고 제한한다.
   *
   * 정렬 규칙:
   * 1. 유사도 점수 내림차순
   * 2. 동일 유사도 시 대법원(supreme) 판례가 하급심(lower)보다 앞
   *
   * @param results - 원본 검색 결과 배열
   * @returns 정렬 및 제한된 결과 배열 (최대 maxResults 건)
   *
   * @example
   * ```typescript
   * const scorer = new RelevanceScorer();
   * const sorted = scorer.sortAndLimit(rawResults);
   * // 유사도 내림차순, 동일 유사도 시 대법원 우선, 최대 10건
   * ```
   */
  sortAndLimit(results: CaseSearchResult[]): CaseSearchResult[] {
    const sorted = [...results].sort((a, b) => {
      // 유사도 점수 내림차순
      if (b.similarityScore !== a.similarityScore) {
        return b.similarityScore - a.similarityScore;
      }
      // 동일 유사도 시 대법원(supreme) 우선
      if (a.courtLevel === 'supreme' && b.courtLevel === 'lower') {
        return -1;
      }
      if (a.courtLevel === 'lower' && b.courtLevel === 'supreme') {
        return 1;
      }
      return 0;
    });

    return sorted.slice(0, this.maxResults);
  }

  /**
   * 유사도 점수를 0.0~1.0 범위로 정규화한다.
   *
   * OpenSearch kNN 점수는 엔진에 따라 범위가 다를 수 있으므로
   * 0.0~1.0 범위로 클램핑한다.
   *
   * @param score - 원본 유사도 점수
   * @returns 0.0~1.0 범위로 정규화된 점수
   */
  normalizeScore(score: number): number {
    return Math.max(0.0, Math.min(1.0, score));
  }

  /**
   * 결과 목록의 유사도 점수를 정규화한다.
   *
   * @param results - 원본 검색 결과 배열
   * @returns 유사도 점수가 정규화된 결과 배열
   */
  normalizeResults(results: CaseSearchResult[]): CaseSearchResult[] {
    return results.map((result) => ({
      ...result,
      similarityScore: this.normalizeScore(result.similarityScore),
    }));
  }

  /**
   * 저관련도 여부를 감지한다.
   *
   * 전체 결과의 유사도 점수가 모두 임계값(0.3) 미만인 경우
   * 저관련도로 판별한다.
   *
   * @param results - 검색 결과 배열
   * @returns 저관련도 여부 (true: 모든 결과가 0.3 미만)
   *
   * @example
   * ```typescript
   * const scorer = new RelevanceScorer();
   *
   * scorer.detectLowRelevance([{ similarityScore: 0.2 }, { similarityScore: 0.1 }]);
   * // true (모든 결과가 0.3 미만)
   *
   * scorer.detectLowRelevance([{ similarityScore: 0.5 }, { similarityScore: 0.1 }]);
   * // false (0.3 이상인 결과가 1건 이상 존재)
   * ```
   */
  detectLowRelevance(results: CaseSearchResult[]): boolean {
    if (results.length === 0) {
      return true;
    }

    return results.every(
      (result) => result.similarityScore < this.lowRelevanceThreshold,
    );
  }
}
