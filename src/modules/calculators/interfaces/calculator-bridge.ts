/**
 * 계산기 연동 어댑터 (calculator-bridge-adapter) 인터페이스 정의
 *
 * 계약서 분석 서비스(real-estate-contract-analysis)의 calculator-bridge가
 * 전달하는 표준 입력 스키마를 계산기 내부 입력으로 매핑하고, 취득세·중개수수료
 * 결과를 계약서 서비스가 참조하는 출력 스키마로 반환하기 위한 타입을 정의한다.
 * 금액=원, 면적=제곱미터, 계약 기간=개월 단위를 사용한다.
 */

import type { AcquisitionCostInput } from './acquisition-cost.js';
import type { BrokerageFeeInput } from './brokerage-fee.js';

/**
 * 계약서 분석 서비스 calculator-bridge가 전달하는 표준 입력 스키마
 */
export interface CalculatorInputSchema {
  /** 계약 유형: 매매 | 전세 | 월세 | 상가 임대 */
  contractType: 'sale' | 'jeonse' | 'wolse' | 'commercial_lease';
  /** 보증금 (원) */
  deposit?: { value: number; unit: 'KRW' };
  /** 월세 (원) */
  monthlyRent?: { value: number; unit: 'KRW' };
  /** 매매가액 (원) */
  salePrice?: { value: number; unit: 'KRW' };
  /** 관리비 (원) */
  managementFee?: { value: number; unit: 'KRW' };
  /** 계약 기간 (개월) */
  contractPeriod?: { value: number; unit: 'month' };
  /** 면적 (제곱미터) */
  area?: { value: number; unit: 'sqm' };
}

/**
 * 계약서 분석 서비스가 참조하는 출력 스키마
 */
export interface CalculatorOutputSchema {
  /** 취득세 (원) */
  acquisitionTax?: { value: number; unit: 'KRW' };
  /** 중개수수료 (원) */
  brokerageFee?: { value: number; unit: 'KRW' };
}

/**
 * 어댑터 매핑 결과
 */
export interface BridgeAdapterResult {
  /** 계산기 내부 입력으로 매핑된 값 */
  mappedInputs: {
    acquisition?: Partial<AcquisitionCostInput>;
    brokerage?: Partial<BrokerageFeeInput>;
  };
  /** 계산 결과 출력 스키마 */
  output?: CalculatorOutputSchema;
  /** 필수 항목 누락 시 항목명 목록 (계산 미수행) */
  missingFields: string[];
}
