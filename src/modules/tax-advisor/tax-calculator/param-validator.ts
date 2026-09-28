/**
 * @fileoverview 세율 계산 파라미터 검증 모듈
 * @description 세목별 필수 파라미터를 검증하고
 * 누락된 필드를 감지하여 사용자에게 안내한다.
 *
 * @requirements 5.6 - 불완전 파라미터 감지, isComplete=false 및 missingInfo 반환
 */

import type { TaxType, TaxCalculationParams } from '../interfaces/index.js';

/**
 * 파라미터 검증 결과 인터페이스
 */
export interface ParamValidationResult {
  /** 검증 통과 여부 */
  isValid: boolean;
  /** 누락된 필드 목록 */
  missingFields: string[];
}

/**
 * 세목별 필수 필드 정의
 */
const REQUIRED_FIELDS: Record<TaxType, string[]> = {
  acquisition: ['purchasePrice', 'propertyType', 'housingCount'],
  capital_gains: ['acquisitionPrice', 'transferPrice', 'holdingPeriod', 'housingCount'],
  comprehensive_property: ['officialPrice', 'housingCount'],
  property: ['officialPrice', 'propertyType'],
  gift: ['giftAmount', 'relationship'],
  inheritance: ['totalEstate', 'heirs'],
};

/**
 * 세목별 필수 필드의 한국어 라벨
 */
const FIELD_LABELS: Record<string, string> = {
  purchasePrice: '매매가격',
  propertyType: '부동산 유형',
  housingCount: '보유 주택 수',
  acquisitionPrice: '취득가액',
  transferPrice: '양도가액',
  holdingPeriod: '보유기간',
  officialPrice: '공시가격',
  giftAmount: '증여 금액',
  relationship: '증여자와의 관계',
  totalEstate: '상속재산 총액',
  heirs: '상속인 수',
  debtAmount: '채무액',
  area: '전용면적',
  isFirstTime: '생애 최초 여부',
  isResident: '거주 여부',
  residencePeriod: '거주기간',
  isJointOwnership: '공동 소유 여부',
  previousGifts: '이전 증여액',
};

/**
 * 세율 계산 파라미터 검증기
 *
 * 세목별 필수 파라미터를 검증하고 누락 필드를 보고한다.
 */
export class ParamValidator {
  /**
   * 세목에 맞는 파라미터를 검증한다.
   *
   * @param taxType - 세목 유형
   * @param params - 계산 파라미터 객체
   * @returns 검증 결과 (isValid, missingFields)
   */
  validate(taxType: TaxType, params: TaxCalculationParams): ParamValidationResult {
    const requiredFields = REQUIRED_FIELDS[taxType];

    if (!requiredFields) {
      return { isValid: false, missingFields: ['taxType (지원하지 않는 세목)'] };
    }

    const missingFields: string[] = [];
    const paramsRecord = params as unknown as Record<string, unknown>;

    for (const field of requiredFields) {
      const value = paramsRecord[field];
      if (value === undefined || value === null) {
        missingFields.push(field);
      } else if (typeof value === 'number' && value < 0) {
        missingFields.push(field);
      }
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * 누락 필드의 한국어 라벨을 반환한다.
   *
   * @param fields - 필드명 배열
   * @returns 한국어 라벨 배열
   */
  getFieldLabels(fields: string[]): string[] {
    return fields.map(field => FIELD_LABELS[field] || field);
  }

  /**
   * 특정 세목의 필수 필드 목록을 반환한다.
   *
   * @param taxType - 세목 유형
   * @returns 필수 필드명 배열
   */
  getRequiredFields(taxType: TaxType): string[] {
    return REQUIRED_FIELDS[taxType] || [];
  }
}
