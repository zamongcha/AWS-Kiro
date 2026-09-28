/**
 * 계산기 연동 어댑터 순수 로직 (calculator-bridge-adapter)
 *
 * 계약서 분석 서비스(real-estate-contract-analysis)의 calculator-bridge가 전달하는
 * 표준 입력 스키마(`CalculatorInputSchema`)를 계산기 내부 입력 형식으로 매핑하고,
 * 취득세·중개수수료 결과를 계약서 서비스가 참조하는 출력 스키마(`CalculatorOutputSchema`)로
 * 반환하는 결정론적 순수 로직을 제공한다.
 *
 * 단위 규약: 금액=원(KRW), 면적=제곱미터(sqm), 계약 기간=개월(month). 각 항목의 단위는
 * 스키마에 명시되며, 어댑터는 이를 계산기 내부 입력의 수치 값으로 매핑한다(요구사항 7.2).
 *
 * 계약 유형별 매핑:
 *   - sale(매매): 취득세(취득비용) + 중개수수료(매매/교환) 매핑
 *   - jeonse/wolse(전세/월세): 중개수수료(임대차) 매핑, 취득세 미대상
 *   - commercial_lease(상가 임대): 중개수수료(임대차, 주택 외) 매핑, 취득세 미대상
 *
 * 필수 항목 누락 시 누락 항목명(`missingFields`)을 반환하고 계산을 수행하지 않는다(요구사항 7.4).
 * 계약서 분석 서비스 장애는 어댑터 경로에 국한되며, 사용자 직접 입력 계산 경로(각 계산기 모듈)
 * 에는 영향을 주지 않는다(요구사항 7.5) — 어댑터는 별도 진입점으로 격리되어 있다.
 *
 * @requirements 7.1 - 계약서 표준 입력 스키마를 소비하는 연동 인터페이스 정의
 * @requirements 7.2 - 단위(원/제곱미터/개월)를 계산기 내부 입력 형식으로 매핑
 * @requirements 7.3 - 취득세·중개수수료 결과를 CalculatorOutputSchema로 반환
 * @requirements 7.4 - 필수 항목 누락 시 누락 항목명 반환 + 계산 미수행
 * @requirements 7.5 - 계약서 서비스 장애가 직접 입력 계산에 영향 주지 않도록 격리
 */

import type {
  BridgeAdapterResult,
  CalculatorInputSchema,
  CalculatorOutputSchema,
} from '../interfaces/calculator-bridge.js';
import type { AcquisitionCostInput } from '../interfaces/acquisition-cost.js';
import type { BrokerageFeeInput } from '../interfaces/brokerage-fee.js';
import type {
  BrokeragePropertyType,
  TransactionType,
} from '../interfaces/types.js';
import type {
  AcquisitionRateData,
  BrokerageRateData,
} from '../interfaces/rate-tables.js';
import { calculateAcquisitionCost } from '../acquisition-cost/acquisition-calculator.js';
import { calculateBrokerageFee } from '../brokerage-fee/brokerage-calculator.js';

/**
 * 계약서 표준 입력 스키마에서 계산기 내부 입력으로는 채울 수 없는 보조 옵션.
 *
 * 계약서 분석 서비스의 표준 입력 스키마는 금액·면적·기간 등 계약 관련 값만 전달하며,
 * 취득세·중개수수료 계산에 필요한 조건(주택 수·조정지역·감면 유형·기준연도 등)은
 * 포함하지 않는다. 어댑터는 이러한 계산 조건을 옵션으로 주입받아 매핑을 완성한다.
 * 미지정 시 아래 문서화된 기본값을 사용한다.
 */
export interface BridgeMappingOptions {
  /** 적용 기준연도 (미지정 시 DEFAULT_BASE_YEAR) */
  baseYear?: number;
  /** 취득세 매핑 조건 (매매 계약 시 사용) */
  acquisition?: {
    /** 공시가격 (원, 국민주택채권 기준) — 미지정 시 매매가액을 대용 */
    officialPrice?: number;
    /** 주택/비주택 (기본: house) */
    propertyType?: AcquisitionCostInput['propertyType'];
    /** 주택 수 (기본: one) */
    housingCount?: AcquisitionCostInput['housingCount'];
    /** 조정대상지역 여부 (기본: false) */
    isAdjustmentArea?: boolean;
    /** 감면 유형 (기본: none) */
    reductionType?: AcquisitionCostInput['reductionType'];
    /** 법무사 등기 대행 선택 (기본: false) */
    useJudicialScrivener?: boolean;
  };
  /** 중개수수료 매핑 조건 */
  brokerage?: {
    /** 오피스텔 전용 요율 요건 충족 여부 (기본: false) */
    officetelQualified?: boolean;
  };
}

