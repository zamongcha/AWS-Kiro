/**
 * @fileoverview 양도소득세 계산기
 * @description 부동산 양도 시 부과되는 양도소득세를 계산한다.
 * 보유기간, 거주기간, 주택 수에 따라 장기보유특별공제 및 중과세율이 적용된다.
 *
 * @requirements 5.1 - 양도소득세 계산
 * @requirements 5.2 - 누진세율 적용
 * @requirements 5.3 - 장기보유특별공제
 * @requirements 5.4 - 계산 단계별 산식 기록
 * @requirements 5.5 - 감면/비과세 가능성 체크
 */

import type {
  CapitalGainsTaxParams,
  TaxCalculationResult,
  CalculationStep,
  Exemption,
  TaxBracket,
} from '../../interfaces/index.js';
import { BracketMatcher } from '../bracket-matcher.js';

/**
 * 양도소득세 기본 세율 (종합소득세율 동일)
 * 2024년 기준 소득세법 제104조
 */
const INCOME_TAX_BRACKETS: TaxBracket[] = [
  { minAmount: 0, maxAmount: 14_000_000, rate: 0.06, progressiveDeduction: 0 },
  { minAmount: 14_000_001, maxAmount: 50_000_000, rate: 0.15, progressiveDeduction: 1_260_000 },
  { minAmount: 50_000_001, maxAmount: 88_000_000, rate: 0.24, progressiveDeduction: 5_760_000 },
  { minAmount: 88_000_001, maxAmount: 150_000_000, rate: 0.35, progressiveDeduction: 15_440_000 },
  { minAmount: 150_000_001, maxAmount: 300_000_000, rate: 0.38, progressiveDeduction: 19_940_000 },
  { minAmount: 300_000_001, maxAmount: 500_000_000, rate: 0.40, progressiveDeduction: 25_940_000 },
  { minAmount: 500_000_001, maxAmount: 1_000_000_000, rate: 0.42, progressiveDeduction: 35_940_000 },
  { minAmount: 1_000_000_001, rate: 0.45, progressiveDeduction: 65_940_000 },
];

/** 기본공제 250만원 */
const BASIC_DEDUCTION = 2_500_000;

/** 1세대 1주택 비과세 기준금액 */
const ONE_HOUSE_EXEMPTION_LIMIT = 1_200_000_000;

/** 다주택 중과 추가세율 */
const SURCHARGE_2HOUSE = 0.20; // +20%p
const SURCHARGE_3HOUSE = 0.30; // +30%p

/** 면책 고지 */
const DISCLAIMER = '본 계산은 참고용 추정치이며 실제 세액과 차이가 있을 수 있습니다.';

/**
 * 양도소득세 계산기 클래스
 */
export class CapitalGainsTaxCalculator {
  private bracketMatcher: BracketMatcher;

  constructor() {
    this.bracketMatcher = new BracketMatcher();
  }

