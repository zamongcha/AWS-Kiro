/**
 * 판례 연동기 (case-linker) 인터페이스 정의
 *
 * 위험 조항별 유사 분쟁 판례를 기존 판례 검색 서비스에서 검색하여
 * 연동하는 연동기의 입출력 타입을 정의한다.
 *
 * 판례 검색 서비스 호출은 내부 Lambda 호출 또는 `/case-search/analyze`
 * API 호출로 수행하며, 10초 이내 응답하지 않거나 오류를 반환하면 판례
 * 연동 없이 분석 결과를 반환한다.
 */

import type { RiskClause } from './risk-detector.js';

/**
 * 판례 연동기 입력
 */
export interface CaseLinkerInput {
  /** 위험 조항 목록 */
  riskClauses: RiskClause[];
}

/**
 * 판례 연동기 출력
 */
export interface CaseLinkerOutput {
  /** 조항별 연동 판례 목록 */
  linkedCases: ClauseLinkedCases[];
  /** 판례 서비스 실패 시 false + 안내 */
  caseLinkAvailable: boolean;
}

/**
 * 조항별 연동 판례
 */
export interface ClauseLinkedCases {
  /** 조항 식별자 */
  clauseId: string;
  /** 연동 판례 (조항당 최대 3건) */
  cases: LinkedCase[];
}

/**
 * 연동 판례
 */
export interface LinkedCase {
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 판결 요지 */
  judgmentSummary: string;
  /** 판례 원문 링크 (유효성 확인) */
  originalUrl: string;
  /** URL 유효성 확인 여부 */
  urlVerified: boolean;
}
