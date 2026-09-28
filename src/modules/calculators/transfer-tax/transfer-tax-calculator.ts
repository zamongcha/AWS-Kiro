/**
 * 양도소득세 계산기 순수 계산 로직 (transfer-tax)
 *
 * 양도차익·1세대1주택 비과세 판정·12억 초과분 안분·장기보유특별공제·과세표준·세율
 * 적용(단기/중과/기본)·지방소득세를 법정 기준표(TransferRateData)에 근거하여 산출하는
 * 결정론적 순수 함수를 제공한다. 외부 AI/네트워크 호출 없이 동일 입력에 대해 항상
 * 동일한 출력을 반환한다(참조 투명성, Property 1).
 *
 * 계산 로직은 기준표(rateData)를 인자로 주입받아 상수 테이블과 분리되며, 세법 개정 시
 * 기준표만 교체하면 로직 변경 없이 새 기준연도를 지원한다.
 *
 * @requirements 2.1 - 양도차익 = 양도가액 − 취득가액 − 필요경비
 * @requirements 2.2 - 1세대1주택 비과세 판정(보유·거주·양도가액 상한)
 * @requirements 2.3 - 1세대1주택 & 양도가액 > 12억 시 과세 양도차익 안분
 * @requirements 2.4 - 장기보유특별공제 표1(1세대1주택)/표2(일반) 선택·공제액 산출
 * @requirements 2.5 - 과세표준 = 과세 양도차익 − 장특공제 − 기본공제(음수 시 0)
 * @requirements 2.6 - 기본세율(누진) 산출세액 = 과세표준 × 세율 − 누진공제
 * @requirements 2.7 - 단기보유 중과세율(1년 미만 70%, 1~2년 60%)
 * @requirements 2.8 - 다주택 조정지역 중과 가산(+20%p/+30%p)
 * @requirements 2.9 - 지방소득세 = 양도소득세 × 10%
 * @requirements 2.10 - 결과 구조 완전성(항목·근거·기준연도·버전·면책 고지)
 * @requirements 2.11 - 조건 세율 미존재 시 산출 불가 오류 반환 + 입력 보존
 */

import type {
  TransferTaxDetail,
  TransferTaxInput,
  TransferTaxResult,
} from '../interfaces/transfer-tax.js';
import type {
  LongTermDeductionRow,
  ProgressiveBracket,
  TransferRateData,
} from '../interfaces/rate-tables.js';
import type { CalculationBasis, LineItem } from '../interfaces/result.js';

/**
 * 양도세 계산 결과 면책 고지 문구.
 *
 * 참고용 추정치이며 실제 세액은 개별 상황·최신 세법·비과세/감면 요건 충족 여부에 따라
 * 달라질 수 있음을 안내한다(요구사항 5.5).
 */
export const TRANSFER_TAX_DISCLAIMER =
  '본 계산은 참고용 추정치이며, 실제 양도소득세·지방소득세는 개별 상황, 보유·거주 요건, 비과세·감면 요건 충족 여부 및 최신 세법에 따라 달라질 수 있습니다. 정확한 세액은 관할 세무서 또는 전문가 상담을 통해 확인하시기 바랍니다.';

/** 조건 세율 미존재 오류 코드(요구사항 2.11) */
export const TRANSFER_TAX_RATE_NOT_FOUND_CODE = 'TRANSFER_TAX_RATE_NOT_FOUND';

/**
 * 양도세 산출 성공 결과.
 */
export interface TransferTaxCalculationSuccess {
  ok: true;
  /** 표준 계산 결과 봉투 */
  result: TransferTaxResult;
}

/**
 * 양도세 산출 실패 결과(조건 세율 미존재 등).
 *
 * 계산을 수행하지 않고 오류 코드·메시지와 함께 원본 입력을 보존한다(요구사항 2.11).
 */
export interface TransferTaxCalculationFailure {
  ok: false;
  /** 오류 코드 */
  code: string;
  /** 사용자 안내 메시지 */
  message: string;
  /** 보존된 원본 입력 */
  preservedInput: TransferTaxInput;
}

/**
 * 양도세 산출 결과(성공 | 실패).
 */
export type TransferTaxCalculationOutcome =
  | TransferTaxCalculationSuccess
  | TransferTaxCalculationFailure;

