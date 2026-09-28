/**
 * 수정제안 생성기 (revision-advisor) 인터페이스 정의
 *
 * 위험 조항에 대한 수정 문안 제안(mode=suggest)과 사용자 문의 조항의
 * 법적 유효성·유불리 판단(mode=judge)을 생성하는 생성기의 입출력 타입을
 * 정의한다.
 */

import type { ContractType, PartyPerspective, PartyImpact } from './types.js';
import type { RiskClause } from './risk-detector.js';

/**
 * 수정제안 생성기 입력
 */
export interface RevisionAdvisorInput {
  /** 위험 조항 수정 제안 | 사용자 문의 조항 판단 */
  mode: 'suggest' | 'judge';
  /** 당사자 관점 */
  perspective: PartyPerspective;
  /** mode=suggest 시 대상 위험 조항 */
  riskClause?: RiskClause;
  /** mode=judge 시 문의 조항 문구 (1~2000자) */
  queryClause?: string;
  /** 계약 유형 */
  contractType: ContractType;
}

/**
 * 수정제안 생성기 출력
 */
export interface RevisionAdvisorOutput {
  /** 모드 */
  mode: 'suggest' | 'judge';
  /** mode=suggest: 수정 문안 1~5개 */
  suggestions?: RevisionSuggestion[];
  /** mode=judge: 조항 판단 결과 */
  judgment?: ClauseJudgment;
  /** 부동산 계약 범위 외 여부 */
  isOutOfScope: boolean;
  /** 면책 고지 (참고용, 전문가 상담 권장) */
  disclaimer: string;
}

/**
 * 수정 제안
 */
export interface RevisionSuggestion {
  /** 수정 문안 (존댓말) */
  revisedText: string;
  /** 제안 사유 */
  rationale: string;
  /** 근거 법조항/판례 (최소 1건, 없으면 표시) */
  legalBasis: LegalReference[];
  /** 명시적 근거 존재 여부 */
  hasExplicitBasis: boolean;
}

/**
 * 조항 판단 (mode=judge)
 */
export interface ClauseJudgment {
  /** 법적 유효성 판단 */
  legalValidity: string;
  /** 당사자 관점 유불리 */
  partyImpactJudgment: PartyImpact;
  /** 주의사항 */
  cautions: string;
  /** 근거 법조항/판례 */
  legalBasis: LegalReference[];
  /** 명시적 근거 존재 여부 */
  hasExplicitBasis: boolean;
}

/**
 * 근거 법조항/판례 참조
 */
export interface LegalReference {
  /** 참조 유형 */
  type: 'law_article' | 'precedent';
  /** 법령명 */
  lawName?: string;
  /** 조항 번호 */
  articleNumber?: string;
  /** 사건번호 */
  caseNumber?: string;
  /** 요약 */
  summary: string;
}
