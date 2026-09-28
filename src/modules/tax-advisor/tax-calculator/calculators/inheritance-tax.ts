/**
 * @fileoverview 상속세 계산기
 * @description 상속 시 부과되는 상속세를 계산한다.
 * 기본공제(일괄공제)와 채무공제를 적용한 후 누진세율을 적용한다.
 *
 * @requirements 5.1 - 상속세 계산
 * @requirements 5.2 - 누진세율 적용
 * @requirements 5.4 - 계산 단계별 산식 기록
 * @requirements 5.5 - 감면/비과세 가능성 체크
 */

import type {
  InheritanceTaxParams,
  TaxCalculationResult,
  CalculationStep,
  Exemption,
  TaxBracket,
} from '../../interfaces/index.js';
import { BracketMatcher } from '../bracket-matcher.js';

/**
 * 상속세 세율 (누진)
 * 상속세 및 증여세법 제26조
 */
const INHERITANCE_TAX_BRACKETS: TaxBracket[] = [
  { minAmount: 0, maxAmount: 100_000_000, rate: 0.10, progressiveDeduction: 0 },
  { minAmount: 100_000_001, maxAmount: 500_000_000, rate: 0.20, progressiveDeduction: 10_000_000 },
  { minAmount: 500_000_001, maxAmount: 1_000_000_000, rate: 0.30, progressiveDeduction: 60_000_000 },
  { minAmount: 1_000_000_001, maxAmount: 3_000_000_000, rate: 0.40, progressiveDeduction: 160_000_000 },
  { minAmount: 3_000_000_001, rate: 0.50, progressiveDeduction: 460_000_000 },
];

/**
 * 일괄공제: 5억원
 * 상속세 및 증여세법 제21조
 */
const LUMP_SUM_DEDUCTION = 500_000_000;

/**
 * 배우자 상속공제 최소: 5억원, 최대: 30억원
 */
const SPOUSE_DEDUCTION_MIN = 500_000_000;
const SPOUSE_DEDUCTION_MAX = 3_000_000_000;

/** 면책 고지 */
const DISCLAIMER = '본 계산은 참고용 추정치이며 실제 세액과 차이가 있을 수 있습니다.';

/**
 * 상속세 계산기 클래스
 */
export class InheritanceTaxCalculator {
  private bracketMatcher: BracketMatcher;

  constructor() {
    this.bracketMatcher = new BracketMatcher();
  }

  /**
   * 상속세를 계산한다.
   *
   * @param params - 상속세 계산 파라미터
   * @returns 계산 결과
   */
  calculate(params: InheritanceTaxParams): TaxCalculationResult {
    const steps: CalculationStep[] = [];
    const exemptions: Exemption[] = [];
    let stepNumber = 1;

    const { totalEstate, debtAmount, heirs } = params;

    // Step 1: 상속재산가액 확정
    steps.push({
      stepNumber: stepNumber++,
      description: '상속재산가액 확정',
      formula: `상속재산가액 = ${totalEstate.toLocaleString()}원`,
      amount: totalEstate,
    });

    // Step 2: 채무공제 적용
    const debt = debtAmount || 0;
    const afterDebt = Math.max(totalEstate - debt, 0);

    if (debt > 0) {
      steps.push({
        stepNumber: stepNumber++,
        description: '채무 및 공과금 공제',
        formula: `${totalEstate.toLocaleString()} - ${debt.toLocaleString()} = ${afterDebt.toLocaleString()}원`,
        amount: afterDebt,
      });
    }

    // Step 3: 일괄공제 적용 (5억원)
    const taxBase = Math.max(afterDebt - LUMP_SUM_DEDUCTION, 0);
    steps.push({
      stepNumber: stepNumber++,
      description: `일괄공제 적용 (${LUMP_SUM_DEDUCTION.toLocaleString()}원)`,
      formula: `과세표준 = ${afterDebt.toLocaleString()} - ${LUMP_SUM_DEDUCTION.toLocaleString()} = ${taxBase.toLocaleString()}원`,
      amount: taxBase,
    });

    // 과세표준이 0이면 세액 없음
    if (taxBase <= 0) {
      steps.push({
        stepNumber: stepNumber++,
        description: '과세표준 0원 - 상속세 없음',
        formula: '상속세 = 0원',
        amount: 0,
      });

      return {
        taxType: 'inheritance',
        estimatedTax: 0,
        effectiveRate: 0,
        calculationSteps: steps,
        appliedArticle: '상속세 및 증여세법 제21조 (일괄공제)',
        appliedDate: new Date().toISOString().split('T')[0],
        possibleExemptions: exemptions,
        disclaimer: DISCLAIMER,
        isComplete: true,
      };
    }

    // Step 4: 세율 적용
    const matchResult = this.bracketMatcher.findBracket(taxBase, INHERITANCE_TAX_BRACKETS);
    let taxAmount: number;
    let appliedRate: number;

    if (matchResult) {
      taxAmount = this.bracketMatcher.calculateTax(taxBase, matchResult.bracket);
      appliedRate = matchResult.bracket.rate;
    } else {
      taxAmount = Math.floor(taxBase * 0.10);
      appliedRate = 0.10;
    }

    steps.push({
      stepNumber: stepNumber++,
      description: `세율 적용: ${(appliedRate * 100).toFixed(0)}%`,
      formula: `산출세액 = ${taxBase.toLocaleString()} × ${(appliedRate * 100).toFixed(0)}% - 누진공제 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    // 최종 세액
    steps.push({
      stepNumber: stepNumber++,
      description: '최종 상속세액',
      formula: `상속세 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    const effectiveRate = totalEstate > 0 ? taxAmount / totalEstate : 0;

    // 감면 가능성 안내
    exemptions.push({
      name: '배우자 상속공제',
      lawArticle: '상속세 및 증여세법 제19조',
      conditions: '배우자 생존 시, 법정상속분 한도 내',
      benefit: `최소 ${SPOUSE_DEDUCTION_MIN.toLocaleString()}원 ~ 최대 ${SPOUSE_DEDUCTION_MAX.toLocaleString()}원 공제`,
      likelihood: heirs >= 2 ? 'high' : 'low',
    });

    exemptions.push({
      name: '상속세 신고세액공제',
      lawArticle: '상속세 및 증여세법 제69조',
      conditions: '법정 신고기한(6개월) 내 신고 시',
      benefit: '산출세액의 3% 공제',
      likelihood: 'high',
    });

    if (totalEstate > 1_000_000_000) {
      exemptions.push({
        name: '금융재산 상속공제',
        lawArticle: '상속세 및 증여세법 제22조',
        conditions: '순금융재산 존재 시 (금융자산 - 금융부채)',
        benefit: '최대 2억원 공제',
        likelihood: 'medium',
      });
    }

    return {
      taxType: 'inheritance',
      estimatedTax: taxAmount,
      effectiveRate,
      calculationSteps: steps,
      appliedArticle: '상속세 및 증여세법 제26조 (상속세 세율)',
      appliedDate: new Date().toISOString().split('T')[0],
      possibleExemptions: exemptions,
      disclaimer: DISCLAIMER,
      isComplete: true,
    };
  }
}