/**
 * 세율 적용 결과(내부 표현).
 */
interface RateApplication {
  /** 적용 세율 유형 */
  appliedRateType: TransferTaxDetail['appliedRateType'];
  /** 적용 세율 */
  appliedRate: number;
  /** 누진공제액 */
  progressiveDeduction: number;
  /** 산출세액 */
  transferIncomeTax: number;
  /** 근거 산식 설명 */
  formula: string;
  /** 참조 기준표 항목 설명 */
  rateTableItem: string;
}

/**
 * 양도소득세를 산출한다(결정론적 순수 함수).
 *
 * 주입받은 기준표(rateData)와 기준연도·버전 메타데이터에 근거하여 양도차익·비과세
 * 판정·12억 안분·장기보유특별공제·과세표준·세율(단기 > 중과 > 기본 우선순위)·지방소득세를
 * 산출한다. 1세대1주택 비과세가 인정되면 세액을 0으로 산출하고 근거를 표시한다.
 * 과세표준이 있으나 기본세율 구간이 기준표에 존재하지 않으면 계산을 수행하지 않고 산출
 * 불가 오류와 함께 입력을 보존한다.
 *
 * @param input - 양도세 계산 입력
 * @param rateData - 양도세 기준표 데이터(상수 테이블)
 * @param baseYear - 적용 기준연도
 * @param version - 적용 기준표 버전 식별자
 * @returns 성공 시 계산 결과, 실패 시 오류·입력 보존
 */
export function calculateTransferTax(
  input: TransferTaxInput,
  rateData: TransferRateData,
  baseYear: number,
  version: string,
): TransferTaxCalculationOutcome {
  const basisMeta = { baseYear, version };

  // 1. 양도차익 = 양도가액 − 취득가액 − 필요경비 (요구사항 2.1)
  const transferGain = round(
    input.transferPrice - input.acquisitionPrice - input.necessaryExpense,
  );

  // 2. 1세대1주택 비과세 판정 (요구사항 2.2)
  const exemption = evaluateExemption(input, rateData);
  if (exemption.isExempt) {
    return buildExemptResult(input, transferGain, exemption.basis, basisMeta);
  }

  // 3. 1세대1주택 & 양도가액 > 12억 시 과세 양도차익 안분 (요구사항 2.3)
  const taxableTransferGain = computeTaxableTransferGain(
    input,
    transferGain,
    rateData,
  );

  // 4. 장기보유특별공제 (요구사항 2.4)
  const ltd = computeLongTermDeduction(input, taxableTransferGain, rateData);

  // 5. 과세표준 = 과세 양도차익 − 장특공제 − 기본공제 (음수 시 0) (요구사항 2.5)
  const basicDeduction = rateData.basicDeductionAmount;
  const taxBase = Math.max(
    0,
    round(taxableTransferGain - ltd.longTermDeduction - basicDeduction),
  );

  // 6. 세율 적용: 단기 > 중과 > 기본 우선순위 (요구사항 2.6, 2.7, 2.8)
  const rateApp = applyRate(input, taxBase, rateData);
  if (!rateApp) {
    // 기본세율 구간 미존재 등 산출 불가 (요구사항 2.11) — 입력 보존
    return {
      ok: false,
      code: TRANSFER_TAX_RATE_NOT_FOUND_CODE,
      message:
        '입력하신 조건(과세표준·주택 수·보유기간·조정대상지역)에 해당하는 양도소득세율을 기준표에서 찾을 수 없어 세액을 산출할 수 없습니다. 입력값을 확인해 주세요.',
      preservedInput: input,
    };
  }

  // 7. 지방소득세 = 양도소득세 × 10% (요구사항 2.9)
  const localIncomeTax = round(rateApp.transferIncomeTax * rateData.localIncomeTaxRate);

  const detail: TransferTaxDetail = {
    transferGain,
    taxableTransferGain,
    longTermDeduction: ltd.longTermDeduction,
    longTermDeductionTable: ltd.table,
    basicDeduction,
    taxBase,
    appliedRateType: rateApp.appliedRateType,
    appliedRate: rateApp.appliedRate,
    progressiveDeduction: rateApp.progressiveDeduction,
    transferIncomeTax: rateApp.transferIncomeTax,
    localIncomeTax,
    isExempt: false,
  };

  // 8. 항목별 세부 내역 + 근거 (요구사항 2.10)
  const lineItems: LineItem[] = [
    {
      name: '양도소득세',
      amount: rateApp.transferIncomeTax,
      basis: basis(rateApp.formula, rateApp.rateTableItem, basisMeta, {
        appliedRate: rateApp.appliedRate,
        taxBase,
      }),
    },
    {
      name: '지방소득세',
      amount: localIncomeTax,
      basis: basis(
        '지방소득세 = 양도소득세 × 지방소득세율',
        `지방소득세율 (${rateData.localIncomeTaxRate})`,
        basisMeta,
        { appliedRate: rateData.localIncomeTaxRate, taxBase: rateApp.transferIncomeTax },
      ),
    },
  ];

  // 9. 총액 = 항목별 내역 합산 (Property 9와 동일 불변식)
  const total = round(lineItems.reduce((sum, item) => sum + item.amount, 0));

  const result: TransferTaxResult = {
    calculatorType: 'transfer_tax',
    total,
    lineItems,
    detail,
    baseYear,
    rateTableVersion: version,
    disclaimer: TRANSFER_TAX_DISCLAIMER,
  };

  return { ok: true, result };
}

