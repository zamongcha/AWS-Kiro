/**
 * 양도소득세 계산기 (transfer-tax) 인터페이스 정의
 *
 * 양도차익·1세대1주택 비과세 판정·12억 안분·장기보유특별공제·과세표준·세율
 * 적용·지방소득세를 산출하는 양도세 계산기의 입출력 타입을 정의한다. 결과
 * 봉투는 공통 `CalculationResult<TransferTaxDetail>` 제네릭을 사용한다.
 */

import type { HousingCount } from './types.js';
import type { CalculationResult } from './result.js';

/**
 * 양도세 계산 입력
 */
export interface TransferTaxInput {
  /** 양도가액 (원) */
  transferPrice: number;
  /** 취득가액 (원) */
  acquisitionPrice: number;
  /** 필요경비 (원) */
  necessaryExpense: number;
  /** 보유기간 (년, 소수 허용) */
  holdingPeriod: number;
  /** 거주기간 (년) */
  residencePeriod: number;
  /** 1세대1주택 여부 */
  isSingleHouseholdOneHouse: boolean;
  /** 주택 수 */
  housingCount: HousingCount;
  /** 조정대상지역 여부 */
  isAdjustmentArea: boolean;
  /** 적용 기준연도 */
  baseYear: number;
}

/**
 * 양도세 계산 상세
 */
export interface TransferTaxDetail {
  /** 양도차익 */
  transferGain: number;
  /** 과세 대상 양도차익 (12억 안분 반영) */
  taxableTransferGain: number;
  /** 장기보유특별공제액 */
  longTermDeduction: number;
  /** 표1(1세대1주택)/표2(일반)/없음 */
  longTermDeductionTable: 'table1' | 'table2' | 'none';
  /** 기본공제 (연 250만원) */
  basicDeduction: number;
  /** 과세표준 */
  taxBase: number;
  /** 기본/중과/단기 */
  appliedRateType: 'basic' | 'heavy_multi' | 'short_term';
  /** 적용 세율 */
  appliedRate: number;
  /** 누진공제액 */
  progressiveDeduction: number;
  /** 양도소득세 산출세액 */
  transferIncomeTax: number;
  /** 지방소득세 (양도세 × 10%) */
  localIncomeTax: number;
  /** 비과세 판정 */
  isExempt: boolean;
  /** 비과세 근거 */
  exemptionBasis?: string;
}

/**
 * 양도세 계산 결과
 */
export type TransferTaxResult = CalculationResult<TransferTaxDetail>;
