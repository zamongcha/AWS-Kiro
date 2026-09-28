/**
 * 기준표 관리기 (rate-tables) 인터페이스 및 기준표 데이터 모델 정의
 *
 * 계산 로직과 분리된 상수 기준표(취득세·양도세·중개수수료)의 데이터 모델과
 * 기준연도별 버전 조회를 담당하는 레지스트리 인터페이스를 정의한다. 각 기준표는
 * 기준연도(baseYear)와 버전 식별자(version)를 메타데이터로 가지며, 세법·요율
 * 개정 시 계산 로직 변경 없이 새 기준연도 기준표 버전을 추가할 수 있다.
 */

import type {
  BrokeragePropertyType,
  CalculatorType,
  HousingCount,
  NonHouseType,
  PropertyType,
  TransactionType,
} from './types.js';
import type { AcquisitionReductionType } from './types.js';
import type { RateTableConstraints } from './input-validator.js';

/**
 * 기준표 조회 요청
 */
export interface RateTableRequest {
  /** 계산기 유형 */
  calculatorType: CalculatorType;
  /** 요청 기준연도 */
  baseYear: number;
}

/**
 * 기준표 조회 응답
 */
export interface RateTableResponse {
  /** 기준표 존재 여부 */
  found: boolean;
  /** 조회된 기준표 (존재 시) */
  rateTable?: RateTable;
  /** 미존재 시 사용 가능 기준연도 목록 */
  availableBaseYears?: number[];
}

/**
 * 기준표
 */
export interface RateTable {
  /** 계산기 유형 */
  calculatorType: CalculatorType;
  /** 적용 기준연도 */
  baseYear: number;
  /** 버전 식별자 */
  version: string;
  /** 계산기 유형별 기준표 데이터 */
  data: AcquisitionRateData | TransferRateData | BrokerageRateData;
  /** 입력 검증용 상한/열거값 */
  constraints: RateTableConstraints;
}

/**
 * 기준표 메타데이터 및 버전 관리
 */
export interface RateTableMetadata {
  /** 계산기 유형 */
  calculatorType: CalculatorType;
  /** 적용 기준연도 (예: 2024, 2025) */
  baseYear: number;
  /** 버전 식별자 (예: "v1", "2025.1") */
  version: string;
  /** 적용 시작일 (YYYY-MM-DD) */
  effectiveFrom: string;
  /** 개정 내용 요약 */
  description: string;
}

/**
 * 기준표 레지스트리: 기준연도별 버전 조회
 */
export interface RateTableRegistry {
  /** 기준연도별 기준표 조회, 미존재 시 null */
  getRateTable(type: CalculatorType, baseYear: number): RateTable | null;
  /** 사용 가능 기준연도 목록 반환 */
  getAvailableBaseYears(type: CalculatorType): number[];
}

/* ------------------------------------------------------------------ */
/* 취득세 기준표 데이터 모델                                            */
/* ------------------------------------------------------------------ */

/**
 * 취득세 기준표 데이터
 */
export interface AcquisitionRateData {
  /** 취득세율: 주택수/조정지역/면적 조건별 조회 테이블 */
  acquisitionTaxBrackets: AcquisitionTaxBracket[];
  /** 지방교육세율 (취득세 대비) */
  localEducationTaxRate: number;
  /** 농어촌특별세율 (면적>85㎡ 적용) */
  ruralSpecialTaxRate: number;
  /** 농특세 면적 기준 (85㎡) */
  ruralSpecialTaxAreaThreshold: number;
  /** 국민주택채권 매입 요율 (공시가격 구간별) */
  housingBondRates: HousingBondBracket[];
  /** 법무사 수수료 기준 */
  judicialScrivenerFeeTable: ScrivenerFeeBracket[];
  /** 인지세 (취득가액 구간별 정액) */
  stampTaxBrackets: StampTaxBracket[];
  /** 감면 유형별 요건·감면율 */
  reductions: AcquisitionReduction[];
  /**
   * 공시가격(시가표준액) 1억원 이하 주택 다주택 중과 제외 특례 임계값 (원).
   *
   * 시가표준액이 이 값 이하인 주택은 다주택자(2주택/3주택 이상)라도 취득세 중과세율(8%/12%)
   * 대상에서 제외되어 기본세율(1주택 상당)이 적용된다. 로직은 이 상수를 참조하며 하드코딩하지 않는다.
   * (참고용 추정치. 실제 규칙과 일치하는 100000000 사용.)
   */
  lowValueExemptionThreshold: number;
  /**
   * 최소납부세제 임계값 (원, 지방세특례제한법 제177조의2).
   *
   * 감면대상세액(= 감면 전 취득세 × 감면율)이 이 값을 초과하면 전액 감면(면제) 대상이라도
   * 초과분에 대해서는 일부만 감면하고 나머지를 최소한 납부하도록 한다. 로직은 이 상수를
   * 참조하며 하드코딩하지 않는다. (참고용 추정치: 2000000원)
   */
  minimumPaymentThreshold: number;
  /**
   * 최소납부세제 감면율 (0~1, 지방세특례제한법 제177조의2).
   *
   * 감면대상세액이 최소납부세제 임계값을 초과하는 경우, 임계값 초과분에 대해 이 비율만큼만
   * 추가 감면한다. 즉 초과분의 (1 − 이 비율)은 납부한다. (참고용 추정치: 0.85 = 85% 감면)
   */
  minimumPaymentReductionRate: number;
}

/**
 * 취득세율 구간
 */
