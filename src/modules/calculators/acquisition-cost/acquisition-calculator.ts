/**
 * 취득비용 계산기 순수 계산 로직 (acquisition-cost)
 *
 * 취득세·지방교육세·농어촌특별세·국민주택채권 매입액·법무사 수수료·인지세 및
 * 감면 내역을 법정 기준표(AcquisitionRateData)에 근거하여 산출하는 결정론적
 * 순수 함수를 제공한다. 외부 AI/네트워크 호출 없이 동일 입력에 대해 항상 동일한
 * 출력을 반환한다(참조 투명성, Property 1).
 *
 * 계산 로직은 기준표(rateData)를 인자로 주입받아 상수 테이블과 분리되며, 세법·요율
 * 개정 시 기준표만 교체하면 로직 변경 없이 새 기준연도를 지원한다.
 *
 * @requirements 1.1 - 조건별 취득세율 조회 및 취득세 산출
 * @requirements 1.2 - 지방교육세 = 취득세 × 지방교육세율
 * @requirements 1.3 - 전용면적 > 85㎡ 시 농어촌특별세 산출
 * @requirements 1.4 - 공시가격 기준 국민주택채권 매입액 산출
 * @requirements 1.5 - 법무사 등기 대행 선택 시 법무사 수수료 산출
 * @requirements 1.6 - 취득가액 구간별 인지세 산출
 * @requirements 1.7 - 감면 유형별 감면 후 취득세 산출 및 감면 내역 별도 표시
 * @requirements 1.8 - 장기임대사업자 면적 구간·취득 요건별 차등 감면율 적용
 * @requirements 1.9 - 장기임대사업자 사후관리 요건 안내 포함
 * @requirements 1.10 - 항목 합산 총 취득비용 및 항목별 세부 내역 반환
 * @requirements 1.11 - 각 항목에 적용 세율/요율·과세표준·기준표 버전·기준연도 명시
 * @requirements 1.12 - 조건 세율 미존재 시 산출 불가 오류 반환 + 입력 보존
 * @requirements 1.13 - 신축 등 공시가격(시가표준액) 미정 시 취득세는 취득가액 기준으로 산출하고
 *                      국민주택채권은 0 처리 + 시가표준액 확인 안내 포함
 * @requirements 1.14 - 공시가격(시가표준액) 1억원 이하 주택은 다주택이어도 중과 제외, 기본세율 적용
 */

import type {
  AcquisitionCostDetail,
  AcquisitionCostInput,
  AcquisitionCostResult,
  ReductionDetail,
  RentalReductionCondition,
} from '../interfaces/acquisition-cost.js';
import type {
  AcquisitionRateData,
  AcquisitionReduction,
  AcquisitionTaxBracket,
  HousingBondBracket,
  RentalDifferentialRate,
  ScrivenerFeeBracket,
  StampTaxBracket,
} from '../interfaces/rate-tables.js';
import type { CalculationBasis, LineItem } from '../interfaces/result.js';
import type { NonHouseType } from '../interfaces/types.js';

/**
 * 취득비용 계산 결과 면책 고지 문구.
 *
 * 참고용 추정치이며 실제 세액·수수료는 개별 상황·지역 조례·최신 세법에 따라
 * 달라질 수 있음을 안내한다(요구사항 5.5).
 */
export const ACQUISITION_DISCLAIMER =
  '본 계산은 참고용 추정치이며, 실제 취득세·부대비용은 개별 상황, 지역 조례, 최신 세법 및 감면 요건 충족 여부에 따라 달라질 수 있습니다. 정확한 세액은 관할 세무서·지방자치단체 또는 전문가 상담을 통해 확인하시기 바랍니다.';

/** 조건 세율 미존재 오류 코드(요구사항 1.12) */
export const ACQUISITION_RATE_NOT_FOUND_CODE = 'ACQUISITION_RATE_NOT_FOUND';

/**
 * 공시가격(시가표준액) 미입력 시 국민주택채권 미산출 안내 문구(요구사항 1.13).
 *
 * 신축 주택 등 공시가격이 아직 정해지지 않은 경우 국민주택채권 매입액은 산출하지 않으며,
 * 별도 시가표준액 확인이 필요함을 안내한다.
 */