/**
 * 기준연도 기본값 (옵션 미지정 시).
 */
export const DEFAULT_BASE_YEAR = 2025;

/**
 * 어댑터 매핑·계산에 필요한 기준표 데이터 묶음.
 *
 * 어댑터는 상수 기준표에 직접 의존하지 않고, 취득세·중개수수료 기준표 데이터를
 * 주입받아 순수 계산 함수에 전달한다(계산 로직과 기준표 분리, 참조 투명성 유지).
 */
export interface BridgeRateTables {
  /** 취득세 기준표 데이터 */
  acquisition: AcquisitionRateData;
  /** 취득세 기준표 버전 */
  acquisitionVersion: string;
  /** 중개수수료 기준표 데이터 */
  brokerage: BrokerageRateData;
  /** 중개수수료 기준표 버전 */
  brokerageVersion: string;
}

/**
 * 계산기 연동 어댑터.
 *
 * 계약서 분석 서비스의 표준 입력 스키마를 계산기 내부 입력으로 매핑하고, 취득세·
 * 중개수수료를 산출하여 출력 스키마로 반환하는 결정론적 순수 어댑터이다. 상태를
 * 저장하지 않으며 동일 입력에 대해 항상 동일한 출력을 반환한다.
 */
export class CalculatorBridgeAdapter {
  /**
   * 계약서 표준 입력 스키마를 계산기 내부 입력으로 매핑한다(요구사항 7.2).
   *
   * 계약 유형에 따라 취득세 입력(`AcquisitionCostInput`)과 중개수수료 입력
   * (`BrokerageFeeInput`)을 구성한다. 표준 스키마의 각 금액/면적/기간 항목은 명시된
   * 단위(원/제곱미터/개월)의 수치 값을 계산기 내부 입력의 대응 필드로 옮긴다. 매매
   * 계약은 취득세·중개수수료(매매/교환) 입력을, 임대차 계약(전세·월세·상가 임대)은
   * 중개수수료(임대차) 입력만 구성한다.
   *
   * 계산은 수행하지 않고 매핑된 입력만 반환한다.
   *
   * @param schema - 계약서 표준 입력 스키마
   * @param options - 계산 조건 보조 옵션 (미지정 필드는 기본값)
   * @returns 매핑된 취득세/중개수수료 입력 (부분 입력 가능)
   */
  mapInputs(
    schema: CalculatorInputSchema,
    options: BridgeMappingOptions = {},
  ): {
    acquisition?: Partial<AcquisitionCostInput>;
    brokerage?: Partial<BrokerageFeeInput>;
  } {
    const baseYear = options.baseYear ?? DEFAULT_BASE_YEAR;

    const mapped: {
      acquisition?: Partial<AcquisitionCostInput>;
      brokerage?: Partial<BrokerageFeeInput>;
    } = {};

    if (schema.contractType === 'sale') {
      // 매매: 취득세(취득비용) 입력 매핑
      const salePrice = schema.salePrice?.value;
      const area = schema.area?.value;
      const acqOpts = options.acquisition ?? {};

      const acquisition: Partial<AcquisitionCostInput> = {
        propertyType: acqOpts.propertyType ?? 'house',
        housingCount: acqOpts.housingCount ?? 'one',
        isAdjustmentArea: acqOpts.isAdjustmentArea ?? false,
        reductionType: acqOpts.reductionType ?? 'none',
        useJudicialScrivener: acqOpts.useJudicialScrivener ?? false,
        baseYear,
      };
      if (typeof salePrice === 'number') {
        // 금액 단위=원 → 취득가액(원)
        acquisition.purchasePrice = salePrice;
        // 공시가격 미제공 시 취득가액을 대용값으로 사용
        acquisition.officialPrice = acqOpts.officialPrice ?? salePrice;
      } else if (typeof acqOpts.officialPrice === 'number') {
        acquisition.officialPrice = acqOpts.officialPrice;
      }
      if (typeof area === 'number') {
        // 면적 단위=제곱미터 → 전용면적(㎡)
        acquisition.exclusiveArea = area;
      }
      mapped.acquisition = acquisition;

      // 매매: 중개수수료(매매/교환) 입력 매핑
      const brokerage: Partial<BrokerageFeeInput> = {
        transactionType: 'sale_exchange',
        propertyType: this.resolveBrokeragePropertyType(schema, options),
        baseYear,
        officetelQualified: options.brokerage?.officetelQualified ?? false,
      };
      if (typeof salePrice === 'number') {
        brokerage.salePrice = salePrice;
      }
      mapped.brokerage = brokerage;
      return mapped;
    }

    // 임대차 (전세/월세/상가 임대): 중개수수료(임대차) 입력만 매핑, 취득세 미대상
    const brokerage: Partial<BrokerageFeeInput> = {
      transactionType: 'lease',
      propertyType: this.resolveBrokeragePropertyType(schema, options),
      baseYear,
      officetelQualified: options.brokerage?.officetelQualified ?? false,
    };
    if (typeof schema.deposit?.value === 'number') {
      // 금액 단위=원 → 보증금(원)
      brokerage.deposit = schema.deposit.value;
    }
    // 전세(jeonse)는 월세가 없으므로 0으로 매핑, 월세(wolse)/상가 임대는 월세 값 사용
    if (schema.contractType === 'jeonse') {
      brokerage.monthlyRent = 0;
    } else if (typeof schema.monthlyRent?.value === 'number') {
      brokerage.monthlyRent = schema.monthlyRent.value;
    }
    mapped.brokerage = brokerage;
    return mapped;
  }

