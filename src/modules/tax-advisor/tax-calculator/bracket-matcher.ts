/**
 * @fileoverview 세율 구간 매칭 모듈
 * @description 금액에 해당하는 세율 구간을 찾고 세액을 계산한다.
 * 누진세율 방식과 단일 세율 방식 모두 지원한다.
 *
 * @requirements 5.1 - 세율 계산 구간 적용
 * @requirements 5.2 - 누진세율 적용
 */

import type { TaxBracket } from '../interfaces/index.js';

/**
 * 구간 매칭 결과 인터페이스
 */
export interface BracketMatchResult {
  /** 매칭된 세율 구간 */
  bracket: TaxBracket;
  /** 해당 구간의 인덱스 */
  index: number;
}

/**
 * 세율 구간 매칭 및 세액 계산 클래스
 *
 * 주어진 금액에 대해 세율 구간을 찾고,
 * 누진 공제를 적용하여 세액을 산출한다.
 */
export class BracketMatcher {
  /**
   * 금액에 해당하는 세율 구간을 찾는다.
   *
   * brackets 배열에서 minAmount <= amount 이고
   * maxAmount가 없거나 amount <= maxAmount인 구간을 반환한다.
   *
   * @param amount - 과세표준 금액 (원)
   * @param brackets - 세율 구간 배열 (minAmount 오름차순 정렬 가정)
   * @returns 매칭된 구간 결과 또는 null (해당 구간 없음)
   */
  findBracket(amount: number, brackets: TaxBracket[]): BracketMatchResult | null {
    if (!brackets || brackets.length === 0) {
      return null;
    }

    // minAmount 기준 오름차순 정렬
    const sorted = [...brackets].sort((a, b) => a.minAmount - b.minAmount);

    for (let i = sorted.length - 1; i >= 0; i--) {
      const bracket = sorted[i];
      if (amount >= bracket.minAmount) {
        // maxAmount가 정의된 경우 범위 내인지 확인
        if (bracket.maxAmount === undefined || amount <= bracket.maxAmount) {
          return { bracket, index: i };
        }
      }
    }

    // 최소 구간 미만인 경우 첫 번째 구간 반환
    return { bracket: sorted[0], index: 0 };
  }

  /**
   * 금액과 세율 구간을 사용하여 세액을 계산한다.
   *
   * 누진 공제액이 있으면 (금액 × 세율 - 누진 공제액) 방식으로 계산하고,
   * 없으면 단순 (금액 × 세율)로 계산한다.
   *
   * @param amount - 과세표준 금액 (원)
   * @param bracket - 적용할 세율 구간
   * @returns 산출 세액 (원, 소수점 이하 절사)
   */
  calculateTax(amount: number, bracket: TaxBracket): number {
    const rawTax = amount * bracket.rate;
    const deduction = bracket.progressiveDeduction || 0;
    const tax = rawTax - deduction;
    return Math.max(Math.floor(tax), 0);
  }

  /**
   * 누진세율 방식으로 총 세액을 계산한다.
   *
   * 각 구간별 금액에 해당 세율을 적용하여 합산한다.
   * (구간별 세액 합산 방식)
   *
   * @param amount - 과세표준 금액 (원)
   * @param brackets - 세율 구간 배열
   * @returns 총 산출 세액 (원)
   */
  calculateProgressiveTax(amount: number, brackets: TaxBracket[]): number {
    if (!brackets || brackets.length === 0) {
      return 0;
    }

    const sorted = [...brackets].sort((a, b) => a.minAmount - b.minAmount);
    let totalTax = 0;
    let remainingAmount = amount;

    for (const bracket of sorted) {
      if (remainingAmount <= 0) break;

      const bracketMin = bracket.minAmount;
      const bracketMax = bracket.maxAmount;

      // 이 구간에서 과세될 금액 결정
      let taxableInBracket: number;
      if (bracketMax === undefined) {
        taxableInBracket = remainingAmount;
      } else {
        const bracketRange = bracketMax - bracketMin;
        taxableInBracket = Math.min(remainingAmount, bracketRange);
      }

      if (taxableInBracket > 0) {
        totalTax += taxableInBracket * bracket.rate;
        remainingAmount -= taxableInBracket;
      }
    }

    return Math.max(Math.floor(totalTax), 0);
  }
}
