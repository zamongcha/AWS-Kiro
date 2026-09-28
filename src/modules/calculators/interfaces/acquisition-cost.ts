/**
 * 취득비용 계산기 (acquisition-cost) 인터페이스 정의
 *
 * 취득세·지방교육세·농어촌특별세·국민주택채권·법무사 수수료·인지세 및 감면
 * 내역을 산출하는 취득비용 계산기의 입출력 타입을 정의한다. 결과 봉투는 공통
 * `CalculationResult<AcquisitionCostDetail>` 제네릭을 사용한다.
 */

import type {
  AcquisitionReductionType,
  HousingCount,
  NonHouseType,
  PropertyType,
} from './types.js';
import type { CalculationResult } from './result.js';

/**
 * 취득비용 계산 입력
 */
export interface AcquisitionCostInput {
  /** 취득가액 (원) */
  purchasePrice: number;
  /**
   * 공시가격 (시가표준액, 국민주택채권 기준, 원).
   *
   * 신축 주택 등 공시가격(시가표준액)이 아직 정해지지 않은 경우가 있으므로 선택 입력이다.
   * 취득세 과세표준은 원칙적으로 사실상 취득가격(취득가액)을 사용하므로 공시가격이 없어도
   * 취득세·지방교육세·농특세·인지세·법무사수수료는 정상 산출된다. 다만 국민주택채권 매입액은
   * 공시가격(시가표준액) 기준이므로 미입력 시 채권 항목은 0으로 처리하고 안내(notice)를 포함한다.
   */
  officialPrice?: number;
  /** 주택/비주택 */
  propertyType: PropertyType;
  /**
   * 비주택 세부 유형 (선택).
   *
   * propertyType이 'non_house'일 때만 사용하며, 비주택 취득세율을 유형별로 세분화한다.
   * 미지정 시 'general'(일반 유상취득)로 간주한다. 주택(house)일 때는 무시된다.
   */
  nonHouseType?: NonHouseType;
  /** 주택 수 */
  housingCount: HousingCount;
  /** 조정대상지역 여부 */
  isAdjustmentArea: boolean;
  /** 전용면적 (㎡) */
  exclusiveArea: number;
  /** 감면 유형 */
  reductionType: AcquisitionReductionType;
  /** 법무사 등기 대행 선택 */
  useJudicialScrivener: boolean;
  /** 중개수수료 연동값 (선택, 원) */
  brokerageFee?: number;
  /** 적용 기준연도 */
  baseYear: number;
  /** 장기임대사업자 감면 세부 조건 (reductionType=long_term_rental_business 시) */
  rentalCondition?: RentalReductionCondition;
}

/**
 * 장기임대사업자 감면 세부 조건
 */
export interface RentalReductionCondition {
  /** 60㎡ 이하 | 60㎡ 초과 85㎡ 이하 */
  areaBracket: 'le_60' | 'gt_60_le_85';
  /** 신축 | 최초 분양 */
  acquisitionRequirement: 'new_build' | 'first_sale';
}

/**
 * 취득비용 계산 상세
 */
export interface AcquisitionCostDetail {
  /** 취득세 (감면 후) */
  acquisitionTax: number;
  /** 감면 전 취득세 */
  acquisitionTaxBeforeReduction: number;
  /** 지방교육세 */
  localEducationTax: number;
  /** 농어촌특별세 (면적>85㎡) */
  ruralSpecialTax: number;
  /** 국민주택채권 매입액 */
  housingBondPurchase: number;
  /** 법무사 수수료 */
  judicialScrivenerFee: number;
  /** 인지세 */
  stampTax: number;
  /** 감면 내역 (별도 표시) */
  reduction?: ReductionDetail;
  /**
   * 안내 문구 목록 (별도 표시).
   *
   * 공시가격 미정(신축 등)으로 인한 채권 미산출 안내, 공시가격 1억원 이하 다주택 중과 제외
   * 특례 적용 안내 등 계산 조건에 따라 사용자에게 추가로 알릴 사항을 담는다. 없으면 생략한다.
   */
  notices?: string[];
}

/**
 * 감면 내역
 */
export interface ReductionDetail {
  /** 감면 유형 */
  reductionType: AcquisitionReductionType;
  /** 감면율 (0~1) */
  reductionRate: number;
  /**
   * 최종 감면세액 (원).
   *
   * 최소납부세제가 적용된 경우 최소납부세제 반영 후의 실제 감면액이며, 미적용 시에는
   * 감면대상세액(= 감면 전 취득세 × 감면율)과 동일하다.
   */
  reducedAmount: number;
  /**
   * 최소납부세제 반영 전 감면대상세액 (원).
   *
   * 원래 감면하려던 금액(= 감면 전 취득세 × 감면율)이다. 최소납부세제가 적용되면
   * reducedAmount는 이보다 작아진다(초과분의 일부만 감면). 표시·검증용.
   */
  grossReductionAmount: number;
  /**
   * 최소납부세제 적용 여부 (지방세특례제한법 제177조의2).
   *
   * 감면대상세액이 기준표의 최소납부세제 임계값을 초과하여 초과분의 일부만 감면되고
   * 나머지는 납부하게 된 경우 true이다.
   */
  minimumPaymentApplied: boolean;
  /** 장기임대: 사후관리 요건/추징 안내 */
  postManagementNotice?: string;
}

/**
 * 취득비용 계산 결과
 */
export type AcquisitionCostResult = CalculationResult<AcquisitionCostDetail>;