/* ------------------------------------------------------------------ */
/* 내부 판정/조회/보조 함수                                              */
/* ------------------------------------------------------------------ */

/**
 * 비과세 판정 결과.
 */
interface ExemptionResolution {
  /** 비과세 여부 */
  isExempt: boolean;
  /** 비과세 근거 (인정 시) */
  basis?: string;
}

/**
 * 1세대1주택 비과세 여부를 판정한다(요구사항 2.2).
 *
 * 1세대1주택이면서 (1) 2년 이상 보유, (2) 조정대상지역인 경우 2년 이상 거주,
 * (3) 양도가액이 비과세 상한(oneHouseExemptionThreshold, 12억) 이하를 모두 충족하면
 * 비과세로 판정하고 근거를 반환한다. 하나라도 미충족이면 과세 대상이다.
 *
 * @param input - 양도세 계산 입력
 * @param rateData - 양도세 기준표 데이터
 * @returns 비과세 판정 결과
 */
function evaluateExemption(
  input: TransferTaxInput,
  rateData: TransferRateData,
): ExemptionResolution {
  if (!input.isSingleHouseholdOneHouse) {
    return { isExempt: false };
  }

  const heldEnough = input.holdingPeriod >= 2;
  const residedEnough = !input.isAdjustmentArea || input.residencePeriod >= 2;
  const underThreshold =
    input.transferPrice <= rateData.oneHouseExemptionThreshold;

  if (heldEnough && residedEnough && underThreshold) {
    return {
      isExempt: true,
      basis: `1세대1주택 비과세 요건 충족 (보유 ${input.holdingPeriod}년 ≥ 2년${
        input.isAdjustmentArea ? `, 조정지역 거주 ${input.residencePeriod}년 ≥ 2년` : ''
      }, 양도가액 ≤ 비과세 상한 ${rateData.oneHouseExemptionThreshold}원)`,
    };
  }

  return { isExempt: false };
}

/**
 * 1세대1주택 & 양도가액 > 12억 시 과세 대상 양도차익을 안분한다(요구사항 2.3).
 *
 * 과세 양도차익 = 양도차익 × (양도가액 − 12억) ÷ 양도가액.
 * 그 외의 경우 양도차익 전액이 과세 대상이다. 양도가액이 0 이하이면 안분이 불가능하므로
 * 양도차익 전액을 반환한다(방어적 처리).
 *
 * @param input - 양도세 계산 입력
 * @param transferGain - 양도차익
 * @param rateData - 양도세 기준표 데이터
 * @returns 과세 대상 양도차익
 */
function computeTaxableTransferGain(
  input: TransferTaxInput,
  transferGain: number,
  rateData: TransferRateData,
): number {
  const threshold = rateData.oneHouseExemptionThreshold;
  const shouldApportion =
    input.isSingleHouseholdOneHouse &&
    input.transferPrice > threshold &&
    input.transferPrice > 0;

  if (!shouldApportion) {
    return transferGain;
  }

  const ratio = (input.transferPrice - threshold) / input.transferPrice;
  return round(transferGain * ratio);
}

