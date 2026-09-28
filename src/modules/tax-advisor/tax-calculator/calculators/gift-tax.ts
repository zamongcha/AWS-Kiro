/**
 * @fileoverview 증여세 계산기
 * @description 부동산 증여 시 부과되는 증여세를 계산한다.
 * 증여자와의 관계에 따라 증여재산공제가 적용되며,
 * 과세표준에 누진세율을 적용한다.
 *
 * @requirements 5.1 - 증여세 계산
 * @requirements 5.2 - 누진세율 적용
 * @requirements 5.4 - 계산 단계별 산식 기록
 * @requirements 5.5 - 감면/비과세 가능성 체크
 */

import type {
  GiftTaxParams,
  TaxCalculationResult,
  CalculationStep,
  Exemption,
  TaxBracket,
} from '../../interfaces/index.js';
import { BracketMatcher } from '../bracket-matcher.js';

/**
 * 증여세 세율 (누진)
 * 상속세 및 증여세법 제26조
 */
const GIFT_TAX_BRACKETS: TaxBracket[] = [
  { minAmount: 0, maxAmount: 100_000_000, rate: 0.10, progressiveDeduction: 0 },
  { minAmount: 100_000_001, maxAmount: 500_000_000, rate: 0.20, progressiveDeduction: 10_000_000 },
  { minAmount: 500_000_001, maxAmount: 1_000_000_000, rate: 0.30, progressiveDeduction: 60_000_000 },
  { minAmount: 1_000_000_001, maxAmount: 3_000_000_000, rate: 0.40, progressiveDeduction: 160_000_000 },
  { minAmount: 3_000_000_001, rate: 0.50, progressiveDeduction: 460_000_000 },
];

/**
 * 증여재산공제 (10년간 합산, 2024년 기준)
 * 상속세 및 증여세법 제53조
 */
const GIFT_DEDUCTIONS: Record<string, number> = {
  spouse: 600_000_000,            // 배우자: 6억원
  lineal_ascendant: 50_000_000,   // 직계존속→성년 자녀: 5천만원
  lineal_descendant: 50_000_000,  // 직계비속: 5천만원
  other: 10_000_000,              // 기타 친족: 1천만원
};

/** 미성년자 증여재산공제 */
const MINOR_DEDUCTION = 20_000_000; // 2천만원

/** 면책 고지 */
const DISCLAIMER = '본 계산은 참고용 추정치이며 실제 세액과 차이가 있을 수 있습니다.';

/**
 * 증여세 계산기 클래스
 */
export class GiftTaxCalculator {
  private bracketMatcher: BracketMatcher;

  constructor() {
    this.bracketMatcher = new BracketMatcher();
  }

