/**
 * @fileoverview 종합부동산세 계산기
 * @description 일정 기준 이상의 부동산을 보유한 경우 부과되는 종합부동산세를 계산한다.
 * 기본공제와 공정시장가액비율을 적용한 후 세율 구간에 따라 세액을 산출한다.
 *
 * @requirements 5.1 - 종합부동산세 계산
 * @requirements 5.2 - 세율 구간 적용
 * @requirements 5.4 - 계산 단계별 산식 기록
 */

import type {
  ComprehensivePropertyTaxParams,
  TaxCalculationResult,
  CalculationStep,
  Exemption,
  TaxBracket,
} from '../../interfaces/index.js';
import { BracketMatcher } from '../bracket-matcher.js';

/**
 * 종합부동산세 기본공제
 * - 1세대 1주택: 12억원
 * - 그 외: 9억원 (인당 6억, 부부공동 9억 기준 단순화)
 */
const BASIC_DEDUCTION_1HOUSE = 1_200_000_000;
const BASIC_DEDUCTION_OTHER = 900_000_000;

/** 공정시장가액비율 (2024년 기준 60%) */
const FAIR_MARKET_RATIO = 0.60;

/**
 * 종합부동산세 일반 세율 (1세대 1주택 / 일반)
 * 과세표준 기준
 */
const GENERAL_BRACKETS: TaxBracket[] = [
  { minAmount: 0, maxAmount: 300_000_000, rate: 0.005, progressiveDeduction: 0 },
  { minAmount: 300_000_001, maxAmount: 600_000_000, rate: 0.007, progressiveDeduction: 600_000 },
  { minAmount: 600_000_001, maxAmount: 1_200_000_000, rate: 0.01, progressiveDeduction: 2_400_000 },
  { minAmount: 1_200_000_001, maxAmount: 2_500_000_000, rate: 0.013, progressiveDeduction: 6_000_000 },
  { minAmount: 2_500_000_001, maxAmount: 9_400_000_000, rate: 0.02, progressiveDeduction: 23_500_000 },
  { minAmount: 9_400_000_001, rate: 0.027, progressiveDeduction: 89_300_000 },
];

/**
 * 종합부동산세 다주택 세율 (2주택 이상)
 */
const MULTI_HOUSE_BRACKETS: TaxBracket[] = [
  { minAmount: 0, maxAmount: 300_000_000, rate: 0.005, progressiveDeduction: 0 },
  { minAmount: 300_000_001, maxAmount: 600_000_000, rate: 0.007, progressiveDeduction: 600_000 },
  { minAmount: 600_000_001, maxAmount: 1_200_000_000, rate: 0.01, progressiveDeduction: 2_400_000 },
  { minAmount: 1_200_000_001, maxAmount: 2_500_000_000, rate: 0.02, progressiveDeduction: 14_400_000 },
  { minAmount: 2_500_000_001, maxAmount: 9_400_000_000, rate: 0.035, progressiveDeduction: 51_900_000 },
  { minAmount: 9_400_000_001, rate: 0.05, progressiveDeduction: 192_900_000 },
];

/** 면책 고지 */
const DISCLAIMER = '본 계산은 참고용 추정치이며 실제 세액과 차이가 있을 수 있습니다.';

/**
 * 종합부동산세 계산기 클래스
 */
export class ComprehensivePropertyTaxCalculator {
  private bracketMatcher: BracketMatcher;

  constructor() {
    this.bracketMatcher = new BracketMatcher();
  }