/**
 * 장기보유특별공제 산출 결과.
 */
interface LongTermDeductionResolution {
  /** 공제액 */
  longTermDeduction: number;
  /** 적용 표 (표1/표2/없음) */
  table: TransferTaxDetail['longTermDeductionTable'];
}

/**
 * 장기보유특별공제를 산출한다(요구사항 2.4).
 *
 * 1세대1주택이면 표1(보유+거주 기준), 그 외 일반은 표2(보유 기준)를 사용한다.
 * 표1은 보유기간과 거주기간 중 작은 값으로, 표2는 보유기간으로 minYears 구간을 조회하며,
 * 공제액 = 과세 양도차익 × 공제율. 과세 양도차익이 0 이하이거나 구간이 없으면 공제 0.
 *
 * @param input - 양도세 계산 입력
 * @param taxableTransferGain - 과세 대상 양도차익
 * @param rateData - 양도세 기준표 데이터
 * @returns 공제액과 적용 표
 */
function computeLongTermDeduction(
  input: TransferTaxInput,
  taxableTransferGain: number,
  rateData: TransferRateData,
): LongTermDeductionResolution {
  if (taxableTransferGain <= 0) {
    return { longTermDeduction: 0, table: 'none' };
  }

  const useTable1 = input.isSingleHouseholdOneHouse;
  const rows = useTable1
    ? rateData.longTermDeductionTable1
    : rateData.longTermDeductionTable2;

  // 표1은 보유·거주 요건이므로 두 기간 중 작은 값으로 구간을 조회한다.
  const lookupYears = useTable1
    ? Math.min(input.holdingPeriod, input.residencePeriod)
    : input.holdingPeriod;

  const row = findDeductionRow(lookupYears, rows);
  if (!row) {
    return { longTermDeduction: 0, table: useTable1 ? 'table1' : 'table2' };
  }

  const longTermDeduction = round(taxableTransferGain * row.deductionRate);
  return { longTermDeduction, table: useTable1 ? 'table1' : 'table2' };
}

/**
 * 세율을 적용하여 산출세액을 계산한다(요구사항 2.6, 2.7, 2.8).
 *
 * 우선순위: 단기보유(1년 미만 70% / 1~2년 60%) > 다주택 조정지역 중과(기본세율 + 가산)
 * > 기본세율(누진, 산출세액 = 과세표준 × 세율 − 누진공제). 기본세율 구간을 찾지 못하면
 * (중과·기본 경로에서) undefined를 반환한다.
 *
 * @param input - 양도세 계산 입력
 * @param taxBase - 과세표준
 * @param rateData - 양도세 기준표 데이터
 * @returns 세율 적용 결과, 기본세율 구간 미존재 시 undefined
 */
function applyRate(
  input: TransferTaxInput,
  taxBase: number,
  rateData: TransferRateData,
): RateApplication | undefined {
  // 우선순위 1: 단기보유 중과세율 (요구사항 2.7)
  const shortTermRate = resolveShortTermRate(input.holdingPeriod, rateData);
  if (shortTermRate !== undefined) {
    return {
      appliedRateType: 'short_term',
      appliedRate: shortTermRate.rate,
      progressiveDeduction: 0,
      transferIncomeTax: round(taxBase * shortTermRate.rate),
      formula: '양도소득세 = 과세표준 × 단기보유 중과세율',
      rateTableItem: `단기보유 세율 (${shortTermRate.label}, 요율=${shortTermRate.rate})`,
    };
  }

  // 기본세율 구간 조회 (중과·기본 공통)
  const bracket = findProgressiveBracket(taxBase, rateData.basicRateBrackets);
  if (!bracket) {
    return undefined;
  }

  // 우선순위 2: 다주택 조정지역 중과 (요구사항 2.8)
  const surcharge = resolveHeavyMultiSurcharge(input, rateData);
  if (surcharge !== undefined) {
    const appliedRate = bracket.rate + surcharge.surcharge;
    // 중과 시 누진공제는 기본세율 구간 기준을 그대로 적용한다.
    const transferIncomeTax = Math.max(
      0,
      round(taxBase * appliedRate - bracket.progressiveDeduction),
    );
    return {
      appliedRateType: 'heavy_multi',
      appliedRate,
      progressiveDeduction: bracket.progressiveDeduction,
      transferIncomeTax,
      formula:
        '양도소득세 = 과세표준 × (기본세율 + 중과가산) − 누진공제',
      rateTableItem: `기본세율 구간(요율=${bracket.rate}) + 다주택 중과가산(${surcharge.label}, +${surcharge.surcharge})`,
    };
  }

  // 우선순위 3: 기본세율(누진) (요구사항 2.6)
  const transferIncomeTax = Math.max(
    0,
    round(taxBase * bracket.rate - bracket.progressiveDeduction),
  );
  return {
    appliedRateType: 'basic',
    appliedRate: bracket.rate,
    progressiveDeduction: bracket.progressiveDeduction,
    transferIncomeTax,
    formula: '양도소득세 = 과세표준 × 기본세율 − 누진공제',
    rateTableItem: `기본세율 누진 구간 (요율=${bracket.rate}, 누진공제=${bracket.progressiveDeduction})`,
  };
}