  /**
   * 증여세를 계산한다.
   *
   * @param params - 증여세 계산 파라미터
   * @returns 계산 결과
   */
  calculate(params: GiftTaxParams): TaxCalculationResult {
    const steps: CalculationStep[] = [];
    const exemptions: Exemption[] = [];
    let stepNumber = 1;

    const { giftAmount, relationship, previousGifts } = params;

    // Step 1: 증여재산가액 확정
    steps.push({
      stepNumber: stepNumber++,
      description: '증여재산가액 확정',
      formula: `증여재산가액 = ${giftAmount.toLocaleString()}원`,
      amount: giftAmount,
    });

    // Step 2: 10년 내 이전 증여액 합산
    const totalGiftAmount = giftAmount + (previousGifts || 0);
    if (previousGifts && previousGifts > 0) {
      steps.push({
        stepNumber: stepNumber++,
        description: '10년 내 이전 증여액 합산',
        formula: `합산 증여액 = ${giftAmount.toLocaleString()} + ${previousGifts.toLocaleString()} = ${totalGiftAmount.toLocaleString()}원`,
        amount: totalGiftAmount,
      });
    }

    // Step 3: 증여재산공제 적용
    const deductionAmount = GIFT_DEDUCTIONS[relationship] || GIFT_DEDUCTIONS['other'];
    const relationshipLabel = this.getRelationshipLabel(relationship);
    const afterDeduction = Math.max(totalGiftAmount - deductionAmount, 0);

    steps.push({
      stepNumber: stepNumber++,
      description: `증여재산공제 적용 (${relationshipLabel}: ${deductionAmount.toLocaleString()}원)`,
      formula: `과세표준 = ${totalGiftAmount.toLocaleString()} - ${deductionAmount.toLocaleString()} = ${afterDeduction.toLocaleString()}원`,
      amount: afterDeduction,
    });

    // 과세표준이 0이면 세액 없음
    if (afterDeduction <= 0) {
      steps.push({
        stepNumber: stepNumber++,
        description: '과세표준 0원 - 증여세 없음',
        formula: '증여세 = 0원',
        amount: 0,
      });

      return {
        taxType: 'gift',
        estimatedTax: 0,
        effectiveRate: 0,
        calculationSteps: steps,
        appliedArticle: '상속세 및 증여세법 제53조 (증여재산공제)',
        appliedDate: new Date().toISOString().split('T')[0],
        possibleExemptions: exemptions,
        disclaimer: DISCLAIMER,
        isComplete: true,
      };
    }

    // Step 4: 세율 적용
    const matchResult = this.bracketMatcher.findBracket(afterDeduction, GIFT_TAX_BRACKETS);
    let taxAmount: number;
    let appliedRate: number;

    if (matchResult) {
      taxAmount = this.bracketMatcher.calculateTax(afterDeduction, matchResult.bracket);
      appliedRate = matchResult.bracket.rate;
    } else {
      taxAmount = Math.floor(afterDeduction * 0.10);
      appliedRate = 0.10;
    }

    steps.push({
      stepNumber: stepNumber++,
      description: `세율 적용: ${(appliedRate * 100).toFixed(0)}%`,
      formula: `산출세액 = ${afterDeduction.toLocaleString()} × ${(appliedRate * 100).toFixed(0)}% - 누진공제 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    // 이전 납부세액 공제 (기납부세액)
    if (previousGifts && previousGifts > 0) {
      // 이전 증여분에 대한 기납부세액 산정 (단순화: 이전 증여액 기준 세액)
      const prevTaxBase = Math.max(previousGifts - deductionAmount, 0);
      if (prevTaxBase > 0) {
        const prevMatch = this.bracketMatcher.findBracket(prevTaxBase, GIFT_TAX_BRACKETS);
        const prevTax = prevMatch
          ? this.bracketMatcher.calculateTax(prevTaxBase, prevMatch.bracket)
          : 0;

        if (prevTax > 0) {
          taxAmount = Math.max(taxAmount - prevTax, 0);
          steps.push({
            stepNumber: stepNumber++,
            description: '기납부세액 공제 (이전 증여분)',
            formula: `기납부세액 = ${prevTax.toLocaleString()}원 공제`,
            amount: taxAmount,
          });
        }
      }
    }

    // 최종 세액
    steps.push({
      stepNumber: stepNumber++,
      description: '최종 증여세액',
      formula: `증여세 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    const effectiveRate = giftAmount > 0 ? taxAmount / giftAmount : 0;

    // 감면 가능성 안내
    exemptions.push({
      name: '증여세 신고세액공제',
      lawArticle: '상속세 및 증여세법 제69조',
      conditions: '법정 신고기한(3개월) 내 신고 시',
      benefit: '산출세액의 3% 공제',
      likelihood: 'high',
    });

    if (relationship === 'lineal_descendant') {
      exemptions.push({
        name: '창업자금 증여세 과세특례',
        lawArticle: '조세특례제한법 제30조의5',
        conditions: '18세 이상 거주자, 창업 목적 증여, 50억원 한도',
        benefit: '10% 단일세율 적용',
        likelihood: 'low',
      });
    }

    return {
      taxType: 'gift',
      estimatedTax: taxAmount,
      effectiveRate,
      calculationSteps: steps,
      appliedArticle: '상속세 및 증여세법 제26조 (증여세 세율)',
      appliedDate: new Date().toISOString().split('T')[0],
      possibleExemptions: exemptions,
      disclaimer: DISCLAIMER,
      isComplete: true,
    };
  }

  /**
   * 관계 라벨을 반환한다.
   */
  private getRelationshipLabel(relationship: string): string {
    const labels: Record<string, string> = {
      spouse: '배우자',
      lineal_ascendant: '직계존속',
      lineal_descendant: '직계비속',
      other: '기타 친족',
    };
    return labels[relationship] || '기타';
  }
}
