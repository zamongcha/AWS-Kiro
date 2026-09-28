/**
 * 세율 계산기 모듈 인터페이스 정의
 *
 * 세목별 계산 파라미터, 계산 결과, 계산 단계,
 * 감면/비과세 정보를 정의한다.
 */

import type { TaxType } from './tax-types.js';

/**
 * 취득세 계산 파라미터
 */
export interface AcquisitionTaxParams {
  /** 매매가격 (원) */
  purchasePrice: number;
  /** 부동산 유형 */
  propertyType: 'house' | 'land' | 'commercial';
  /** 보유 주택 수 */
  housingCount: number;
  /** 생애 최초 여부 */
  isFirstTime?: boolean;
  /** 전용면적 (㎡) */
  area?: number;
}

/**
 * 양도소득세 계산 파라미터
 */
export interface CapitalGainsTaxParams {
  /** 취득가액 (원) */
  acquisitionPrice: number;
  /** 양도가액 (원) */
  transferPrice: number;
  /** 보유기간 (년) */
  holdingPeriod: number;
  /** 보유 주택 수 */
  housingCount: number;
  /** 거주 여부 */
  isResident?: boolean;
  /** 거주기간 (년) */
  residencePeriod?: number;
}

/**
 * 종합부동산세 계산 파라미터
 */
export interface ComprehensivePropertyTaxParams {
  /** 공시가격 (원) */
  officialPrice: number;
  /** 보유 주택 수 */
  housingCount: number;
  /** 공동 소유 여부 */
  isJointOwnership?: boolean;
}

/**
 * 재산세 계산 파라미터
 */
export interface PropertyTaxParams {
  /** 공시가격 (원) */
  officialPrice: number;
  /** 부동산 유형 */
  propertyType: 'house' | 'land' | 'building';
}

/**
 * 증여세 계산 파라미터
 */
export interface GiftTaxParams {
  /** 증여 금액 (원) */
  giftAmount: number;
  /** 증여자와의 관계 */
  relationship: 'spouse' | 'lineal_ascendant' | 'lineal_descendant' | 'other';
  /** 10년 내 이전 증여액 (원) */
  previousGifts?: number;
}

/**
 * 상속세 계산 파라미터
 */
export interface InheritanceTaxParams {
  /** 상속재산 총액 (원) */
  totalEstate: number;
  /** 채무액 (원) */
  debtAmount?: number;
  /** 상속인 수 */
  heirs: number;
}

/**
 * 세율 계산 파라미터 유니온 타입
 *
 * 세목에 따라 적절한 파라미터 인터페이스를 사용한다.
 */
export type TaxCalculationParams =
  | AcquisitionTaxParams
  | CapitalGainsTaxParams
  | ComprehensivePropertyTaxParams
  | PropertyTaxParams
  | GiftTaxParams
  | InheritanceTaxParams;

/**
 * 세율 계산기 입력 인터페이스
 */
export interface TaxCalculatorInput {
  /** 세목 */
  taxType: TaxType;
  /** 계산 파라미터 */
  parameters: TaxCalculationParams;
}

/**
 * 계산 단계 인터페이스
 *
 * 세액 산출의 각 단계별 계산 과정을 기록한다.
 */
export interface CalculationStep {
  /** 단계 번호 */
  stepNumber: number;
  /** 계산 단계 설명 */
  description: string;
  /** 계산식 */
  formula: string;
  /** 계산 결과 (원) */
  amount: number;
}

/**
 * 감면/비과세 정보 인터페이스
 */
export interface Exemption {
  /** 감면/비과세 명칭 */
  name: string;
  /** 근거 조항 */
  lawArticle: string;
  /** 적용 요건 */
  conditions: string;
  /** 감면 내용 */
  benefit: string;
  /** 적용 가능성 */
  likelihood: 'high' | 'medium' | 'low';
}

/**
 * 세율 계산 결과 인터페이스
 */
export interface TaxCalculationResult {
  /** 세목 */
  taxType: TaxType;
  /** 예상 세액 (원) */
  estimatedTax: number;
  /** 실효세율 (소수점) */
  effectiveRate: number;
  /** 계산 단계 목록 */
  calculationSteps: CalculationStep[];
  /** 적용 세법 조항 */
  appliedArticle: string;
  /** 적용 기준일 (ISO 8601) */
  appliedDate: string;
  /** 감면/비과세 가능성 목록 */
  possibleExemptions: Exemption[];
  /** 참고용 안내 (면책 고지) */
  disclaimer: string;
  /** 계산 완료 여부 */
  isComplete: boolean;
  /** 부족한 정보 항목 */
  missingInfo?: string[];
}
