/**
 * 특약 추천기 (clause-recommender) 인터페이스 정의
 *
 * 계약 유형·당사자 관점이 확정되면 권장 특약을 추천하며, 누락 특약을
 * 상단 우선순위에 배치하는 추천기의 입출력 타입을 정의한다.
 */

import type { ContractType, PartyPerspective } from './types.js';
import type { MissingClause } from './risk-detector.js';
import type { LegalReference } from './revision-advisor.js';

/**
 * 특약 추천기 입력
 */
export interface ClauseRecommenderInput {
  /** 계약 유형 */
  contractType: ContractType;
  /** 당사자 관점 */
  perspective: PartyPerspective;
  /** 누락 특약 (상단 우선 배치) */
  missingClauses?: MissingClause[];
}

/**
 * 특약 추천기 출력
 */
export interface ClauseRecommenderOutput {
  /** 권장 특약 목록 (1개 이상 or 빈 목록 안내) */
  recommendations: RecommendedClause[];
  /** 추천 항목 존재 여부 */
  hasRecommendations: boolean;
}

/**
 * 권장 특약
 */
export interface RecommendedClause {
  /** 특약 문안 */
  clauseText: string;
  /** 추천 사유 */
  reason: string;
  /** 당사자 관점 기준 이점 */
  benefit: string;
  /** 우선순위 (누락 특약이 상위) */
  priority: number;
  /** 근거 법조항/판례 (1건 이상) */
  legalBasis: LegalReference[];
  /** 근거 미확인 시 false */
  isBasisVerified: boolean;
}
