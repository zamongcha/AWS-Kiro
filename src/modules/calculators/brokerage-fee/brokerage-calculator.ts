/**
 * 중개수수료 계산기 순수 계산 로직 (brokerage-fee)
 *
 * 임대차 거래금액 환산(100/70배)·상한 요율 구간 조회·한도액 min 적용·오피스텔 전용
 * 요율을 반영하여 중개보수를 산출하는 결정론적 순수 함수를 제공한다. 외부 AI/네트워크
 * 호출 없이 동일 입력에 대해 항상 동일한 출력을 반환한다(참조 투명성, Property 1).
 *
 * 계산 로직은 기준표(rateData)를 인자로 주입받아 상수 테이블과 분리되며, 요율 개정 시
 * 기준표만 교체하면 로직 변경 없이 새 기준연도를 지원한다.
 *
 * @requirements 3.1 - 임대차 거래금액 환산: 1차 보증금 + 월세×100, <5천만원 시 ×70 재산정
 * @requirements 3.2 - 매매/교환 시 매매가액을 거래금액으로 사용
 * @requirements 3.3 - 오피스텔 요건 충족 시 오피스텔 전용 상한 요율 적용
 * @requirements 3.4 - 거래유형/물건유형/거래금액 구간별 상한 요율 조회
 * @requirements 3.5 - 중개보수 = min(거래금액 × 상한요율, 한도액)(한도액 존재 시)
 * @requirements 3.6 - 결과에 산정 거래금액·적용 구간·상한 요율·한도액·상한액·협의/VAT/조례 안내 포함
 * @requirements 3.7 - 기준연도·버전 포함
 * @requirements 3.8 - 조건 요율 미존재 시 산출 불가 오류 반환 + 입력 보존
 */

import type {
  BrokerageFeeDetail,
  BrokerageFeeInput,
  BrokerageFeeResult,
} from '../interfaces/brokerage-fee.js';
import type {
  BrokerageRateBracket,
  BrokerageRateData,
} from '../interfaces/rate-tables.js';
import type { BrokeragePropertyType } from '../interfaces/types.js';
import type { CalculationBasis, LineItem } from '../interfaces/result.js';

/**
 * 중개수수료 계산 결과 면책 고지 문구.
 *
 * 중개보수는 상한 요율 기준의 상한액이며 실제 보수는 개업공인중개사와의 협의로
 * 정해지고, 부가가치세(VAT)는 별도이며 지역 조례에 따라 요율·한도가 달라질 수 있음을
 * 안내한다(요구사항 3.6, 5.5).
 */
export const BROKERAGE_DISCLAIMER =
  '본 계산은 참고용 추정치이며, 산출된 중개보수는 법정 상한 요율에 따른 상한액입니다. 실제 중개보수는 개업공인중개사와의 협의로 정해질 수 있고, 부가가치세(VAT)는 별도이며, 시·도 조례에 따라 요율 및 한도액이 달라질 수 있습니다. 정확한 금액은 관할 지역 조례 및 개업공인중개사를 통해 확인하시기 바랍니다.';

/** 중개보수는 협의 가능하다는 안내 문구(요구사항 3.6) */
export const BROKERAGE_NEGOTIABLE_NOTICE =
  '중개보수는 산출된 상한액 범위 내에서 개업공인중개사와 협의하여 정할 수 있습니다.';

/** 부가가치세 별도 안내 문구(요구사항 3.6) */
export const BROKERAGE_VAT_NOTICE = '중개보수에는 부가가치세(VAT)가 별도로 부과될 수 있습니다.';

/** 지역 조례 안내 문구(요구사항 3.6) */
export const BROKERAGE_LOCAL_ORDINANCE_NOTICE =
  '중개보수 상한 요율 및 한도액은 시·도 조례에 따라 달라질 수 있으므로 관할 지역 조례를 확인하시기 바랍니다.';

/** 조건 요율 미존재 오류 코드(요구사항 3.8) */
export const BROKERAGE_RATE_NOT_FOUND_CODE = 'BROKERAGE_RATE_NOT_FOUND';