  /**
   * 종합부동산세를 계산한다.
   *
   * @param params - 종합부동산세 계산 파라미터
   * @returns 계산 결과
   */
  calculate(params: ComprehensivePropertyTaxParams): TaxCalculationResult {
    const steps: CalculationStep[] = [];
    const exemptions: Exemption[] = [];
    let stepNumber = 1;

    const { officialPrice, housingCount, isJointOwnership } = params;

    // Step 1: 기본공제 적용
    const basicDeduction = housingCount === 1 ? BASIC_DEDUCTION_1HOUSE : BASIC_DEDUCTION_OTHER;
    const afterDeduction = Math.max(officialPrice - basicDeduction, 0);

    steps.push({
      stepNumber: stepNumber++,
      description: `기본공제 적용 (${housingCount === 1 ? '1세대 1주택 12억' : '일반 9억'})`,
      formula: `공시가격(${officialPrice.toLocaleString()}) - 기본공제(${basicDeduction.toLocaleString()}) = ${afterDeduction.toLocaleString()}원`,
      amount: afterDeduction,
    });

    // 기본공제 후 0원이면 납부세액 없음
    if (afterDeduction <= 0) {
      steps.push({
        stepNumber: stepNumber++,
        description: '과세표준 0원 - 납부세액 없음',
        formula: '종합부동산세 = 0원',
        amount: 0,
      });

      return {
        taxType: 'comprehensive_property',
        estimatedTax: 0,
        effectiveRate: 0,
        calculationSteps: steps,
        appliedArticle: '종합부동산세법 제8조 (과세표준)',
        appliedDate: new Date().toISOString().split('T')[0],
        possibleExemptions: exemptions,
        disclaimer: DISCLAIMER,
        isComplete: true,
      };
    }

    // Step 2: 공정시장가액비율 적용
    const taxBase = Math.floor(afterDeduction * FAIR_MARKET_RATIO);
    steps.push({
      stepNumber: stepNumber++,
      description: `공정시장가액비율 적용 (${(FAIR_MARKET_RATIO * 100).toFixed(0)}%)`,
      formula: `과세표준 = ${afterDeduction.toLocaleString()} × ${(FAIR_MARKET_RATIO * 100).toFixed(0)}% = ${taxBase.toLocaleString()}원`,
      amount: taxBase,
    });

    // Step 3: 세율 적용
    const brackets = housingCount >= 2 ? MULTI_HOUSE_BRACKETS : GENERAL_BRACKETS;
    const matchResult = this.bracketMatcher.findBracket(taxBase, brackets);

    let taxAmount: number;
    if (matchResult) {
      taxAmount = this.bracketMatcher.calculateTax(taxBase, matchResult.bracket);
    } else {
      taxAmount = Math.floor(taxBase * 0.005);
    }

    const appliedRate = matchResult ? matchResult.bracket.rate : 0.005;
    steps.push({
      stepNumber: stepNumber++,
      description: `세율 적용: ${(appliedRate * 100).toFixed(1)}%${housingCount >= 2 ? ' (다주택 세율)' : ''}`,
      formula: `산출세액 = ${taxBase.toLocaleString()} × ${(appliedRate * 100).toFixed(1)}% - 누진공제 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    // 최종 세액
    steps.push({
      stepNumber: stepNumber++,
      description: '최종 종합부동산세액',
      formula: `종합부동산세 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    const effectiveRate = officialPrice > 0 ? taxAmount / officialPrice : 0;

    // 감면 가능성 안내
    if (housingCount === 1) {
      exemptions.push({
        name: '1세대 1주택 세액공제',
        lawArticle: '종합부동산세법 제9조 제3항',
        conditions: '만 60세 이상 또는 5년 이상 보유 시 20~50% 세액공제',
        benefit: '최대 50% 세액 공제 (고령자 + 장기보유 합산 최대 80%)',
        likelihood: 'medium',
      });
    }

    if (isJointOwnership) {
      exemptions.push({
        name: '공동소유 각각 과세',
        lawArticle: '종합부동산세법 제7조',
        conditions: '부부 공동명의 시 각각 6억씩 공제 가능',
        benefit: '합산 12억 공제 가능',
        likelihood: 'high',
      });
    }

    return {
      taxType: 'comprehensive_property',
      estimatedTax: taxAmount,
      effectiveRate,
      calculationSteps: steps,
      appliedArticle: '종합부동산세법 제9조 (세율)',
      appliedDate: new Date().toISOString().split('T')[0],
      possibleExemptions: exemptions,
      disclaimer: DISCLAIMER,
      isComplete: true,
    };
  }
}