export const OFFICIAL_PRICE_MISSING_BOND_NOTICE =
  '신축도 국민주택채권 매입 의무가 있으나, 신축 시가표준액이 자동 조회되지 않아 이 계산기에서는 채권 매입액을 산출하지 못했습니다. 시가표준액(또는 예상 공시가격)을 공시가격 칸에 입력하시면 국민주택채권 매입액이 계산됩니다.';

/**
 * 공시가격 1억원 이하 다주택 중과 제외 특례 적용 안내 문구(요구사항 1.14).
 */
export const LOW_VALUE_EXEMPTION_APPLIED_NOTICE =
  '공시가격(시가표준액) 1억원 이하 주택으로 다주택 중과세율 대신 기본세율을 적용했습니다. (공시가격 1억원 이하 다주택 중과 제외 특례)';

/**
 * 공시가격 미입력·다주택 시 1억 이하 특례 판정 불가 안내 문구(요구사항 1.13/1.14).
 *
 * 공시가격이 없으면 1억원 이하 특례 판정이 불가하므로 취득가액 기준 통상 세율을 적용하되,
 * 공시가격 확인 시 1억원 이하이면 중과에서 제외될 수 있음을 안내한다.
 */
export const LOW_VALUE_EXEMPTION_UNKNOWN_NOTICE =
  '공시가격(시가표준액) 미입력으로 1억원 이하 다주택 중과 제외 특례 적용 여부를 판정할 수 없어 통상 세율을 적용했습니다. 공시가격 확인 시 1억원 이하이면 중과에서 제외될 수 있습니다.';

/**
 * 최소납부세제 적용 안내 문구(지방세특례제한법 제177조의2).
 *
 * 감면대상세액이 최소납부세제 임계값을 초과하여 초과분의 일부만 감면되고 나머지를 납부하게
 * 된 경우 계산 결과에 포함한다.
 */
export const MINIMUM_PAYMENT_APPLIED_NOTICE =
  '감면세액이 최소납부세제 임계값(200만원)을 초과하여 최소납부세제(지방세특례제한법 제177조의2)가 적용되었습니다. 임계값 초과분의 85%만 감면되고 나머지 15%와 임계값 상당액은 납부합니다. 따라서 전액 감면(면제) 대상이라도 일부 취득세가 발생합니다.';

/**
 * 취득비용 산출 성공 결과.
 */
export interface AcquisitionCalculationSuccess {
  ok: true;
  /** 표준 계산 결과 봉투 */
  result: AcquisitionCostResult;
}

/**
 * 취득비용 산출 실패 결과(조건 세율 미존재 등).
 *
 * 계산을 수행하지 않고 오류 코드·메시지와 함께 원본 입력을 보존한다(요구사항 1.12).
 */
export interface AcquisitionCalculationFailure {
  ok: false;
  /** 오류 코드 */
  code: string;
  /** 사용자 안내 메시지 */
  message: string;
  /** 보존된 원본 입력 */
  preservedInput: AcquisitionCostInput;
}

/**
 * 취득비용 산출 결과(성공 | 실패).
 */
export type AcquisitionCalculationOutcome =
  | AcquisitionCalculationSuccess
  | AcquisitionCalculationFailure;

/**
 * 취득비용을 산출한다(결정론적 순수 함수).
 *
 * 주입받은 기준표(rateData)와 기준연도·버전 메타데이터에 근거하여 취득세·지방교육세·
 * 농어촌특별세·국민주택채권 매입액·법무사 수수료·인지세를 산출하고, 감면 유형이 있으면
 * 감면 후 취득세와 감면 내역을 별도로 계산한다. 조건에 해당하는 취득세율이 기준표에
 * 존재하지 않으면 계산을 수행하지 않고 산출 불가 오류와 함께 입력을 보존한다.
 *
 * @param input - 취득비용 계산 입력
 * @param rateData - 취득세 기준표 데이터(상수 테이블)
 * @param baseYear - 적용 기준연도
 * @param version - 적용 기준표 버전 식별자
 * @returns 성공 시 계산 결과, 실패 시 오류·입력 보존
 */