/** 임대차/매매 공통 거래금액 산정 불가 오류 코드(입력 누락 등) */
export const BROKERAGE_TRANSACTION_AMOUNT_INVALID_CODE = 'BROKERAGE_TRANSACTION_AMOUNT_INVALID';

/**
 * 중개수수료 산출 성공 결과.
 */
export interface BrokerageCalculationSuccess {
  ok: true;
  /** 표준 계산 결과 봉투 */
  result: BrokerageFeeResult;
}

/**
 * 중개수수료 산출 실패 결과(조건 요율 미존재 등).
 *
 * 계산을 수행하지 않고 오류 코드·메시지와 함께 원본 입력을 보존한다(요구사항 3.8).
 */
export interface BrokerageCalculationFailure {
  ok: false;
  /** 오류 코드 */
  code: string;
  /** 사용자 안내 메시지 */
  message: string;
  /** 보존된 원본 입력 */
  preservedInput: BrokerageFeeInput;
}

/**
 * 중개수수료 산출 결과(성공 | 실패).
 */
export type BrokerageCalculationOutcome =
  | BrokerageCalculationSuccess
  | BrokerageCalculationFailure;

/**
 * 중개수수료를 산출한다(결정론적 순수 함수).
 *
 * 임대차 거래는 보증금 + 월세×환산배수로 거래금액을 산정하되, 1차 환산액(×100)이
 * 재산정 기준(5천만원) 미만이면 ×70으로 재산정한다(요구사항 3.1). 매매/교환은 매매가액을
 * 거래금액으로 사용한다(요구사항 3.2). 물건 유형이 오피스텔이고 전용 요율 요건을 충족하면
 * 오피스텔 전용 요율 구간을, 아니면 주택/주택 외 요율 구간을 조회한다(요구사항 3.3). 상한
 * 요율 구간을 거래유형·물건유형·거래금액으로 조회하여 중개보수 = min(거래금액 × 상한요율,
 * 한도액)(한도액 존재 시)로 산출한다(요구사항 3.4/3.5). 조건에 해당하는 요율 구간이 없으면
 * 계산을 수행하지 않고 산출 불가 오류와 함께 입력을 보존한다(요구사항 3.8).
 *
 * @param input - 중개수수료 계산 입력
 * @param rateData - 중개수수료 기준표 데이터(상수 테이블)
 * @param baseYear - 적용 기준연도
 * @param version - 적용 기준표 버전 식별자
 * @returns 성공 시 계산 결과, 실패 시 오류·입력 보존
 */
