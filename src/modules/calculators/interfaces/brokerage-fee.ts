/**
 * 중개수수료 계산기 (brokerage-fee) 인터페이스 정의
 *
 * 임대차 거래금액 환산·상한 요율 구간 조회·한도액 min 적용·오피스텔 전용
 * 요율을 반영하여 중개보수를 산출하는 계산기의 입출력 타입을 정의한다. 결과
 * 봉투는 공통 `CalculationResult<BrokerageFeeDetail>` 제네릭을 사용한다.
 */

import type { BrokeragePropertyType, TransactionType } from './types.js';
import type { CalculationResult } from './result.js';

/**
 * 중개수수료 계산 입력
 */
export interface BrokerageFeeInput {
  /** 매매/교환 | 임대차 */
  transactionType: TransactionType;
  /** 주택/오피스텔/주택 외 */
  propertyType: BrokeragePropertyType;
  /** 매매가액 (매매/교환 시, 원) */
  salePrice?: number;
  /** 보증금 (임대차 시, 원) */
  deposit?: number;
  /** 월세 (임대차 시, 원) */
  monthlyRent?: number;
  /** 오피스텔 전용 요율 요건 충족 여부 */
  officetelQualified?: boolean;
  /** 적용 기준연도 */
  baseYear: number;
}

/**
 * 중개수수료 계산 상세
 */
export interface BrokerageFeeDetail {
  /** 산정된 거래금액 (임대차 환산 반영) */
  transactionAmount: number;
  /** 임대차 환산 배수 (100배 또는 70배) */
  conversionMultiplier?: 100 | 70;
  /** 적용 거래금액 구간 */
  appliedBracket: string;
  /** 적용 상한 요율 */
  upperRate: number;
  /** 구간 한도액 (있으면) */
  capAmount?: number;
  /** 중개보수 상한액 (min(산출액, 한도액)) */
  brokerageFeeUpperLimit: number;
  /** 오피스텔 전용 요율 적용 여부 */
  usedOfficetelRate: boolean;
}

/**
 * 중개수수료 계산 결과
 */
export type BrokerageFeeResult = CalculationResult<BrokerageFeeDetail>;
