/**
 * 트렌드 분석 모듈 인터페이스 정의
 *
 * 특정 분쟁 유형의 판결 경향 변화를 시간순으로 분석하고,
 * 관련 법령 개정 영향을 함께 제시하는 모듈의 입출력 인터페이스를 정의한다.
 */

import type { DisputeType } from './types.js';

/**
 * 트렌드 분석 입력 인터페이스
 */
export interface TrendInput {
  /** 분쟁 유형 */
  disputeType: DisputeType;
  /** 관련 쟁점 */
  relatedIssue: string;
  /** 분석 기간 (기본 5년) */
  periodYears?: number;
}

/**
 * 트렌드 분석 결과 인터페이스
 */
export interface TrendResult {
  /** 분쟁 유형 */
  disputeType: DisputeType;
  /** 분석 기간 */
  analysisPeriod: { from: string; to: string };
  /** 분석 대상 판례 수 */
  totalCasesAnalyzed: number;
  /** 판결 경향 설명 */
  trendDescription: string;
  /** 시간순 변화 양상 */
  timelineChanges: TrendChange[];
  /** 관련 법령 개정 (해당 시) */
  relatedLawChanges?: LawChange[];
  /** 데이터 부족 여부 */
  insufficientData: boolean;
}

/**
 * 트렌드 변화 항목 인터페이스
 */
export interface TrendChange {
  /** 기간 */
  period: string;
  /** 판결 방향 */
  direction: string;
  /** 대표 사건번호 */
  representativeCases: string[];
}

/**
 * 법령 개정 정보 인터페이스
 */
export interface LawChange {
  /** 법령명 */
  lawName: string;
  /** 개정일자 (ISO 8601) */
  changeDate: string;
  /** 개정 내용 */
  description: string;
  /** 트렌드에 미친 영향 */
  impactOnTrend: string;
}