export function calculateAcquisitionCost(
  input: AcquisitionCostInput,
  rateData: AcquisitionRateData,
  baseYear: number,
  version: string,
): AcquisitionCalculationOutcome {
  const notices: string[] = [];

  // 공시가격(시가표준액) 입력 여부 판정. 신축 등 미정 케이스는 undefined로 들어온다(요구사항 1.13).
  const hasOfficialPrice =
    typeof input.officialPrice === 'number' && input.officialPrice >= 0;
  const officialPrice = hasOfficialPrice ? (input.officialPrice as number) : undefined;

  // 0. 공시가격 1억원 이하 다주택 중과 제외 특례 판정 (요구사항 1.14)
  //    - 주택이면서 다주택(2주택/3주택 이상)이고, 공시가격이 임계값 이하이면 중과 대신
  //      기본세율(1주택 상당)을 적용하기 위해 세율 조회 시 housingCount를 'one'으로 대체한다.
  //    - 공시가격 미입력·다주택이면 판정 불가 → 통상 세율 적용 + 안내(요구사항 1.13).
  const isMultiHouse =
    input.propertyType === 'house' &&
    (input.housingCount === 'two' || input.housingCount === 'three_or_more');
  const lowValueExemptionApplies =
    isMultiHouse &&
    officialPrice !== undefined &&
    officialPrice <= rateData.lowValueExemptionThreshold;

  if (isMultiHouse && officialPrice === undefined) {
    // 다주택인데 공시가격이 없어 1억 이하 특례 판정 불가.
    notices.push(LOW_VALUE_EXEMPTION_UNKNOWN_NOTICE);
  }

  // 1. 취득세율 구간 조회 (주택수/조정지역/면적/취득가액 구간별)
  //    특례 적용 시 기본세율(1주택 상당) 구간을 조회하기 위해 housingCount를 'one'으로 본다.
  const bracketLookupInput: AcquisitionCostInput = lowValueExemptionApplies
    ? { ...input, housingCount: 'one' }
    : input;
  const bracket = findAcquisitionTaxBracket(
    bracketLookupInput,
    rateData.acquisitionTaxBrackets,
  );
  if (!bracket) {
    return {
      ok: false,
      code: ACQUISITION_RATE_NOT_FOUND_CODE,
      message:
        '입력하신 조건(부동산 유형·주택 수·조정대상지역·전용면적·취득가액)에 해당하는 취득세율을 기준표에서 찾을 수 없어 취득세를 산출할 수 없습니다. 입력값을 확인해 주세요.',
      preservedInput: input,
    };
  }

  if (lowValueExemptionApplies) {
    notices.push(LOW_VALUE_EXEMPTION_APPLIED_NOTICE);
  }

  const basisMeta = { baseYear, version };

  // 2. 취득세(감면 전) = 취득가액 × 세율 (요구사항 1.1)
  const acquisitionTaxBeforeReduction = round(input.purchasePrice * bracket.rate);

  // 3. 감면 적용 (요구사항 1.7~1.9, 1.16) → 감면 후 취득세 산출
  //    감면대상세액(= 감면 전 취득세 × 감면율)을 산출한 뒤, 감면 유형이 최소납부세제 대상이면
  //    지방세특례제한법 제177조의2에 따라 최소납부세제를 적용하여 최종 감면액을 조정한다.
  const reductionOutcome = resolveReduction(input, rateData);
  const reductionRate = reductionOutcome.reductionRate;
  // 최소납부세제 반영 전 감면대상세액(원래 깎아주려던 금액)
  const grossReductionAmount = round(acquisitionTaxBeforeReduction * reductionRate);

  // 최소납부세제 적용: 감면율이 0(none/미적용)이면 감면 자체가 없으므로 미적용.
  const applyMinimumPayment =
    reductionRate > 0 &&
    reductionOutcome.subjectToMinimumPayment &&
    grossReductionAmount > rateData.minimumPaymentThreshold;

  const reducedAmount = applyMinimumPayment
    ? round(
        rateData.minimumPaymentThreshold +
          (grossReductionAmount - rateData.minimumPaymentThreshold) *
            rateData.minimumPaymentReductionRate,
      )
    : grossReductionAmount;
  const acquisitionTax = round(acquisitionTaxBeforeReduction - reducedAmount);

  if (applyMinimumPayment) {
    notices.push(MINIMUM_PAYMENT_APPLIED_NOTICE);
  }

  // 4. 지방교육세 = 취득세 × 지방교육세율 (요구사항 1.2)
  //    과세 기준은 감면 후 취득세를 사용한다.
  const localEducationTax = round(acquisitionTax * rateData.localEducationTaxRate);

  // 5. 농어촌특별세: 전용면적 > 85㎡ 시에만 적용 (요구사항 1.3)
  const isRuralSpecialTaxApplicable =
    input.exclusiveArea > rateData.ruralSpecialTaxAreaThreshold;
  const ruralSpecialTax = isRuralSpecialTaxApplicable
    ? round(input.purchasePrice * rateData.ruralSpecialTaxRate)
    : 0;

  // 6. 국민주택채권 매입액: 공시가격(시가표준액) 구간 요율 (요구사항 1.4)
  //    공시가격 미입력(신축 등) 시 채권 매입액은 산출하지 않고 0 처리 + 안내(요구사항 1.13).
  const bondBracket =
    officialPrice !== undefined
      ? findHousingBondBracket(officialPrice, rateData.housingBondRates)
      : undefined;
  const housingBondPurchase =
    officialPrice !== undefined && bondBracket
      ? round(officialPrice * bondBracket.rate)
      : 0;
  if (officialPrice === undefined) {
    notices.push(OFFICIAL_PRICE_MISSING_BOND_NOTICE);
  }

  // 7. 인지세: 취득가액 구간 정액 (요구사항 1.6)
  const stampBracket = findStampTaxBracket(input.purchasePrice, rateData.stampTaxBrackets);
  const stampTax = stampBracket ? stampBracket.stampTax : 0;

  // 8. 법무사 수수료: 등기 대행 선택 시에만 산출 (요구사항 1.5)
  const scrivenerBracket = input.useJudicialScrivener
    ? findScrivenerFeeBracket(input.purchasePrice, rateData.judicialScrivenerFeeTable)
    : undefined;
  const judicialScrivenerFee = scrivenerBracket ? scrivenerBracket.fee : 0;

  // 9. 감면 내역 (별도 표시, 요구사항 1.7/1.9)
  const reductionDetail: ReductionDetail | undefined =
    input.reductionType === 'none'
      ? undefined
      : {
          reductionType: input.reductionType,
          reductionRate,
          reducedAmount,
          grossReductionAmount,
          minimumPaymentApplied: applyMinimumPayment,
          ...(reductionOutcome.postManagementNotice
            ? { postManagementNotice: reductionOutcome.postManagementNotice }
            : {}),
        };

  const detail: AcquisitionCostDetail = {
    acquisitionTax,
    acquisitionTaxBeforeReduction,
    localEducationTax,
    ruralSpecialTax,
    housingBondPurchase,
    judicialScrivenerFee,
    stampTax,
    ...(reductionDetail ? { reduction: reductionDetail } : {}),
    ...(notices.length > 0 ? { notices } : {}),
  };

  // 10. 항목별 세부 내역 + 근거 (요구사항 1.10/1.11)
  const lineItems: LineItem[] = [];

  lineItems.push({
    name: '취득세',
    amount: acquisitionTax,
    basis: basis(
      reductionRate > 0
        ? applyMinimumPayment
          ? '취득세 = 취득가액 × 취득세율 − 감면액(최소납부세제 적용: 감면대상세액 중 임계값 초과분의 85%만 감면)'
          : '취득세 = 취득가액 × 취득세율 − 감면액(= 취득가액 × 취득세율 × 감면율)'
        : '취득세 = 취득가액 × 취득세율',
      (bracket.propertyType === 'non_house'
        ? `취득세율 구간 (유형=비주택, 비주택유형=${bracket.nonHouseType ?? 'general'}(${nonHouseTypeLabel(bracket.nonHouseType)}), 요율=${bracket.rate})`
        : `취득세율 구간 (유형=${bracket.propertyType}, 주택수=${bracket.housingCount}, 조정지역=${bracket.isAdjustmentArea}, 요율=${bracket.rate})`) +
        (lowValueExemptionApplies
          ? ` [공시가격 ${rateData.lowValueExemptionThreshold}원 이하 다주택 중과 제외 특례로 기본세율 적용]`
          : ''),
      basisMeta,
      { appliedRate: bracket.rate, taxBase: input.purchasePrice },
    ),
  });

  lineItems.push({
    name: '지방교육세',
    amount: localEducationTax,
    basis: basis(
      '지방교육세 = 취득세(감면 후) × 지방교육세율',
      `지방교육세율 (${rateData.localEducationTaxRate})`,
      basisMeta,
      { appliedRate: rateData.localEducationTaxRate, taxBase: acquisitionTax },
    ),
  });

  lineItems.push({
    name: '농어촌특별세',
    amount: ruralSpecialTax,
    basis: basis(
      isRuralSpecialTaxApplicable
        ? '농어촌특별세 = 취득가액 × 농특세율 (전용면적 > 85㎡)'
        : '농어촌특별세 미적용 (전용면적 ≤ 85㎡)',
      `농어촌특별세율 (${rateData.ruralSpecialTaxRate}), 면적기준 ${rateData.ruralSpecialTaxAreaThreshold}㎡`,
      basisMeta,
      isRuralSpecialTaxApplicable
        ? { appliedRate: rateData.ruralSpecialTaxRate, taxBase: input.purchasePrice }
        : {},
    ),
  });

  lineItems.push({
    name: '국민주택채권매입액',
    amount: housingBondPurchase,
    basis: basis(
      officialPrice === undefined
        ? '신축 등 시가표준액 미입력으로 미산출 — 시가표준액 입력 시 계산됩니다'
        : bondBracket
          ? '국민주택채권 매입액 = 공시가격 × 채권매입요율'
          : '공시가격 구간에 해당하는 채권매입요율 없음',
      bondBracket
        ? `국민주택채권 요율 구간 (요율=${bondBracket.rate})`
        : '국민주택채권 요율 구간',
      basisMeta,
      bondBracket && officialPrice !== undefined
        ? { appliedRate: bondBracket.rate, taxBase: officialPrice }
        : officialPrice !== undefined
          ? { taxBase: officialPrice }
          : {},
    ),
  });

  lineItems.push({
    name: '법무사수수료',
    amount: judicialScrivenerFee,
    basis: basis(
      input.useJudicialScrivener
        ? '법무사 수수료 = 취득가액 구간별 기준 수수료'
        : '법무사 등기 대행 미선택 (수수료 0)',
      scrivenerBracket
        ? `법무사 수수료 구간 (기준 수수료=${scrivenerBracket.fee})`
        : '법무사 수수료 구간',
      basisMeta,
      { taxBase: input.purchasePrice },
    ),
  });

  lineItems.push({
    name: '인지세',
    amount: stampTax,
    basis: basis(
      stampBracket
        ? '인지세 = 취득가액 구간별 정액'
        : '취득가액 구간에 해당하는 인지세 없음',
      stampBracket
        ? `인지세 구간 (정액=${stampBracket.stampTax})`
        : '인지세 구간',
      basisMeta,
      { taxBase: input.purchasePrice },
    ),
  });

  // 중개수수료 연동값 (선택, 요구사항 1.10)
  if (typeof input.brokerageFee === 'number' && input.brokerageFee > 0) {
    lineItems.push({
      name: '중개수수료',
      amount: round(input.brokerageFee),
      basis: basis(
        '중개수수료 연동값 (중개수수료 계산기 결과 합산)',
        '중개수수료 연동값',
        basisMeta,
        { taxBase: input.brokerageFee },
      ),
    });
  }

  // 11. 총 취득비용 = 항목별 내역 합산 (요구사항 1.10, Property 9)
  const total = round(lineItems.reduce((sum, item) => sum + item.amount, 0));

  const result: AcquisitionCostResult = {
    calculatorType: 'acquisition',
    total,
    lineItems,
    detail,
    baseYear,
    rateTableVersion: version,
    disclaimer: ACQUISITION_DISCLAIMER,
  };

  return { ok: true, result };
}

