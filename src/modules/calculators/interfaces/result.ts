/**
 * 부동산 계산기 공통 계산 결과 타입 정의
 *
 * 모든 계산기 모듈이 반환하는 표준 계산 결과 봉투(envelope)와 항목별 세부
 * 내역, 산출 근거 타입을 정의한다. 계산 결과는 항상 적용 산식·참조 기준표
 * 항목·기준연도·기준표 버전 등 산출 근거를 함께 포함하여 결정론적 계산의
 * 투명성을 보장한다.
 */

import type { CalculatorType } from './types.js';

/**
 * 계산 근거 (모든 계산 결과에 포함)
 *
 * 각 항목이 어떤 산식과 기준표를 근거로 산출되었는지 표현한다.
 */
export interface CalculationBasis {
  /** 적용 산식 */
  formula: string;
  /** 참조한 기준표 항목 */
  rateTableItem: string;
  /** 적용 요율/세율 (해당 시) */
  appliedRate?: number;
  /** 과세표준 (해당 시) */
  taxBase?: number;
  /** 적용 기준연도 */
  baseYear: number;
  /** 기준표 버전 식별자 */
  rateTableVersion: string;
}

/**
 * 항목별 세부 내역
 *
 * 취득세, 지방교육세 등 개별 항목의 금액과 산출 근거를 표현한다.
 */
export interface LineItem {
  /** 항목명 (취득세, 지방교육세 등) */
  name: string;
  /** 금액 (원) */
  amount: number;
  /** 산출 근거 */
  basis: CalculationBasis;
}

/**
 * 공통 계산 결과 봉투
 *
 * 모든 계산기 모듈이 반환하는 표준 결과 구조. 계산기별 상세는 제네릭
 * 타입 파라미터 `TDetail`로 표현한다.
 */
export interface CalculationResult<TDetail> {
  /** 계산기 유형 */
  calculatorType: CalculatorType;
  /** 총액 (원) */
  total: number;
  /** 항목별 세부 내역 */
  lineItems: LineItem[];
  /** 계산기별 상세 */
  detail: TDetail;
  /** 적용 기준연도 */
  baseYear: number;
  /** 적용 기준표 버전 */
  rateTableVersion: string;
  /** 면책 고지 (비어있지 않음) */
  disclaimer: string;
}
