/**
 * @fileoverview 전세사기 위험 스코어러 (FraudScorer)
 * @description 등기부 추출 정보(근저당액·선순위 채권·소유자)와 계약서상 정보
 * (보증금·시세·임대인)를 바탕으로 전세가율·선순위 채권 비율을 계산하고,
 * 0~100 정수 전세사기 위험 점수를 산출한다. 고위험 기준 초과 시 위험도 상
 * 경고와 초과 기준·수치를 제공하며, 소유자 불일치를 경고한다.
 *
 * 계산식:
 *   - 전세가율(%)      = 보증금 / 시세 * 100          (시세 > 0)
 *   - 선순위 비율(%)   = 선순위 채권 / 시세 * 100      (시세 > 0)
 *
 * 고위험 기준(하나라도 충족 시 위험도 상):
 *   - 전세가율 ≥ 80%
 *   - 선순위 비율 ≥ 60%
 *   - 위험 점수 ≥ 임계값(기본 70)
 *
 * @requirements 5.5 - 전세가율·선순위 채권 비율 계산 (Property 15)
 * @requirements 5.6 - 전세사기 위험 점수 0~100 정수 산출 (Property 16)
 * @requirements 5.7 - 고위험 기준 초과 시 위험도 상 경고 + 초과 기준·수치 안내 (Property 17)
 * @requirements 5.8 - 소유자 불일치 시 ownerMismatch 경고 (Property 18)
 * @requirements 5.9 - 위험도 평가기에 등기부 대조 결과(fraudScore) 반영
 */

import type {
  FraudRiskScore,
  ExceededCriterion,
} from '../interfaces/risk-evaluator.js';

/** 전세가율 고위험 임계값 (%) */
export const JEONSE_RATIO_THRESHOLD = 80;

/** 선순위 채권 비율 고위험 임계값 (%) */
export const SENIOR_CLAIM_RATIO_THRESHOLD = 60;

/** 전세사기 위험 점수 기본 임계값 */
export const DEFAULT_FRAUD_SCORE_THRESHOLD = 70;

/**
 * 전세사기 스코어링 입력
 */
export interface FraudScoringInput {
  /** 계약서상 보증금 (원) */
  contractDeposit: number;
  /** 주택 시세 (원, > 0) */
  marketPrice: number;
  /** 등기부상 선순위 채권 총액 (원) */
  seniorClaims: number;
  /** 등기부상 근저당권 설정 금액 (원) */
  mortgageAmount: number;
  /** 등기부상 소유자 */
  registryOwnerName: string;
  /** 계약서상 임대인 */
  contractLandlordName: string;
}

/**
 * 전세사기 위험 스코어러
 *
 * 전세가율·선순위 비율을 계산하고 0~100 정수 위험 점수를 산출한 뒤,
 * 고위험 기준 초과 여부와 소유자 불일치를 판정한다.
 */
export class FraudScorer {
  private readonly fraudScoreThreshold: number;

  /**
   * @param fraudScoreThreshold - 전세사기 위험 점수 임계값 (기본 70).
   *   ContractDynamoStore.getFraudScoreThreshold()로 조회한 값을 주입한다.
   */
  constructor(fraudScoreThreshold: number = DEFAULT_FRAUD_SCORE_THRESHOLD) {
    this.fraudScoreThreshold = fraudScoreThreshold;
  }

  /**
   * 전세가율(%)을 계산한다. (보증금 / 시세 * 100)
   *
   * 시세가 0 이하이면 계산할 수 없으므로 0을 반환한다.
   *
   * @param deposit - 보증금 (원)
   * @param marketPrice - 시세 (원)
   * @returns 전세가율 (%)
   * @requirements 5.5 (Property 15)
   */
  calculateJeonseRatio(deposit: number, marketPrice: number): number {
    if (marketPrice <= 0) {
      return 0;
    }
    return (deposit / marketPrice) * 100;
  }

  /**
   * 선순위 채권 비율(%)을 계산한다. (선순위 채권 / 시세 * 100)
   *
   * 시세가 0 이하이면 계산할 수 없으므로 0을 반환한다.
   *
   * @param seniorClaims - 선순위 채권 총액 (원)
   * @param marketPrice - 시세 (원)
   * @returns 선순위 채권 비율 (%)
   * @requirements 5.5 (Property 15)
   */
  calculateSeniorClaimRatio(seniorClaims: number, marketPrice: number): number {
    if (marketPrice <= 0) {
      return 0;
    }
    return (seniorClaims / marketPrice) * 100;
  }

  /**
   * 전세사기 위험 점수를 0~100 정수로 산출한다.
   *
   * 전세가율과 선순위 채권 비율을 가중 합산하여 100을 상한으로 절단하고
   * 정수로 반올림한다. 두 비율 모두 위험을 키우는 방향이므로 단조 증가한다.
   *
   * @param jeonseRatio - 전세가율 (%)
   * @param seniorClaimRatio - 선순위 채권 비율 (%)
   * @returns 0~100 정수 위험 점수
   * @requirements 5.6 (Property 16)
   */
  calculateScore(jeonseRatio: number, seniorClaimRatio: number): number {
    // 전세가율과 선순위 비율을 각각 0.6 / 0.4 가중으로 합산한다.
    const weighted = jeonseRatio * 0.6 + seniorClaimRatio * 0.4;
    const rounded = Math.round(weighted);
    return this.clampToScoreRange(rounded);
  }