/* ------------------------------------------------------------------ */
/* 내부 조회/보조 함수                                                   */
/* ------------------------------------------------------------------ */

/**
 * 감면 적용 결과.
 */
interface ReductionResolution {
  /** 최종 적용 감면율 (0~1) */
  reductionRate: number;
  /**
   * 최소납부세제 적용 대상 여부(지방세특례제한법 제177조의2).
   *
   * 기준표 감면 정의의 subjectToMinimumPayment 값을 그대로 전달한다. 감면율이 0이거나
   * 감면 유형이 없으면 false이다.
   */
  subjectToMinimumPayment: boolean;
  /** 사후관리 안내 (장기임대사업자 등) */
  postManagementNotice?: string;
}

/**
 * 입력 감면 유형에 대한 최종 감면율과 사후관리 안내를 결정한다.
 *
 * 감면 유형이 `none`이면 감면율 0을 반환한다. 장기임대사업자는 면적 구간·취득 요건
 * 조합(rentalCondition)으로 rentalDifferentialRates에서 차등 감면율을 조회하며,
 * 그 외 유형은 기본 감면율(reductionRate)을 사용한다. 감면 유형이 기준표에 있으면
 * 사후관리(postManagement) 안내를 함께 반환한다.
 *
 * @param input - 취득비용 계산 입력
 * @param rateData - 취득세 기준표 데이터
 * @returns 감면율과 사후관리 안내
 */