export interface AcquisitionTaxBracket {
  propertyType: PropertyType;
  housingCount: HousingCount;
  isAdjustmentArea: boolean;
  /**
   * 비주택 세부 유형 (선택).
   *
   * propertyType이 'non_house'인 구간에만 사용한다. 비주택 취득세율을 유형별
   * (일반/농지/원시취득)로 세분화하며, 매칭 시 입력의 nonHouseType(기본 'general')과
   * 일치하는 구간을 선택한다. 주택(house) 구간에서는 생략한다.
   */
  nonHouseType?: NonHouseType;
  minPrice: number;
  /** undefined = 초과 */
  maxPrice?: number;
  /** 면적 상한 조건 (해당 시) */
  areaMax?: number;
  /** 취득세율 (0~1) */
  rate: number;
}

/**
 * 국민주택채권 매입 요율 구간
 */
export interface HousingBondBracket {
  minOfficialPrice: number;
  maxOfficialPrice?: number;
  /** 채권 매입 요율 */
  rate: number;
}

/**
 * 법무사 수수료 구간
 */
export interface ScrivenerFeeBracket {
  minPrice: number;
  maxPrice?: number;
  /** 수수료 (정액 또는 기준) */
  fee: number;
}

/**
 * 인지세 구간
 */
export interface StampTaxBracket {
  minPrice: number;
  maxPrice?: number;
  /** 인지세 정액 */
  stampTax: number;
}

/**
 * 취득세 감면 유형별 요건·감면율
 */
export interface AcquisitionReduction {
  reductionType: AcquisitionReductionType;
  /** 기본 감면율 (0~1) */
  reductionRate: number;
  /** 장기임대사업자: 면적 구간·취득 요건별 차등 감면율 */
  rentalDifferentialRates?: RentalDifferentialRate[];
  /** 감면 요건 설명 */
  requirements: string;
  /** 사후관리 요건/추징 안내 */
  postManagement?: string;
  /**
   * 최소납부세제 적용 대상 여부 (지방세특례제한법 제177조의2).
   *
   * true이면 감면대상세액이 최소납부세제 임계값(minimumPaymentThreshold)을 초과할 때
   * 초과분에 대해 minimumPaymentReductionRate만큼만 추가 감면하고 나머지는 납부한다.
   * 미지정 시 false(최소납부세제 미적용, 전액 감면)로 간주한다. `none`은 무관하다.
   */
  subjectToMinimumPayment?: boolean;
}

/**
 * 장기임대사업자 차등 감면율
 */
export interface RentalDifferentialRate {
  areaBracket: 'le_60' | 'gt_60_le_85';
  acquisitionRequirement: 'new_build' | 'first_sale';
  /** 차등 감면율 (0~1) */
  reductionRate: number;
}

/* ------------------------------------------------------------------ */
/* 양도세 기준표 데이터 모델                                            */
/* ------------------------------------------------------------------ */

/**
 * 양도세 기준표 데이터
 */
export interface TransferRateData {
  /** 기본세율 6~45% 누진 구간 */
  basicRateBrackets: ProgressiveBracket[];
  /** 다주택 조정지역 중과 가산 */
  heavyMultiSurcharge: {
    /** +20%p */
    twoHouse: number;
    /** +30%p */
    threeOrMoreHouse: number;
  };
  /** 단기보유 중과세율 */
  shortTermRates: {
    /** 1년 미만 70% */
    under1Year: number;
    /** 1년 이상 2년 미만 60% */
    from1To2Year: number;
  };
  /** 양도소득 기본공제 (연 250만원) */
  basicDeductionAmount: number;
  /** 1세대1주택 (보유+거주) 장기보유특별공제 표1 */
  longTermDeductionTable1: LongTermDeductionRow[];
  /** 일반 (보유) 장기보유특별공제 표2 */
  longTermDeductionTable2: LongTermDeductionRow[];
  /** 1세대1주택 비과세 양도가액 상한 (12억) */
  oneHouseExemptionThreshold: number;
  /** 지방소득세율 (양도세 대비 10%) */
  localIncomeTaxRate: number;
}

/**
 * 누진세율 구간
 */
export interface ProgressiveBracket {
  minTaxBase: number;
  /** undefined = 초과 */
  maxTaxBase?: number;
  /** 세율 (0.06 = 6%) */
  rate: number;
  /** 누진공제액 */
  progressiveDeduction: number;
}

/**
 * 장기보유특별공제 표 행
 */
export interface LongTermDeductionRow {
  /** 보유(및 거주) 최소 연수 */
  minYears: number;
  maxYears?: number;
  /** 공제율 (0~1) */
  deductionRate: number;
}

/* ------------------------------------------------------------------ */
/* 중개수수료 기준표 데이터 모델                                        */
/* ------------------------------------------------------------------ */

/**
 * 중개수수료 기준표 데이터
 */
export interface BrokerageRateData {
  /** 임대차 환산 배수 (기본 100) */
  leaseConversionMultiplier: number;
  /** 재산정 배수 (70) */
  leaseConversionFallbackMultiplier: number;
  /** 재산정 기준 금액 (5천만원) */
  leaseConversionThreshold: number;
  /** 거래유형/물건유형/금액 구간별 상한 요율·한도액 */
  rateBrackets: BrokerageRateBracket[];
}

/**
 * 중개수수료 요율 구간
 */
export interface BrokerageRateBracket {
  transactionType: TransactionType;
  propertyType: BrokeragePropertyType;
  minAmount: number;
  /** undefined = 초과 */
  maxAmount?: number;
  /** 상한 요율 */
  upperRate: number;
  /** 한도액 (있으면 min 적용) */
  capAmount?: number;
}