  /**
   * 전세사기 위험 점수와 부가 경고를 종합 산출한다.
   *
   * 전세가율·선순위 비율·위험 점수·초과 기준·소유자 불일치를 모두 계산하여
   * `FraudRiskScore`로 반환한다. 세 고위험 기준(전세가율≥80, 선순위≥60,
   * 점수≥임계값) 중 하나라도 충족하면 exceededCriteria에 정확히 포함하며,
   * 모두 미달이면 빈 배열이 된다.
   *
   * @param input - 스코어링 입력
   * @returns 전세사기 위험 점수 결과
   * @requirements 5.5, 5.6, 5.7, 5.8 (Property 15, 16, 17, 18)
   */
  score(input: FraudScoringInput): FraudRiskScore {
    const jeonseRatio = this.calculateJeonseRatio(input.contractDeposit, input.marketPrice);
    const seniorClaimRatio = this.calculateSeniorClaimRatio(
      input.seniorClaims,
      input.marketPrice,
    );
    const scoreValue = this.calculateScore(jeonseRatio, seniorClaimRatio);

    const exceededCriteria = this.buildExceededCriteria(
      jeonseRatio,
      seniorClaimRatio,
      scoreValue,
    );

    const ownerMismatch = this.detectOwnerMismatch(
      input.registryOwnerName,
      input.contractLandlordName,
    );

    return {
      score: scoreValue,
      jeonseRatio,
      seniorClaimRatio,
      exceededCriteria,
      ownerMismatch,
    };
  }

  /**
   * 고위험 여부를 판정한다. (초과 기준이 하나라도 있으면 위험도 상)
   *
   * @param result - 전세사기 위험 점수 결과
   * @returns 위험도 상 여부
   * @requirements 5.7 (Property 17)
   */
  isHighRisk(result: FraudRiskScore): boolean {
    return result.exceededCriteria.length > 0;
  }

  /**
   * 초과된 고위험 기준 목록을 생성한다.
   *
   * 전세가율≥80, 선순위 비율≥60, 점수≥임계값을 각각 검사하여 충족한 기준만
   * 실제 수치와 함께 담는다. 세 조건 모두 미달이면 빈 배열을 반환한다.
   *
   * @param jeonseRatio - 전세가율 (%)
   * @param seniorClaimRatio - 선순위 채권 비율 (%)
   * @param score - 위험 점수
   * @returns 초과된 기준 목록
   * @requirements 5.7 (Property 17)
   */
  private buildExceededCriteria(
    jeonseRatio: number,
    seniorClaimRatio: number,
    score: number,
  ): ExceededCriterion[] {
    const exceeded: ExceededCriterion[] = [];

    if (jeonseRatio >= JEONSE_RATIO_THRESHOLD) {
      exceeded.push({
        name: 'jeonse_ratio',
        threshold: JEONSE_RATIO_THRESHOLD,
        actual: jeonseRatio,
      });
    }
    if (seniorClaimRatio >= SENIOR_CLAIM_RATIO_THRESHOLD) {
      exceeded.push({
        name: 'senior_claim_ratio',
        threshold: SENIOR_CLAIM_RATIO_THRESHOLD,
        actual: seniorClaimRatio,
      });
    }
    if (score >= this.fraudScoreThreshold) {
      exceeded.push({
        name: 'fraud_score',
        threshold: this.fraudScoreThreshold,
        actual: score,
      });
    }

    return exceeded;
  }

  /**
   * 등기부상 소유자와 계약서상 임대인이 다른지 판정한다.
   *
   * 양쪽 공백을 제거한 뒤 정확히 일치하지 않으면 불일치로 본다.
   *
   * @param registryOwner - 등기부상 소유자
   * @param contractLandlord - 계약서상 임대인
   * @returns 불일치 여부
   * @requirements 5.8 (Property 18)
   */
  private detectOwnerMismatch(registryOwner: string, contractLandlord: string): boolean {
    return this.normalizeName(registryOwner) !== this.normalizeName(contractLandlord);
  }

  /**
   * 이름 비교를 위해 모든 공백을 제거하여 정규화한다.
   *
   * @param name - 원본 이름
   * @returns 공백이 제거된 이름
   */
  private normalizeName(name: string): string {
    return (name ?? '').replace(/\s+/g, '');
  }

  /**
   * 점수를 0~100 정수 범위로 절단한다.
   *
   * @param value - 원시 점수
   * @returns 0~100 범위의 정수
   */
  private clampToScoreRange(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (value < 0) {
      return 0;
    }
    if (value > 100) {
      return 100;
    }
    return Math.round(value);
  }
}