/**
 * 단기보유 중과세율을 판정한다(요구사항 2.7).
 *
 * 보유기간 1년 미만이면 under1Year(70%), 1년 이상 2년 미만이면 from1To2Year(60%)를
 * 반환한다. 2년 이상이면 단기 중과에 해당하지 않으므로 undefined를 반환한다.
 *
 * @param holdingPeriod - 보유기간(년)
 * @param rateData - 양도세 기준표 데이터
 * @returns 단기 세율과 라벨, 미해당 시 undefined
 */
function resolveShortTermRate(
  holdingPeriod: number,
  rateData: TransferRateData,
): { rate: number; label: string } | undefined {
  if (holdingPeriod < 1) {
    return { rate: rateData.shortTermRates.under1Year, label: '1년 미만' };
  }
  if (holdingPeriod < 2) {
    return { rate: rateData.shortTermRates.from1To2Year, label: '1년 이상 2년 미만' };
  }
  return undefined;
}

/**
 * 다주택 조정지역 중과 가산율을 판정한다(요구사항 2.8).
 *
 * 조정대상지역이면서 주택 수가 2주택이면 twoHouse(+20%p), 3주택 이상이면
 * threeOrMoreHouse(+30%p) 가산을 반환한다. 1주택이거나 비조정지역이면 undefined.
 *
 * @param input - 양도세 계산 입력
 * @param rateData - 양도세 기준표 데이터
 * @returns 가산율과 라벨, 미해당 시 undefined
 */
function resolveHeavyMultiSurcharge(
  input: TransferTaxInput,
  rateData: TransferRateData,
): { surcharge: number; label: string } | undefined {
  if (!input.isAdjustmentArea) {
    return undefined;
  }
  if (input.housingCount === 'two') {
    return {
      surcharge: rateData.heavyMultiSurcharge.twoHouse,
      label: '2주택',
    };
  }
  if (input.housingCount === 'three_or_more') {
    return {
      surcharge: rateData.heavyMultiSurcharge.threeOrMoreHouse,
      label: '3주택 이상',
    };
  }
  return undefined;
}

/**
 * 장기보유특별공제 표에서 보유(및 거주) 연수 구간을 조회한다.
 *
 * minYears ≤ years < maxYears(maxYears 미지정 시 초과)를 만족하는 행을 반환한다.
 *
 * @param years - 조회 대상 연수
 * @param rows - 장기보유특별공제 표 행 목록
 * @returns 일치 행, 없으면 undefined
 */
function findDeductionRow(
  years: number,
  rows: LongTermDeductionRow[],
): LongTermDeductionRow | undefined {
  return rows.find((r) => inRange(years, r.minYears, r.maxYears));
}

/**
 * 기본세율 누진 구간을 과세표준으로 조회한다(요구사항 2.6).
 *
 * minTaxBase ≤ taxBase < maxTaxBase(maxTaxBase 미지정 시 초과)를 만족하는 구간을
 * 반환한다.
 *
 * @param taxBase - 과세표준
 * @param brackets - 누진세율 구간 목록
 * @returns 일치 구간, 없으면 undefined
 */