  /**
   * 표준 입력 스키마를 소비하여 취득세·중개수수료를 산출하고 출력 스키마로 반환한다.
   *
   * 먼저 계약 유형별 필수 항목을 검사한다. 필수 항목이 누락되면 누락 항목명을
   * `missingFields`에 담아 반환하고 계산을 수행하지 않는다(요구사항 7.4). 필수 항목이
   * 충족되면 입력을 매핑하고 순수 계산 함수로 취득세·중개수수료를 산출하여
   * `CalculatorOutputSchema`(acquisitionTax/brokerageFee, 각 {value, unit:'KRW'})로
   * 반환한다(요구사항 7.3). 개별 계산이 실패(조건 요율 미존재 등)하면 해당 항목은
   * 출력에서 생략한다.
   *
   * @param schema - 계약서 표준 입력 스키마
   * @param rateTables - 취득세·중개수수료 기준표 데이터·버전
   * @param options - 계산 조건 보조 옵션
   * @returns 매핑 입력·출력 스키마·누락 항목명을 담은 어댑터 결과
   */
  process(
    schema: CalculatorInputSchema,
    rateTables: BridgeRateTables,
    options: BridgeMappingOptions = {},
  ): BridgeAdapterResult {
    const baseYear = options.baseYear ?? DEFAULT_BASE_YEAR;
    const mappedInputs = this.mapInputs(schema, options);

    // 1. 필수 항목 검사 (요구사항 7.4) — 누락 시 계산 미수행
    const missingFields = this.findMissingFields(schema);
    if (missingFields.length > 0) {
      return { mappedInputs, missingFields };
    }

    const output: CalculatorOutputSchema = {};

    // 2. 취득세 산출 (매매 계약에 한함, 요구사항 7.3)
    if (mappedInputs.acquisition) {
      const acqInput = this.completeAcquisitionInput(mappedInputs.acquisition, baseYear);
      const acqOutcome = calculateAcquisitionCost(
        acqInput,
        rateTables.acquisition,
        baseYear,
        rateTables.acquisitionVersion,
      );
      if (acqOutcome.ok) {
        output.acquisitionTax = {
          value: acqOutcome.result.detail.acquisitionTax,
          unit: 'KRW',
        };
      }
    }

    // 3. 중개수수료 산출 (요구사항 7.3)
    if (mappedInputs.brokerage) {
      const brkInput = this.completeBrokerageInput(mappedInputs.brokerage, baseYear);
      const brkOutcome = calculateBrokerageFee(
        brkInput,
        rateTables.brokerage,
        baseYear,
        rateTables.brokerageVersion,
      );
      if (brkOutcome.ok) {
        output.brokerageFee = {
          value: brkOutcome.result.detail.brokerageFeeUpperLimit,
          unit: 'KRW',
        };
      }
    }

    return { mappedInputs, output, missingFields: [] };
  }

  /* ---------------------------------------------------------------- */
  /* 내부 보조 함수                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * 계약 유형별 계산 필수 항목의 누락 여부를 검사한다(요구사항 7.4).
   *
   * - 매매(sale): 매매가액(salePrice), 면적(area) 필수 (취득세 산출 조건)
   * - 전세(jeonse): 보증금(deposit) 필수
   * - 월세(wolse)/상가 임대(commercial_lease): 보증금(deposit), 월세(monthlyRent) 필수
   *
   * 누락 항목이 있으면 해당 항목명 목록을 반환한다. 값이 존재하되 수치가 아닌 경우도
   * 누락으로 간주한다.
   *
   * @param schema - 계약서 표준 입력 스키마
   * @returns 누락된 필수 항목명 목록 (없으면 빈 배열)
   */
  private findMissingFields(schema: CalculatorInputSchema): string[] {
    const missing: string[] = [];
    const hasNumber = (field?: { value: number }): boolean =>
      field !== undefined && typeof field.value === 'number' && !Number.isNaN(field.value);

    if (schema.contractType === 'sale') {
      if (!hasNumber(schema.salePrice)) {
        missing.push('salePrice');
      }
      if (!hasNumber(schema.area)) {
        missing.push('area');
      }
      return missing;
    }

    // 임대차 계약 공통: 보증금 필수
    if (!hasNumber(schema.deposit)) {
      missing.push('deposit');
    }
    // 월세·상가 임대: 월세 필수 (전세는 월세 없음)
    if (schema.contractType === 'wolse' || schema.contractType === 'commercial_lease') {
      if (!hasNumber(schema.monthlyRent)) {
        missing.push('monthlyRent');
      }
    }
    return missing;
  }

