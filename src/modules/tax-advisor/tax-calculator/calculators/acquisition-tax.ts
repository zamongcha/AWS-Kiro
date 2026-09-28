/**
 * @fileoverview 취득세 계산기
 * @description 부동산 취득 시 부과되는 취득세를 계산한다.
 * 주택 수, 부동산 유형, 생애 최초 여부 등에 따라 세율이 달라진다.
 *
 * @requirements 5.1 - 취득세 계산
 * @requirements 5.2 - 세율 구간 적용
 * @requirements 5.4 - 계산 단계별 산식 기록
 * @requirements 5.5 - 감면/비과세 가능성 체크
 * @requirements 5.7 - 면책 고지 포함
 */

import type {
  AcquisitionTaxParams,
  TaxCalculationResult,
  CalculationStep,
  Exemption,
  TaxBracket,
} from '../../interfaces/index.js';
import { BracketMatcher } from '../bracket-matcher.js';

/**
 * 취득세 기본 세율 테이블
 *
 * 주택 수 및 부동산 유형별 세율을 정의한다.
 * - 1주택: 매매가 6억 이하 1%, 6~9억 2%, 9억 초과 3%
 * - 2주택: 8% (조정대상지역)
 * - 3주택 이상: 12%
 * - 법인/토지/상가: 4%
 */
const ACQUISITION_BRACKETS_1HOUSE: TaxBracket[] = [
  { minAmount: 0, maxAmount: 600_000_000, rate: 0.01 },
  { minAmount: 600_000_001, maxAmount: 900_000_000, rate: 0.02 },
  { minAmount: 900_000_001, rate: 0.03 },
];

const ACQUISITION_RATE_2HOUSE = 0.08;
const ACQUISITION_RATE_3HOUSE_PLUS = 0.12;
const ACQUISITION_RATE_NON_HOUSE = 0.04;

/** 생애최초 감면 한도 (원) */
const FIRST_TIME_EXEMPTION_LIMIT = 2_000_000;

/** 면책 고지 */
const DISCLAIMER = '본 계산은 참고용 추정치이며 실제 세액과 차이가 있을 수 있습니다.';

/**
 * 취득세 계산기 클래스
 */
export class AcquisitionTaxCalculator {
  private bracketMatcher: BracketMatcher;

  constructor() {
    this.bracketMatcher = new BracketMatcher();
  }

  /**
   * 취득세를 계산한다.
   *
   * @param params - 취득세 계산 파라미터
   * @returns 계산 결과
   */
  calculate(params: AcquisitionTaxParams): TaxCalculationResult {
    const steps: CalculationStep[] = [];
    const exemptions: Exemption[] = [];
    let stepNumber = 1;

    const { purchasePrice, propertyType, housingCount, isFirstTime } = params;

    // Step 1: 과세표준 확정
    steps.push({
      stepNumber: stepNumber++,
      description: '과세표준 확정 (취득가액)',
      formula: `과세표준 = ${purchasePrice.toLocaleString()}원`,
      amount: purchasePrice,
    });

    // Step 2: 적용 세율 결정
    let applicableRate: number;
    let rateDescription: string;

    if (propertyType !== 'house') {
      // 비주택 (토지, 상업용)
      applicableRate = ACQUISITION_RATE_NON_HOUSE;
      rateDescription = `비주택(${propertyType}) 취득세율 4%`;
    } else if (housingCount >= 3) {
      applicableRate = ACQUISITION_RATE_3HOUSE_PLUS;
      rateDescription = '3주택 이상 취득세율 12%';
    } else if (housingCount === 2) {
      applicableRate = ACQUISITION_RATE_2HOUSE;
      rateDescription = '2주택 취득세율 8%';
    } else {
      // 1주택 — 구간별 세율
      const matchResult = this.bracketMatcher.findBracket(purchasePrice, ACQUISITION_BRACKETS_1HOUSE);
      applicableRate = matchResult ? matchResult.bracket.rate : 0.01;
      const ratePercent = (applicableRate * 100).toFixed(0);
      rateDescription = `1주택 취득세율 ${ratePercent}% (매매가 ${purchasePrice.toLocaleString()}원 구간)`;
    }

    steps.push({
      stepNumber: stepNumber++,
      description: `적용 세율 결정: ${rateDescription}`,
      formula: `세율 = ${(applicableRate * 100).toFixed(1)}%`,
      amount: applicableRate,
    });

    // Step 3: 산출세액 계산
    let taxAmount = Math.floor(purchasePrice * applicableRate);
    steps.push({
      stepNumber: stepNumber++,
      description: '산출세액 계산',
      formula: `${purchasePrice.toLocaleString()} × ${(applicableRate * 100).toFixed(1)}% = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    // Step 4: 생애최초 감면 적용
    if (isFirstTime && propertyType === 'house' && housingCount <= 1) {
      const exemptionAmount = Math.min(taxAmount, FIRST_TIME_EXEMPTION_LIMIT);
      taxAmount -= exemptionAmount;

      steps.push({
        stepNumber: stepNumber++,
        description: '생애최초 취득세 감면 적용',
        formula: `${taxAmount + exemptionAmount > FIRST_TIME_EXEMPTION_LIMIT
          ? `감면액 = ${FIRST_TIME_EXEMPTION_LIMIT.toLocaleString()}원 (한도)`
          : `감면액 = ${exemptionAmount.toLocaleString()}원 (전액)`}`,
        amount: taxAmount,
      });

      exemptions.push({
        name: '생애최초 주택 취득세 감면',
        lawArticle: '지방세특례제한법 제36조의3',
        conditions: '생애최초 주택 구입, 주택 가격 12억원 이하, 취득일로부터 3개월 내 전입',
        benefit: `최대 ${FIRST_TIME_EXEMPTION_LIMIT.toLocaleString()}원 감면`,
        likelihood: 'high',
      });
    }

    // 추가 감면 가능성 안내
    if (propertyType === 'house' && housingCount <= 1 && !isFirstTime) {
      exemptions.push({
        name: '생애최초 주택 취득세 감면',
        lawArticle: '지방세특례제한법 제36조의3',
        conditions: '생애최초 주택 구입, 주택 가격 12억원 이하, 취득일로부터 3개월 내 전입',
        benefit: `최대 ${FIRST_TIME_EXEMPTION_LIMIT.toLocaleString()}원 감면`,
        likelihood: 'medium',
      });
    }

    // 최종 결과
    const effectiveRate = purchasePrice > 0 ? taxAmount / purchasePrice : 0;

    // 최종 세액 단계
    steps.push({
      stepNumber: stepNumber++,
      description: '최종 취득세액',
      formula: `취득세 = ${taxAmount.toLocaleString()}원`,
      amount: taxAmount,
    });

    return {
      taxType: 'acquisition',
      estimatedTax: taxAmount,
      effectiveRate,
      calculationSteps: steps,
      appliedArticle: '지방세법 제11조 (취득세 세율)',
      appliedDate: new Date().toISOString().split('T')[0],
      possibleExemptions: exemptions,
      disclaimer: DISCLAIMER,
      isComplete: true,
      missingInfo: undefined,
    };
  }
}
