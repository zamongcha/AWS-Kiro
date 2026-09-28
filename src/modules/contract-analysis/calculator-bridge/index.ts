/**
 * 계산기 연동기 (CalculatorBridge)
 *
 * 정보 추출기가 추출한 필드(`ExtractedField[]`)를 취득세/중개수수료 계산기
 * 서비스가 소비할 수 있는 표준 인터페이스(`CalculatorBridgeOutput`)로 정리해
 * 전달한다. 각 금액/면적/기간 필드는 단위(KRW/sqm/month)를 명시한다.
 *
 * 본 연동기는 금액 계산 자체는 절대 수행하지 않으며(요구사항 9.5), 추출된
 * 값을 계산기 입력 스키마로 매핑하는 정리·전달 범위까지만 담당한다. 확인
 * 불가(isConfirmable=false)이거나 값이 없는 필드는 계산기 입력 스키마에서
 * 생략된다.
 *
 * @module CalculatorBridge
 * @requirements 9.3, 9.5
 */

import type {
  CalculatorBridgeOutput,
  CalculatorInputSchema,
  ContractType,
  ExtractedField,
} from '../interfaces/index.js';
import { FIELD_NAMES } from '../info-extractor/field-extractor.js';

/** 계산기 연동 표준 인터페이스 스키마 버전 */
export const CALCULATOR_BRIDGE_SCHEMA_VERSION = '1.0.0';

/**
 * 계산기 연동기
 *
 * @requirements 9.3, 9.5
 */
export class CalculatorBridge {
  /**
   * 추출된 필드를 계산기 서비스 표준 입력 스키마로 정리한다.
   *
   * 금액(보증금/월세/매매가/관리비)·계약기간·면적 필드를 단위와 함께 매핑하며,
   * 확인 불가하거나 값이 숫자가 아닌 필드는 스키마에서 제외한다. 계약 유형은
   * 계산기가 세율·요율을 결정하는 데 사용하도록 그대로 전달한다.
   *
   * 이 메서드는 어떤 세액·수수료도 계산하지 않는다(요구사항 9.5).
   *
   * @param contractType - 계약 유형
   * @param extractedFields - 정보 추출기가 산출한 필드 목록
   * @returns 계산기 서비스로 전달할 표준 인터페이스
   *
   * @requirements 9.3, 9.5
   */
  build(contractType: ContractType, extractedFields: ExtractedField[]): CalculatorBridgeOutput {
    const input: CalculatorInputSchema = { contractType };

    const deposit = this.amountOf(extractedFields, FIELD_NAMES.DEPOSIT);
    if (deposit !== null) {
      input.deposit = { value: deposit, unit: 'KRW' };
    }

    const monthlyRent = this.amountOf(extractedFields, FIELD_NAMES.MONTHLY_RENT);
    if (monthlyRent !== null) {
      input.monthlyRent = { value: monthlyRent, unit: 'KRW' };
    }

    const salePrice = this.amountOf(extractedFields, FIELD_NAMES.SALE_PRICE);
    if (salePrice !== null) {
      input.salePrice = { value: salePrice, unit: 'KRW' };
    }

    const managementFee = this.amountOf(extractedFields, FIELD_NAMES.MANAGEMENT_FEE);
    if (managementFee !== null) {
      input.managementFee = { value: managementFee, unit: 'KRW' };
    }

    const period = this.amountOf(extractedFields, FIELD_NAMES.CONTRACT_PERIOD);
    if (period !== null) {
      input.contractPeriod = { value: period, unit: 'month' };
    }

    const area = this.amountOf(extractedFields, FIELD_NAMES.AREA);
    if (area !== null) {
      input.area = { value: area, unit: 'sqm' };
    }

    return {
      schemaVersion: CALCULATOR_BRIDGE_SCHEMA_VERSION,
      input,
    };
  }

  /**
   * 지정한 필드명의 확인 가능한 숫자 값을 조회한다.
   *
   * 필드가 없거나 확인 불가(isConfirmable=false)이거나 값이 유한한 숫자가
   * 아니면 null을 반환한다. 이 경우 해당 항목은 계산기 입력 스키마에서
   * 생략된다.
   *
   * @param fields - 추출 필드 목록
   * @param fieldName - 조회할 필드명
   * @returns 확인 가능한 숫자 값, 없으면 null
   */
  private amountOf(fields: ExtractedField[], fieldName: string): number | null {
    const field = fields.find((item) => item.fieldName === fieldName);
    if (!field || !field.isConfirmable) {
      return null;
    }
    if (typeof field.value !== 'number' || !Number.isFinite(field.value)) {
      return null;
    }
    return field.value;
  }
}