export function calculateBrokerageFee(
  input: BrokerageFeeInput,
  rateData: BrokerageRateData,
  baseYear: number,
  version: string,
): BrokerageCalculationOutcome {
  const basisMeta = { baseYear, version };

  // 1. 거래금액 산정 (임대차 환산 또는 매매가액)
  const amountResolution = resolveTransactionAmount(input, rateData);
  if (!amountResolution.ok) {
    return {
      ok: false,
      code: amountResolution.code,
      message: amountResolution.message,
      preservedInput: input,
    };
  }
  const { transactionAmount, conversionMultiplier } = amountResolution;

  // 2. 오피스텔 전용 요율 적용 여부 판정 (요구사항 3.3)
  const usedOfficetelRate =
    input.propertyType === 'officetel' && input.officetelQualified === true;

  // 요율 구간 조회 시 사용할 물건 유형: 오피스텔 요건 충족 시 'officetel',
  // 아니면 입력 물건 유형(주택/주택 외)을 그대로 사용한다.
  const lookupPropertyType: BrokeragePropertyType = usedOfficetelRate
    ? 'officetel'
    : input.propertyType;

  // 3. 상한 요율 구간 조회 (거래유형/물건유형/거래금액 구간별, 요구사항 3.4)
  const bracket = findBrokerageRateBracket(
    input.transactionType,
    lookupPropertyType,
    transactionAmount,
    rateData.rateBrackets,
  );
  if (!bracket) {
    return {
      ok: false,
      code: BROKERAGE_RATE_NOT_FOUND_CODE,
      message:
        '입력하신 조건(거래 유형·물건 유형·거래금액)에 해당하는 중개보수 상한 요율을 기준표에서 찾을 수 없어 중개보수를 산출할 수 없습니다. 입력값을 확인해 주세요.',
      preservedInput: input,
    };
  }

  // 4. 중개보수 = min(거래금액 × 상한요율, 한도액)(한도액 존재 시) (요구사항 3.5)
  const rawFee = round(transactionAmount * bracket.upperRate);
  const brokerageFeeUpperLimit =
    bracket.capAmount !== undefined ? Math.min(rawFee, bracket.capAmount) : rawFee;

  const appliedBracket = describeBracket(bracket);

  const detail: BrokerageFeeDetail = {
    transactionAmount,
    ...(conversionMultiplier !== undefined ? { conversionMultiplier } : {}),
    appliedBracket,
    upperRate: bracket.upperRate,
    ...(bracket.capAmount !== undefined ? { capAmount: bracket.capAmount } : {}),
    brokerageFeeUpperLimit,
    usedOfficetelRate,
  };

  // 5. 항목별 세부 내역 + 근거 (요구사항 3.6/3.7)
  const lineItems: LineItem[] = [
    {
      name: '중개보수',
      amount: brokerageFeeUpperLimit,
      basis: basis(
        bracket.capAmount !== undefined
          ? '중개보수 상한액 = min(거래금액 × 상한요율, 한도액)'
          : '중개보수 상한액 = 거래금액 × 상한요율',
        `중개보수 상한 요율 구간 (${appliedBracket})`,
        basisMeta,
        { appliedRate: bracket.upperRate, taxBase: transactionAmount },
      ),
    },
  ];

  // 6. 총액 = 중개보수 상한액 (Property 9 · 항목 합산)
  const total = round(lineItems.reduce((sum, item) => sum + item.amount, 0));

  // 협의 가능·VAT 별도·지역 조례 안내를 면책 고지에 통합 (요구사항 3.6)
  const disclaimer = `${BROKERAGE_NEGOTIABLE_NOTICE} ${BROKERAGE_VAT_NOTICE} ${BROKERAGE_LOCAL_ORDINANCE_NOTICE} ${BROKERAGE_DISCLAIMER}`;

  const result: BrokerageFeeResult = {
    calculatorType: 'brokerage',
    total,
    lineItems,
    detail,
    baseYear,
    rateTableVersion: version,
    disclaimer,
  };

  return { ok: true, result };
}

/* ------------------------------------------------------------------ */
/* 내부 조회/보조 함수                                                   */
/* ------------------------------------------------------------------ */

/**
 * 거래금액 산정 성공 결과.
 */
interface TransactionAmountSuccess {
  ok: true;
  /** 산정된 거래금액 (원) */
  transactionAmount: number;
  /** 임대차 환산 배수 (임대차 시에만 존재) */
  conversionMultiplier?: 100 | 70;
}

/**
 * 거래금액 산정 실패 결과(입력 누락 등).
 */
interface TransactionAmountFailure {
  ok: false;
  code: string;
  message: string;
}

/**
 * 거래유형에 따라 중개보수 산정 기준이 되는 거래금액을 산정한다(요구사항 3.1/3.2).
 *
 * 임대차 거래는 1차 환산액 = 보증금 + 월세 × 환산배수(기본 100)를 산정하고, 1차 환산액이
 * 재산정 기준(5천만원) 미만이면 보증금 + 월세 × 재산정배수(70)로 재산정한다. 이때 적용된
 * 환산 배수(100 또는 70)를 함께 반환한다. 매매/교환 거래는 매매가액(salePrice)을 거래금액으로
 * 사용하며 환산 배수는 반환하지 않는다. 임대차에 보증금/월세가, 매매/교환에 매매가액이
 * 없으면 산정 불가 실패를 반환한다.
 *
 * @param input - 중개수수료 계산 입력
 * @param rateData - 중개수수료 기준표 데이터(환산 배수·재산정 기준)
 * @returns 거래금액 산정 결과(성공 시 거래금액·환산배수)
 */
