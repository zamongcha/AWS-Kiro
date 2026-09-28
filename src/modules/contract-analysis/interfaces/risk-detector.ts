/**
 * 위험조항 탐지기 (risk-detector) 인터페이스 정의
 *
 * 계약서 조항을 계약 유형별 독소조항 룰셋 및 벡터 유사도와 대조하여
 * 위험 조항과 누락 필수 특약을 식별하는 탐지기의 입출력 타입을 정의한다.
 *
 * 위험 판정 규칙: 계약 유형별 독소조항 룰셋에 매칭되거나 벡터 유사도가
 * 0.75 이상이면 위험 조항으로 판정한다.
 */

import type {
  ContractType,
  PartyPerspective,
  PartyImpact,
  ClauseSpan,
} from './types.js';
import type { RecognizedClause } from './document-recognizer.js';

/**
 * 위험조항 탐지기 입력
 */
export interface RiskDetectorInput {
  /** 문서 식별자 */
  documentId: string;
  /** 계약 유형 */
  contractType: ContractType;
  /** 당사자 관점 */
  perspective: PartyPerspective;
  /** 분석 대상 조항 목록 */
  clauses: RecognizedClause[];
}

/**
 * 위험조항 탐지기 출력
 */
export interface RiskDetectorOutput {
  /** 탐지된 위험 조항 목록 */
  riskClauses: RiskClause[];
  /** 누락 필수 특약 (항상 별도 항목으로 제시) */
  missingClauses: MissingClause[];
  /** 위험 조항 총 개수 */
  totalRiskCount: number;
  /** 적용된 룰셋 버전 */
  ruleSetVersion: number;
}

/**
 * 위험 조항
 */
export interface RiskClause {
  /** 조항 식별자 */
  clauseId: string;
  /** 원문 매칭 (하이라이트용) */
  span: ClauseSpan;
  /** 위험 유형 */
  riskType: string;
  /** 위험 사유 */
  riskReason: string;
  /** 당사자 관점 기준 유불리 */
  partyImpact: PartyImpact;
  /** 룰셋 매칭 or 벡터 유사도 */
  matchSource: 'ruleset' | 'vector';
  /** 벡터 유사도 (matchSource=vector 시) */
  similarityScore?: number;
  /** 선택 관점 기준 불리 여부 (별도 구분 표시) */
  isDisadvantageous: boolean;
}

/**
 * 누락된 필수 특약
 */
export interface MissingClause {
  /** 누락된 특약명 */
  clauseName: string;
  /** 필요성 설명 */
  description: string;
  /** 당사자 관점 */
  perspective: PartyPerspective;
}
