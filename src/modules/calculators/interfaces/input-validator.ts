/**
 * 입력 검증기 (input-validator) 인터페이스 정의
 *
 * 계산기 모듈 실행 전 원시 입력의 필수 항목 존재·타입 일치·음수 아님·기준표
 * 유효 상한 이하 여부를 검증하는 검증기의 입출력 타입을 정의한다. 검증 규칙은
 * 필수 항목 존재 → 타입 일치 → 음수 아님(0 이상) → 기준표 유효 상한 이하
 * 순서로 적용하며, 하나라도 실패하면 계산을 수행하지 않고 입력값을 보존한다.
 */

import type { CalculatorType } from './types.js';

/**
 * 검증 입력
 *
 * 계산기 유형과 계산기별 원시 입력, 기준표에서 정의한 상한/열거값 제약을 담는다.
 */
export interface ValidationInput {
  /** 계산기 유형 */
  calculatorType: CalculatorType;
  /** 계산기별 원시 입력 */
  payload: Record<string, unknown>;
  /** 기준표 정의 상한/열거값 */
  rateTableConstraints: RateTableConstraints;
}

/**
 * 기준표 제약 (입력 검증용 상한/열거값)
 */
export interface RateTableConstraints {
  /** 금액 유효 상한 */
  maxAmount: number;
  /** 면적 유효 상한 */
  maxArea: number;
  /** 보유기간 유효 상한 (년) */
  maxHoldingPeriod: number;
}

/**
 * 검증 결과
 *
 * 검증 통과 여부와 오류 목록, 성공 시 검증된 입력, 원본 입력 보존값을 담는다.
 */
export interface ValidationResult {
  /** 검증 통과 여부 */
  isValid: boolean;
  /** 검증 오류 목록 (실패 시 1개 이상) */
  errors: ValidationError[];
  /** 성공 시 검증된 입력 */
  validatedPayload?: Record<string, unknown>;
  /** 원본 입력 보존 */
  preservedInput: Record<string, unknown>;
}

/**
 * 검증 오류
 *
 * 검증 실패 항목의 오류 유형·대상 항목명·사용자 안내·기대 형식/범위를 담는다.
 */
export interface ValidationError {
  /** 오류 유형: 필수 누락 | 음수 | 상한 초과 | 타입 불일치 */
  type: 'missing' | 'negative' | 'exceeds_max' | 'type_mismatch';
  /** 대상 항목명 */
  field: string;
  /** 사용자 안내 (기대 형식/범위) */
  message: string;
  /** 기대 형식/범위 설명 */
  expected?: string;
}
