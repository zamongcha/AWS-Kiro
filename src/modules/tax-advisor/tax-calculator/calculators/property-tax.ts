/**
 * @fileoverview 재산세 계산기
 * @description 부동산 보유에 대해 매년 부과되는 재산세를 계산한다.
 * 부동산 유형(주택, 토지, 건물)에 따라 세율이 달라진다.
 *
 * @requirements 5.1 - 재산세 계산
 * @requirements 5.2 - 세율 구간 적용
 * @requirements 5.4 - 계산 단계별 산식 기록
 */

import type {
  PropertyTaxParams,
  TaxCalculationResult,
  CalculationStep,
  Exemption,
  TaxBracket,
} from '../../interfaces/index.js';
import { BracketMatcher } from '../bracket-matcher.js';

/**
 * 재산세 주택 세율 (공시가격 기준 과세표준에 적용)
 * 공정시장가액비율: 주택 60%
 */
const HOUSE_BRACKETS: TaxBracket[] = [
  { minAmount: 0, maxAmount: 60_000_000, rate: 0.001, progressiveDeduction: 0 },
  { minAmount: 60_000_001, maxAmount: 150_000_000, rate: 0.0015, progressiveDeduction: 30_000 },
  { minAmount: 150_000_001, maxAmount: 300_000_000, rate: 0.0025, progressiveDeduction: 180_000 },
  { minAmount: 300_000_001, rate: 0.004, progressiveDeduction: 630_000 },
];

/**
 * 재산세 토지 세율 (종합합산 과세 기준)
 */
const LAND_BRACKETS: TaxBracket[] = [
  { minAmount: 0, maxAmount: 50_000_000, rate: 0.002, progressiveDeduction: 0 },
  { minAmount: 50_000_001, maxAmount: 100_000_000, rate: 0.003, progressiveDeduction: 50_000 },
  { minAmount: 100_000_001, rate: 0.005, progressiveDeduction: 250_000 },
];

/**
 * 재산세 건물 세율 (단일 세율)
 */
const BUILDING_RATE = 0.0025; // 0.25%

/** 공정시장가액비율 */
const FAIR_MARKET_RATIO_HOUSE = 0.60;
const FAIR_MARKET_RATIO_LAND = 0.70;
const FAIR_MARKET_RATIO_BUILDING = 0.70;

/** 면책 고지 */
const DISCLAIMER = '본 계산은 참고용 추정치이며 실제 세액과 차이가 있을 수 있습니다.';

/**
 * 재산세 계산기 클래스
 */
export class PropertyTaxCalculator {
  private bracketMatcher: BracketMatcher;

  constructor() {
    this.bracketMatcher = new BracketMatcher();
  }

  /**
   * 재산세를 계산한다.
   *
   * @param params - 재산세 계산 파라미터
   * @returns 계산 결과
   */
  calculate(params: PropertyTaxParams): TaxCalculationResult {
    const steps: CalculationStep[] = [];
    const exemptions: Exemption[] = [];
    let stepNumber = 1;

    const { officialPrice, propertyType } = params;

    // Step 1: 공정시장가액비율 적용 (과세표준 산정)
    let fairMarketRatio: number;
    switch (propertyType) {
      case 'house':
        fairMarketRatio = FAIR_MARKET_RATIO_HOUSE;
        break;
      case 'land':
        fairMarketRatio = FAIR_MARKET_RATIO_LAND;
        break;
      case 'building':
        fairMarketRatio = FAIR_MARKET_RATIO_BUILDING;
        break;
      default:
        fairMarketRatio = FAIR_MARKET_RATIO_HOUSE;
    }

    const taxBase = Math.floor(officialPrice * fairMarketRatio);
    steps.push({
      stepNumber: stepNumber++,
      description: `과세표준 산정 (공정시장가액비율 ${(fairMarketRatio * 100).toFixed(0)}%)`,
      formula: `과세표준 = 공시가격(${officialPrice.toLocaleString()}) × ${(fairMarketRatio * 100).toFixed(0)}% = ${taxBase.toLocaleString()}원`,
      amount: taxBase,
    });

    // Step 2: 세율 적용
    let taxAmount: number;
    let appliedRate: number;

    switch (propertyType) {
      case 'house': {
        const matchResult = this.bracketMatcher.findBracket(taxBase, HOUSE_BRACKETS);
        if (matchResult) {
          taxAmount = this.bracketMatcher.calculateTax(taxBase, matchResult.bracket);
          appliedRate = matchResult.bracket.rate;
        } else {
          taxAmount = Math.floor(taxBase * 0.001);
          appliedRate = 0.001;
        }
        break;
      }
      case 'land': {
        const matchResult = this.bracketMatcher.findBracket(taxBase, LAND_BRACKETS);
        if (matchResult) {
          taxAmount = this.bracketMatcher.calculateTax(taxBase, matchResult.bracket);
          appliedRate = matchResult.bracket.rate;
        } else {
          taxAmount = Math.floor(taxBase * 0.002);
          appliedRate = 0.002;
        }
        break;
      }
      case 'building': {
        taxAmount = Math.floor(taxBase * BUILDING_RATE);
        appliedRate = BUILDING_RATE;
        break;
      }
      default: {
        taxAmount = Math.floor(taxBase * 0.001);
        appliedRate = 0.001;
      }
    }

    steps.push({
      stepNumber: stepNumber++,
      description: `세율 적용: ${(appliedRate * 100).toFixed(2)}% (${propertyType === 'house' ? '주택' : propertyType === 'land' ? '토지' : '건물'})`,
      formula: `산출세액 = ${taxBase.toLocaleString()} × ${(appliedRate * 100).toFixed(2)}%${propertyType !== 'building' ? ' - 누진공제' : ''} = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    // 최종 세액
    steps.push({
      stepNumber: stepNumber++,
      description: '최종 재산세액',
      formula: `재산세 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    const effectiveRate = officialPrice > 0 ? taxAmount / officialPrice : 0;

    // 감면 가능성 안내
    if (propertyType === 'house') {
      exemptions.push({
        name: '재산세 세부담 상한',
        lawArticle: '지방세법 제122조',
        conditions: '전년도 재산세의 일정 비율 초과 시 상한 적용',
        benefit: '전년 대비 세부담 상한 적용으로 급격한 인상 제한',
        likelihood: 'medium',
      });
    }

    return {
      taxType: 'property',
      estimatedTax: taxAmount,
      effectiveRate,
      calculationSteps: steps,
      appliedArticle: '지방세법 제111조 (재산세 세율)',
      appliedDate: new Date().toISOString().split('T')[0],
      possibleExemptions: exemptions,
      disclaimer: DISCLAIMER,
      isComplete: true,
    };
  }
}
