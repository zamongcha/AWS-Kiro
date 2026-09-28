/**
 * 부동산 세무 AI 자문 시스템 핵심 타입 정의
 *
 * 세목, 세율 구간, 특수 세율, 공제, 세율 테이블 데이터 등
 * 세무 도메인의 기본 타입을 정의한다.
 */

/**
 * 세목 유형
 *
 * 시스템이 지원하는 부동산 관련 세목을 나타낸다.
 */
export type TaxType =
  | 'acquisition'             // 취득세
  | 'capital_gains'           // 양도소득세
  | 'comprehensive_property'  // 종합부동산세
  | 'property'                // 재산세
  | 'gift'                    // 증여세
  | 'inheritance';            // 상속세

/**
 * 세율 구간 인터페이스
 *
 * 누진세율 적용을 위한 세율 구간 정보를 나타낸다.
 */
export interface TaxBracket {
  /** 과세표준 하한 (원) */
  minAmount: number;
  /** 과세표준 상한 (원). undefined = 초과 구간 */
  maxAmount?: number;
  /** 적용 세율 (소수점, 예: 0.06 = 6%) */
  rate: number;
  /** 누진 공제액 (원) */
  progressiveDeduction?: number;
  /** 추가 적용 조건 */
  conditions?: Record<string, unknown>;
}

/**
 * 특수 세율 인터페이스
 *
 * 일반 누진세율 외에 특별히 적용되는 세율 정보를 나타낸다.
 */
export interface SpecialRate {
  /** 적용 조건 설명 */
  condition: string;
  /** 적용 세율 (소수점) */
  rate: number;
  /** 설명 */
  description: string;
}

/**
 * 공제 항목 인터페이스
 *
 * 세액 산출 시 적용 가능한 공제 항목 정보를 나타낸다.
 */
export interface Deduction {
  /** 공제 항목명 */
  name: string;
  /** 공제 금액 (원) */
  amount?: number;
  /** 공제 계산식 */
  formula?: string;
  /** 적용 조건 */
  conditions: string;
}

/**
 * 세율 테이블 데이터 인터페이스
 *
 * DynamoDB에 저장되는 구조화된 세율 데이터를 나타낸다.
 * 세법 조항에서 추출된 세율 구간, 특수 세율, 공제 항목을 포함한다.
 */
export interface RateTableData {
  /** 적용 세목 */
  taxType: TaxType;
  /** 적용 기준일 (ISO 8601) */
  effectiveDate: string;
  /** 만료일 (개정 시 설정, ISO 8601) */
  expiryDate?: string;
  /** 세율 테이블 버전 */
  version: number;
  /** 세율 구간 목록 */
  brackets: TaxBracket[];
  /** 특수 세율 목록 */
  specialRates?: SpecialRate[];
  /** 공제 항목 목록 */
  deductions?: Deduction[];
  /** 근거 세법 조항 */
  sourceArticle: string;
}
