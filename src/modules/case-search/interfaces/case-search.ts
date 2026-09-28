/**
 * 판례 검색 엔진 모듈 인터페이스 정의
 *
 * 사실관계 분석으로부터 생성된 검색 쿼리를 기반으로
 * OpenSearch에서 유사 판례를 검색하는 모듈의 입출력 인터페이스를 정의한다.
 */

import type { CaseSearchResult, SearchQuery } from './types.js';

/**
 * 판례 검색 모듈 입력 인터페이스
 */
export interface CaseSearchModuleInput {
  /** 검색 쿼리 목록 */
  searchQueries: SearchQuery[];
  /** 최대 결과 수 (기본 10) */
  maxResults?: number;
}

/**
 * 판례 검색 모듈 출력 인터페이스
 */
export interface CaseSearchModuleOutput {
  /** 검색된 판례 목록 */
  cases: CaseSearchResult[];
  /** 전체 검색 결과 수 */
  totalFound: number;
  /** 전체 결과 관련도 미달 여부 (모든 유사도 < 0.3) */
  isLowRelevance: boolean;
  /** 검색 소요 시간 (ms) */
  searchTimeMs: number;
}