function resolveReduction(
  input: AcquisitionCostInput,
  rateData: AcquisitionRateData,
): ReductionResolution {
  if (input.reductionType === 'none') {
    return { reductionRate: 0, subjectToMinimumPayment: false };
  }

  const reduction = rateData.reductions.find(
    (r) => r.reductionType === input.reductionType,
  );
  if (!reduction) {
    // 기준표에 감면 유형 정의가 없으면 감면 미적용으로 처리한다.
    return { reductionRate: 0, subjectToMinimumPayment: false };
  }

  if (input.reductionType === 'long_term_rental_business') {
    return resolveRentalReduction(input.rentalCondition, reduction);
  }

  return {
    reductionRate: reduction.reductionRate,
    subjectToMinimumPayment: reduction.subjectToMinimumPayment ?? false,
    ...(reduction.postManagement
      ? { postManagementNotice: reduction.postManagement }
      : {}),
  };
}

/**
 * 장기임대사업자 감면율을 면적 구간·취득 요건 조합으로 조회한다(요구사항 1.8/1.9).
 *
 * rentalCondition이 제공되고 차등 감면율 표에 일치 항목이 있으면 해당 차등 감면율을,
 * 그렇지 않으면 기본 감면율(reductionRate)을 사용한다. 사후관리 안내는 항상 포함한다.
 *
 * @param condition - 장기임대사업자 감면 세부 조건
 * @param reduction - 기준표의 장기임대사업자 감면 정의
 * @returns 감면율과 사후관리 안내
 */
