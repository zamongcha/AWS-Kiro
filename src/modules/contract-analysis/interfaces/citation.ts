/**
 * 인용 표시기 (citation) 인터페이스 정의
 *
 * 각 위험 조항에 근거 법조항·판례 각주를 표시하고 본문 각주 번호를
 * 등장 순서대로 연속 부여하는 인용 표시기의 입출력 타입을 정의한다.
 */

import type { RiskClause } from './risk-detector.js';
import type { LegalReference } from './revision-advisor.js';

/**
 * 인용 표시기 입력
 */
export interface CitationInput {
  /** 위험 조항 목록 */
  riskClauses: RiskClause[];
  /** clauseId → 근거 목록 매핑 */
  legalReferences: Record<string, LegalReference[]>;
}

/**
 * 인용 표시기 출력
 */
export interface CitationOutput {
  /** 각주가 부여된 조항 목록 */
  annotatedClauses: AnnotatedClause[];
}

/**
 * 각주가 부여된 조항
 */
export interface AnnotatedClause {
  /** 조항 식별자 */
  clauseId: string;
  /** 각주 목록 (조항당 최대 5개) */
  footnotes: Footnote[];
  /** 근거 미발견 시 표시 */
  noBasisFound: boolean;
}

/**
 * 각주
 */
export interface Footnote {
  /** 본문 등장 순서대로 1부터 연속 부여되는 번호 */
  number: number;
  /** 근거 참조 */
  reference: LegalReference;
}
