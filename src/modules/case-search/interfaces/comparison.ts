/**
 * 비교 분석 모듈 인터페이스 정의
 *
 * 동일 쟁점에서 상이한 결론을 가진 판례 간
 * 사실관계 차이점, 판단 근거 차이, 결론이 달라진 핵심 요인을
 * 분석하는 모듈의 입출력 인터페이스를 정의한다.
 */

import type { CaseSearchResult } from './types.js';

/**
 * 비교 분석 입력 인터페이스
 */
export interface ComparisonInput {
  /** 비교 대상 판례 목록 */
  cases: CaseSearchResult[];
  /** 공통 쟁점 */
  commonIssue: string;
}

/**
 * 비교 분석 결과 인터페이스
 */
export interface ComparisonResult {
  /** 공통 쟁점 */
  commonIssue: string;
  /** 비교된 판례 목록 */
  comparedCases: ComparedCase[];
  /** 결론이 달라진 핵심 요인 */
  differentiatingFactors: string[];
  /** 상급심 우선 안내 (대법원/하급심 간 결론 차이 시) */
  courtHierarchyNote?: string;
}

/**
 * 비교 대상 판례 인터페이스
 */
export interface ComparedCase {
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 법원 등급 */
  courtLevel: 'supreme' | 'lower';
  /** 선고일자 (ISO 8601) */
  judgmentDate: string;
  /** 결론 요약 */
  conclusion: string;
  /** 판단 근거 */
  reasoningBasis: string;
  /** 사실관계 차이점 */
  factualDifference: string;
}