function resolveRentalReduction(
  condition: RentalReductionCondition | undefined,
  reduction: AcquisitionReduction,
): ReductionResolution {
  const differential: RentalDifferentialRate | undefined =
    condition && reduction.rentalDifferentialRates
      ? reduction.rentalDifferentialRates.find(
          (d) =>
            d.areaBracket === condition.areaBracket &&
            d.acquisitionRequirement === condition.acquisitionRequirement,
        )
      : undefined;

  const reductionRate = differential ? differential.reductionRate : reduction.reductionRate;

  return {
    reductionRate,
    subjectToMinimumPayment: reduction.subjectToMinimumPayment ?? false,
    // 장기임대사업자는 사후관리 요건 안내를 항상 포함한다(요구사항 1.9).
    postManagementNotice:
      reduction.postManagement ??
      '장기임대사업자 취득세 감면은 의무 임대기간 유지 등 사후관리 요건이 있으며, 요건 미충족 시 감면세액이 추징될 수 있습니다.',
  };
}

/**
 * 취득세율 구간을 조회한다(요구사항 1.1).
 *
 * propertyType/housingCount/isAdjustmentArea가 일치하고, minPrice ≤ 취득가액 <
 * maxPrice(maxPrice 미지정 시 초과)를 만족하며, areaMax 조건이 있으면 전용면적이
 * areaMax 이하인 구간을 반환한다. 일치하는 구간이 없으면 undefined를 반환한다.
 *
 * @param input - 취득비용 계산 입력
 * @param brackets - 취득세율 구간 목록
 * @returns 일치하는 취득세율 구간, 없으면 undefined
 */
