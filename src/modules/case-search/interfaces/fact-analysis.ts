/**
 * 사실관계 분석 모듈 인터페이스 정의
 *
 * 사용자 상황 설명으로부터 사실관계를 분석하고,
 * 분쟁 유형, 당사자 관계, 핵심 사실, 법적 쟁점, 검색 쿼리를 추출하는
 * 모듈의 입출력 인터페이스를 정의한다.
 */

import type { ConversationEntry } from '../../../common/interfaces/data-models.js';
import type { DisputeType, PartyRelation, SearchQuery } from './types.js';

/**
 * 사실관계 분석 입력 인터페이스
 */
export interface FactAnalysisInput {
  /** 사용자 상황 설명 */
  situationDescription: string;
  /** 세션 컨텍스트 (후속 질문 처리용) */
  sessionContext?: ConversationEntry[];
}

/**
 * 사실관계 분석 출력 인터페이스
 *
 * LLM이 사용자 상황에서 추출한 구조화된 법적 분석 정보를 담는다.
 */
export interface FactAnalysisOutput {
  /** 분류된 분쟁 유형 (1개 이상) */
  disputeTypes: DisputeType[];
  /** 당사자 관계 */
  parties: PartyRelation;
  /** 핵심 사실관계 목록 */
  keyFacts: string[];
  /** 법적 쟁점 목록 */
  legalIssues: string[];
  /** 생성된 검색 쿼리 */
  searchQueries: SearchQuery[];
  /** 부동산 분쟁 해당 여부 */
  isRealEstateDispute: boolean;
}