  /**
   * 중개수수료 물건 유형을 결정한다.
   *
   * 상가 임대(commercial_lease)는 '주택 외(other)'로, 그 외 계약은 '주택(house)'으로
   * 기본 매핑한다. 오피스텔 전용 요율 요건이 옵션으로 지정되면 물건 유형을 'officetel'로
   * 설정하여 오피스텔 전용 요율 조회를 유도한다.
   *
   * @param schema - 계약서 표준 입력 스키마
   * @param options - 매핑 옵션
   * @returns 중개수수료 물건 유형
   */
  private resolveBrokeragePropertyType(
    schema: CalculatorInputSchema,
    options: BridgeMappingOptions,
  ): BrokeragePropertyType {
    if (options.brokerage?.officetelQualified === true) {
      return 'officetel';
    }
    if (schema.contractType === 'commercial_lease') {
      return 'other';
    }
    return 'house';
  }

  /**
   * 부분 취득세 입력을 계산 함수가 요구하는 완전한 입력으로 보정한다.
   *
   * 매핑 단계에서 채워진 필드를 유지하되, 누락 가능 필드에 문서화된 기본값을 채워
   * `AcquisitionCostInput`을 완성한다. 필수 항목 검사(findMissingFields)를 통과한
   * 경우에만 호출되므로 취득가액·면적은 매핑되어 있다.
   *
   * @param partial - 매핑된 부분 취득세 입력
   * @param baseYear - 적용 기준연도
   * @returns 완전한 취득세 계산 입력
   */
  private completeAcquisitionInput(
    partial: Partial<AcquisitionCostInput>,
    baseYear: number,
  ): AcquisitionCostInput {
    const purchasePrice = partial.purchasePrice ?? 0;
    return {
      purchasePrice,
      // 공시가격(시가표준액)은 선택 입력이다. 매핑 단계에서 채워졌으면(옵션 지정 또는
      // 매매가액 대용값) 그 값을 사용하고, 채워지지 않았으면(신축 등 미정) 생략하여
      // 취득세는 취득가액 기준으로 산출하고 국민주택채권은 0 처리되도록 한다.
      ...(partial.officialPrice !== undefined
        ? { officialPrice: partial.officialPrice }
        : {}),
      propertyType: partial.propertyType ?? 'house',
      housingCount: partial.housingCount ?? 'one',
      isAdjustmentArea: partial.isAdjustmentArea ?? false,
      exclusiveArea: partial.exclusiveArea ?? 0,
      reductionType: partial.reductionType ?? 'none',
      useJudicialScrivener: partial.useJudicialScrivener ?? false,
      baseYear: partial.baseYear ?? baseYear,
      ...(partial.rentalCondition ? { rentalCondition: partial.rentalCondition } : {}),
    };
  }

  /**
   * 부분 중개수수료 입력을 계산 함수가 요구하는 완전한 입력으로 보정한다.
   *
   * 거래 유형·물건 유형·기준연도는 매핑 단계에서 채워지며, 거래 유형별 금액 필드
   * (임대차: 보증금·월세, 매매/교환: 매매가액)를 유지한다. 필수 항목 검사를 통과한
   * 경우에만 호출된다.
   *
   * @param partial - 매핑된 부분 중개수수료 입력
   * @param baseYear - 적용 기준연도
   * @returns 완전한 중개수수료 계산 입력
   */
  private completeBrokerageInput(
    partial: Partial<BrokerageFeeInput>,
    baseYear: number,
  ): BrokerageFeeInput {
    const transactionType: TransactionType = partial.transactionType ?? 'lease';
    const propertyType: BrokeragePropertyType = partial.propertyType ?? 'house';
    return {
      transactionType,
      propertyType,
      baseYear: partial.baseYear ?? baseYear,
      ...(partial.salePrice !== undefined ? { salePrice: partial.salePrice } : {}),
      ...(partial.deposit !== undefined ? { deposit: partial.deposit } : {}),
      ...(partial.monthlyRent !== undefined ? { monthlyRent: partial.monthlyRent } : {}),
      ...(partial.officetelQualified !== undefined
        ? { officetelQualified: partial.officetelQualified }
        : {}),
    };
  }
}