function findAcquisitionTaxBracket(
  input: AcquisitionCostInput,
  brackets: AcquisitionTaxBracket[],
): AcquisitionTaxBracket | undefined {
  // 비주택은 유형별(일반/농지/원시취득) 단일세율이므로 주택 수·조정지역과 무관하게
  // nonHouseType(기본 'general')로 매칭한다. 주택(house)은 기존 로직(주택 수·조정지역·
  // 취득가액 구간·면적)을 그대로 사용한다.
  if (input.propertyType === 'non_house') {
    const requestedNonHouseType = input.nonHouseType ?? 'general';
    return brackets.find((b) => {
      if (b.propertyType !== 'non_house') {
        return false;
      }
      if ((b.nonHouseType ?? 'general') !== requestedNonHouseType) {
        return false;
      }
      if (!inPriceRange(input.purchasePrice, b.minPrice, b.maxPrice)) {
        return false;
      }
      if (b.areaMax !== undefined && input.exclusiveArea > b.areaMax) {
        return false;
      }
      return true;
    });
  }

  return brackets.find((b) => {
    if (
      b.propertyType !== input.propertyType ||
      b.housingCount !== input.housingCount ||
      b.isAdjustmentArea !== input.isAdjustmentArea
    ) {
      return false;
    }
    if (!inPriceRange(input.purchasePrice, b.minPrice, b.maxPrice)) {
      return false;
    }
    if (b.areaMax !== undefined && input.exclusiveArea > b.areaMax) {
      return false;
    }
    return true;
  });
}

/**
 * 국민주택채권 매입 요율 구간을 공시가격으로 조회한다(요구사항 1.4).
 *
 * @param officialPrice - 공시가격
 * @param brackets - 채권 매입 요율 구간 목록
 * @returns 일치 구간, 없으면 undefined
 */
function findHousingBondBracket(
  officialPrice: number,
  brackets: HousingBondBracket[],
): HousingBondBracket | undefined {
  return brackets.find((b) =>
    inPriceRange(officialPrice, b.minOfficialPrice, b.maxOfficialPrice),
  );
}

/**
 * 인지세 구간을 취득가액으로 조회한다(요구사항 1.6).
 *
 * @param purchasePrice - 취득가액
 * @param brackets - 인지세 구간 목록
 * @returns 일치 구간, 없으면 undefined
 */
function findStampTaxBracket(
  purchasePrice: number,
  brackets: StampTaxBracket[],
): StampTaxBracket | undefined {
  return brackets.find((b) => inPriceRange(purchasePrice, b.minPrice, b.maxPrice));
}

/**
 * 법무사 수수료 구간을 취득가액으로 조회한다(요구사항 1.5).
 *
 * @param purchasePrice - 취득가액
 * @param brackets - 법무사 수수료 구간 목록
 * @returns 일치 구간, 없으면 undefined
 */
function findScrivenerFeeBracket(
  purchasePrice: number,
  brackets: ScrivenerFeeBracket[],
): ScrivenerFeeBracket | undefined {
  return brackets.find((b) => inPriceRange(purchasePrice, b.minPrice, b.maxPrice));
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
function inPriceRange(value: number, min: number, max?: number): boolean {
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
 * 비주택 세부 유형의 한글 표시명을 반환한다(계산 근거 문구용).
 *
 * @param type - 비주택 세부 유형(미지정 시 'general')
 * @returns 한글 표시명
 */
function nonHouseTypeLabel(type?: NonHouseType): string {
  switch (type ?? 'general') {
    case 'farmland':
      return '농지 유상취득';
    case 'original_acquisition':
      return '원시취득(신축 보존등기)';
    case 'general':
    default:
      return '일반 유상취득(상가·건물·토지 등)';
  }
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
