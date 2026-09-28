/**
 * 계산기 연동기 (calculator-bridge) 인터페이스 정의
 *
 * 추출 정보를 취득세/중개수수료 계산기 서비스로 전달할 표준 인터페이스로
 * 정리한다. 본 연동기는 금액 계산 자체는 수행하지 않는다.
 */

import type { ContractType } from './types.js';

/**
 * 계산기 연동기 출력 (계산기 서비스로 전달할 표준 인터페이스)
 */
export interface CalculatorBridgeOutput {
  /** 스키마 버전 */
  schemaVersion: string;
  /** 계산기 입력 스키마 */
  input: CalculatorInputSchema;
}

/**
 * 계산기 입력 스키마
 */
export interface CalculatorInputSchema {
  /** 계약 유형 */
  contractType: ContractType;
  /** 보증금 */
  deposit?: { value: number; unit: 'KRW' };
  /** 월세 */
  monthlyRent?: { value: number; unit: 'KRW' };
  /** 매매가 */
  salePrice?: { value: number; unit: 'KRW' };
  /** 관리비 */
  managementFee?: { value: number; unit: 'KRW' };
  /** 계약 기간 */
  contractPeriod?: { value: number; unit: 'month' };
  /** 면적 */
  area?: { value: number; unit: 'sqm' };
}

/**
 * 계산기 서비스 출력 스키마 (참조 정의 - 본 서비스는 소비하지 않음)
 */
export interface CalculatorOutputSchema {
  /** 취득세 */
  acquisitionTax?: { value: number; unit: 'KRW' };
  /** 중개수수료 */
  brokerageFee?: { value: number; unit: 'KRW' };
}