function findProgressiveBracket(
  taxBase: number,
  brackets: ProgressiveBracket[],
): ProgressiveBracket | undefined {
  return brackets.find((b) => inRange(taxBase, b.minTaxBase, b.maxTaxBase));
}

/**
 * 비과세 판정 시 결과 봉투를 생성한다(요구사항 2.2).
 *
 * 세액을 0으로 산출하고 비과세 판정·근거를 상세에 담는다. 항목별 내역에도 0원
 * 양도소득세·지방소득세를 근거와 함께 포함하여 결과 구조 완전성을 유지한다.
 *
 * @param input - 양도세 계산 입력
 * @param transferGain - 양도차익
 * @param exemptionBasis - 비과세 근거
 * @param basisMeta - 기준연도·버전 메타데이터
 * @returns 비과세 계산 결과(성공)
 */
function buildExemptResult(
  input: TransferTaxInput,
  transferGain: number,
  exemptionBasis: string | undefined,
  basisMeta: { baseYear: number; version: string },
): TransferTaxCalculationSuccess {
  const detail: TransferTaxDetail = {
    transferGain,
    taxableTransferGain: 0,
    longTermDeduction: 0,
    longTermDeductionTable: 'none',
    basicDeduction: 0,
    taxBase: 0,
    appliedRateType: 'basic',
    appliedRate: 0,
    progressiveDeduction: 0,
    transferIncomeTax: 0,
    localIncomeTax: 0,
    isExempt: true,
    ...(exemptionBasis ? { exemptionBasis } : {}),
  };

  const lineItems: LineItem[] = [
    {
      name: '양도소득세',
      amount: 0,
      basis: basis(
        '1세대1주택 비과세로 양도소득세 없음',
        exemptionBasis ?? '1세대1주택 비과세 요건 충족',
        basisMeta,
        { appliedRate: 0, taxBase: 0 },
      ),
    },
    {
      name: '지방소득세',
      amount: 0,
      basis: basis(
        '비과세로 지방소득세 없음',
        '1세대1주택 비과세',
        basisMeta,
        { appliedRate: 0, taxBase: 0 },
      ),
    },
  ];

  const result: TransferTaxResult = {
    calculatorType: 'transfer_tax',
    total: 0,
    lineItems,
    detail,
    baseYear: basisMeta.baseYear,
    rateTableVersion: basisMeta.version,
    disclaimer: TRANSFER_TAX_DISCLAIMER,
  };

  return { ok: true, result };
}

/**
 * 값이 [min, max) 구간에 속하는지 판정한다.
 *
 * max가 미지정이면 min 이상(초과 구간)으로 처리한다.
 *
 * @param value - 대상 값
 * @param min - 구간 하한 (이상)
 * @param max - 구간 상한 (미만), 미지정 시 상한 없음
 * @returns 구간 포함 여부
 */
function inRange(value: number, min: number, max?: number): boolean {
  if (value < min) {
    return false;
  }
  if (max === undefined) {
    return true;
  }
  return value < max;
}

/**
 * 계산 근거(CalculationBasis)를 생성한다.
 *
 * @param formula - 적용 산식
 * @param rateTableItem - 참조 기준표 항목
 * @param meta - 기준연도·버전 메타데이터
 * @param extra - 적용 요율/과세표준 등 추가 정보
 * @returns 계산 근거
 */
function basis(
  formula: string,
  rateTableItem: string,
  meta: { baseYear: number; version: string },
  extra: { appliedRate?: number; taxBase?: number } = {},
): CalculationBasis {
  return {
    formula,
    rateTableItem,
    baseYear: meta.baseYear,
    rateTableVersion: meta.version,
    ...(extra.appliedRate !== undefined ? { appliedRate: extra.appliedRate } : {}),
    ...(extra.taxBase !== undefined ? { taxBase: extra.taxBase } : {}),
  };
}

/**
 * 원 단위 반올림.
 *
 * 결정론적 계산의 일관성을 위해 모든 금액 항목을 정수(원) 단위로 반올림한다.
 *
 * @param value - 반올림 대상 값
 * @returns 반올림된 정수 금액
 */
function round(value: number): number {
  return Math.round(value);
}