function resolveTransactionAmount(
  input: BrokerageFeeInput,
  rateData: BrokerageRateData,
): TransactionAmountSuccess | TransactionAmountFailure {
  if (input.transactionType === 'lease') {
    if (typeof input.deposit !== 'number' || typeof input.monthlyRent !== 'number') {
      return {
        ok: false,
        code: BROKERAGE_TRANSACTION_AMOUNT_INVALID_CODE,
        message: '임대차 거래의 중개보수 산정을 위해서는 보증금(deposit)과 월세(monthlyRent)가 필요합니다.',
      };
    }

    // 1차 환산액 = 보증금 + 월세 × 환산배수(100)
    const primary = input.deposit + input.monthlyRent * rateData.leaseConversionMultiplier;

    // 1차 환산액이 재산정 기준(5천만원) 미만이면 ×70으로 재산정 (요구사항 3.1)
    if (primary < rateData.leaseConversionThreshold) {
      const fallback =
        input.deposit + input.monthlyRent * rateData.leaseConversionFallbackMultiplier;
      return {
        ok: true,
        transactionAmount: round(fallback),
        conversionMultiplier: rateData.leaseConversionFallbackMultiplier as 70,
      };
    }

    return {
      ok: true,
      transactionAmount: round(primary),
      conversionMultiplier: rateData.leaseConversionMultiplier as 100,
    };
  }

  // 매매/교환: 매매가액을 거래금액으로 사용 (요구사항 3.2)
  if (typeof input.salePrice !== 'number') {
    return {
      ok: false,
      code: BROKERAGE_TRANSACTION_AMOUNT_INVALID_CODE,
      message: '매매/교환 거래의 중개보수 산정을 위해서는 매매가액(salePrice)이 필요합니다.',
    };
  }

  return { ok: true, transactionAmount: round(input.salePrice) };
}

/**
 * 상한 요율 구간을 거래유형·물건유형·거래금액으로 조회한다(요구사항 3.4).
 *
 * transactionType/propertyType이 일치하고, minAmount ≤ 거래금액 < maxAmount
 * (maxAmount 미지정 시 초과)를 만족하는 구간을 반환한다. 일치하는 구간이 없으면
 * undefined를 반환한다.
 *
 * @param transactionType - 거래 유형
 * @param propertyType - 물건 유형(오피스텔 요건 충족 시 'officetel')
 * @param transactionAmount - 산정된 거래금액
 * @param brackets - 상한 요율 구간 목록
 * @returns 일치하는 요율 구간, 없으면 undefined
 */
function findBrokerageRateBracket(
  transactionType: BrokerageFeeInput['transactionType'],
  propertyType: BrokeragePropertyType,
  transactionAmount: number,
  brackets: BrokerageRateBracket[],
): BrokerageRateBracket | undefined {
  return brackets.find((b) => {
    if (b.transactionType !== transactionType || b.propertyType !== propertyType) {
      return false;
    }
    return inAmountRange(transactionAmount, b.minAmount, b.maxAmount);
  });
}

/**
 * 요율 구간의 설명 문자열을 생성한다(결과 detail.appliedBracket 및 근거 표기용).
 *
 * @param bracket - 상한 요율 구간
 * @returns 구간 설명 문자열
 */
function describeBracket(bracket: BrokerageRateBracket): string {
  const upper = bracket.maxAmount !== undefined ? `${bracket.maxAmount}원 미만` : '초과';
  const cap = bracket.capAmount !== undefined ? `, 한도액=${bracket.capAmount}원` : '';
  return `거래유형=${bracket.transactionType}, 물건유형=${bracket.propertyType}, 거래금액 ${bracket.minAmount}원 이상 ${upper}, 상한요율=${bracket.upperRate}${cap}`;
}

/**
 * 금액이 [min, max) 구간에 속하는지 판정한다.
 *
 * max가 미지정이면 min 이상(초과 구간)으로 처리한다.
 *
 * @param value - 대상 금액
 * @param min - 구간 하한 (이상)
 * @param max - 구간 상한 (미만), 미지정 시 상한 없음
 * @returns 구간 포함 여부
 */
function inAmountRange(value: number, min: number, max?: number): boolean {
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