  /**
   * 양도소득세를 계산한다.
   *
   * @param params - 양도소득세 계산 파라미터
   * @returns 계산 결과
   */
  calculate(params: CapitalGainsTaxParams): TaxCalculationResult {
    const steps: CalculationStep[] = [];
    const exemptions: Exemption[] = [];
    let stepNumber = 1;

    const {
      acquisitionPrice,
      transferPrice,
      holdingPeriod,
      housingCount,
      isResident,
      residencePeriod,
    } = params;

    // Step 1: 양도차익 계산
    const gain = transferPrice - acquisitionPrice;
    steps.push({
      stepNumber: stepNumber++,
      description: '양도차익 계산',
      formula: `양도차익 = 양도가액(${transferPrice.toLocaleString()}) - 취득가액(${acquisitionPrice.toLocaleString()}) = ${gain.toLocaleString()}원`,
      amount: gain,
    });

    // 양도차익이 없으면 세액 0
    if (gain <= 0) {
      steps.push({
        stepNumber: stepNumber++,
        description: '양도차익 없음 - 세액 0원',
        formula: '양도소득세 = 0원 (양도차손)',
        amount: 0,
      });

      return {
        taxType: 'capital_gains',
        estimatedTax: 0,
        effectiveRate: 0,
        calculationSteps: steps,
        appliedArticle: '소득세법 제95조 (양도소득금액)',
        appliedDate: new Date().toISOString().split('T')[0],
        possibleExemptions: exemptions,
        disclaimer: DISCLAIMER,
        isComplete: true,
      };
    }

    // 1세대 1주택 비과세 체크
    if (housingCount === 1 && holdingPeriod >= 2) {
      if (transferPrice <= ONE_HOUSE_EXEMPTION_LIMIT) {
        steps.push({
          stepNumber: stepNumber++,
          description: '1세대 1주택 비과세 적용 (2년 이상 보유, 12억 이하)',
          formula: `양도소득세 = 0원 (비과세)`,
          amount: 0,
        });

        exemptions.push({
          name: '1세대 1주택 비과세',
          lawArticle: '소득세법 제89조 제1항 제3호',
          conditions: '1세대 1주택, 2년 이상 보유, 양도가액 12억원 이하',
          benefit: '양도소득세 전액 비과세',
          likelihood: 'high',
        });

        return {
          taxType: 'capital_gains',
          estimatedTax: 0,
          effectiveRate: 0,
          calculationSteps: steps,
          appliedArticle: '소득세법 제89조 제1항 제3호 (1세대 1주택 비과세)',
          appliedDate: new Date().toISOString().split('T')[0],
          possibleExemptions: exemptions,
          disclaimer: DISCLAIMER,
          isComplete: true,
        };
      } else {
        // 12억 초과 부분만 과세 (비과세 상한초과)
        exemptions.push({
          name: '1세대 1주택 비과세 (12억 초과분 과세)',
          lawArticle: '소득세법 제89조 제1항 제3호',
          conditions: '1세대 1주택, 2년 이상 보유, 양도가액 12억원 초과분에 대해 과세',
          benefit: '12억원 이하 분은 비과세',
          likelihood: 'high',
        });
      }
    }

    // Step 2: 장기보유특별공제 계산
    let longTermDeductionRate = 0;
    if (holdingPeriod >= 3) {
      // 보유기간에 따른 공제: 연 2%
      const holdingDeduction = Math.min(holdingPeriod, 15) * 0.02; // 최대 30%

      // 거주기간에 따른 추가 공제: 연 4% (1세대 1주택)
      let residenceDeduction = 0;
      if (housingCount === 1 && isResident && residencePeriod && residencePeriod >= 2) {
        residenceDeduction = Math.min(residencePeriod, 10) * 0.04; // 최대 40%
      }

      longTermDeductionRate = Math.min(holdingDeduction + residenceDeduction, 0.80);
    }

    const longTermDeduction = Math.floor(gain * longTermDeductionRate);
    const afterLongTermDeduction = gain - longTermDeduction;

    steps.push({
      stepNumber: stepNumber++,
      description: `장기보유특별공제 (${(longTermDeductionRate * 100).toFixed(0)}%)`,
      formula: `공제액 = ${gain.toLocaleString()} × ${(longTermDeductionRate * 100).toFixed(0)}% = ${longTermDeduction.toLocaleString()}원`,
      amount: afterLongTermDeduction,
    });

    // Step 3: 기본공제 적용
    const taxableGain = Math.max(afterLongTermDeduction - BASIC_DEDUCTION, 0);
    steps.push({
      stepNumber: stepNumber++,
      description: '양도소득 기본공제 (250만원)',
      formula: `과세표준 = ${afterLongTermDeduction.toLocaleString()} - ${BASIC_DEDUCTION.toLocaleString()} = ${taxableGain.toLocaleString()}원`,
      amount: taxableGain,
    });

    // Step 4: 세율 적용 (다주택 중과 포함)
    let taxAmount: number;
    let surchargeRate = 0;

    if (housingCount >= 3) {
      surchargeRate = SURCHARGE_3HOUSE;
    } else if (housingCount === 2) {
      surchargeRate = SURCHARGE_2HOUSE;
    }

    // 기본세율 적용
    const matchResult = this.bracketMatcher.findBracket(taxableGain, INCOME_TAX_BRACKETS);
    if (matchResult) {
      taxAmount = this.bracketMatcher.calculateTax(taxableGain, matchResult.bracket);
    } else {
      taxAmount = Math.floor(taxableGain * 0.06); // 최저세율 적용
    }

    const baseRate = matchResult ? matchResult.bracket.rate : 0.06;

    if (surchargeRate > 0) {
      // 중과세 추가
      const surchargeAmount = Math.floor(taxableGain * surchargeRate);
      steps.push({
        stepNumber: stepNumber++,
        description: `세율 적용: 기본세율 ${(baseRate * 100).toFixed(0)}% + 중과 ${(surchargeRate * 100).toFixed(0)}%p`,
        formula: `산출세액 = ${taxAmount.toLocaleString()} + 중과(${surchargeAmount.toLocaleString()}) = ${(taxAmount + surchargeAmount).toLocaleString()}원`,
        amount: taxAmount + surchargeAmount,
      });
      taxAmount += surchargeAmount;
    } else {
      steps.push({
        stepNumber: stepNumber++,
        description: `세율 적용: 기본세율 ${(baseRate * 100).toFixed(0)}%`,
        formula: `산출세액 = ${taxableGain.toLocaleString()} × ${(baseRate * 100).toFixed(0)}% - 누진공제 = ${taxAmount.toLocaleString()}원`,
        amount: taxAmount,
      });
    }

    // 최종 결과 단계
    steps.push({
      stepNumber: stepNumber++,
      description: '최종 양도소득세액',
      formula: `양도소득세 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    const effectiveRate = transferPrice > 0 ? taxAmount / (transferPrice - acquisitionPrice) : 0;

    // 장기보유특별공제 가능성 안내
    if (holdingPeriod < 3) {
      exemptions.push({
        name: '장기보유특별공제',
        lawArticle: '소득세법 제95조 제2항',
        conditions: '3년 이상 보유 시 연 2%, 거주 시 연 4% 추가, 최대 80%',
        benefit: '양도차익에서 공제',
        likelihood: 'low',
      });
    }

    return {
      taxType: 'capital_gains',
      estimatedTax: taxAmount,
      effectiveRate: Math.max(effectiveRate, 0),
      calculationSteps: steps,
      appliedArticle: '소득세법 제104조 (양도소득세 세율)',
      appliedDate: new Date().toISOString().split('T')[0],
      possibleExemptions: exemptions,
      disclaimer: DISCLAIMER,
      isComplete: true,
    };
  }
}
