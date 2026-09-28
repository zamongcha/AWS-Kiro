/**
 * @fileoverview 계약 유형 추정기 (ContractTypeEstimator)
 * @description 문서 인식기가 추출한 계약서 텍스트로부터 계약 유형
 * (매매/전세/월세/상가임대차)을 키워드 기반으로 추정하고 추정 신뢰도를 산출한다.
 *
 * 추정 결과의 신뢰도(confidence)에 따라 후속 상태가 결정된다.
 *   - 신뢰도 0.7 이상: 추정된 유형을 사용자에게 확인 요청(confirm_required) 상태로 제시한다.
 *   - 신뢰도 0.7 미만: 자동 확정하지 않고 사용자에게 직접 선택 요청(manual_selection_required) 상태를 반환한다.
 *
 * 또한 확인 요청 상태에서 30초 이내 응답이 없으면 자동 확정을 보류하고
 * 직접 선택 요청 상태를 유지하도록 무응답 처리 로직을 제공한다.
 *
 * 핵심 불변식 (Property 6 대비):
 *   신뢰도 >= 0.7  ⇔  confirm_required
 *   신뢰도 <  0.7  ⇔  manual_selection_required
 *
 * @requirements 2.3 - 신뢰도 0.7 이상 시 추정 유형 확인 요청 제시
 * @requirements 2.4 - 신뢰도 0.7 미만 시 자동 확정 없이 직접 선택 요청
 * @requirements 2.5 - 확인 요청 30초 무응답 시 자동 확정 보류 및 직접 선택 요청 유지
 */

import type { ContractType } from '../interfaces/types.js';

/** 계약 유형 확인 요청 임계값 (요구사항 2.3, 2.4) */
export const CONFIRMATION_THRESHOLD = 0.7;

/** 확인 요청 무응답 자동 확정 보류 시간(밀리초) (요구사항 2.5) */
export const CONFIRMATION_TIMEOUT_MS = 30_000;

/**
 * 계약 유형 추정 후속 상태
 *
 * - confirm_required: 신뢰도가 임계값 이상이어서 추정 유형을 사용자에게 확인 요청
 * - manual_selection_required: 신뢰도가 임계값 미만이어서 직접 선택 요청
 */
export type EstimationStatus = 'confirm_required' | 'manual_selection_required';

/**
 * 계약 유형별 원점수 세부 내역 (신뢰도 산출 근거)
 */
export interface TypeScoreBreakdown {
  /** 계약 유형 */
  contractType: ContractType;
  /** 매칭된 키워드 가중치 합계 (원점수) */
  score: number;
  /** 매칭된 키워드 목록 */
  matchedKeywords: string[];
}

/**
 * 계약 유형 추정 결과
 */
export interface TypeEstimationResult {
  /** 추정된 계약 유형 (모든 점수가 0이면 null) */
  estimatedType: ContractType | null;
  /** 추정 신뢰도 (0.0 ~ 1.0) */
  confidence: number;
  /** 후속 상태 (확인 요청 / 직접 선택 요청) */
  status: EstimationStatus;
  /** 계약 유형별 점수 세부 내역 (신뢰도 내림차순 정렬) */
  breakdown: TypeScoreBreakdown[];
}

/**
 * 키워드-가중치 매핑 항목
 */
interface KeywordWeight {
  /** 텍스트에서 탐색할 키워드 */
  keyword: string;
  /** 매칭 시 가산할 가중치 */
  weight: number;
}

/**
 * 계약 유형별 키워드 사전.
 *
 * 특정 유형을 강하게 시사하는 키워드(예: 매매대금, 전세보증금)에는 높은 가중치를,
 * 일반적으로 등장하는 키워드(예: 임대차)에는 낮은 가중치를 부여한다.
 */
const KEYWORD_DICTIONARY: Record<ContractType, KeywordWeight[]> = {
  sale: [
    { keyword: '매매대금', weight: 3 },
    { keyword: '매매', weight: 2 },
    { keyword: '매도인', weight: 2 },
    { keyword: '매수인', weight: 2 },
    { keyword: '소유권이전', weight: 2 },
    { keyword: '잔금', weight: 1 },
  ],
  jeonse: [
    { keyword: '전세보증금', weight: 3 },
    { keyword: '전세', weight: 2 },
    { keyword: '전세금', weight: 2 },
    { keyword: '보증금', weight: 1 },
  ],
  wolse: [
    { keyword: '차임', weight: 3 },
    { keyword: '월세', weight: 3 },
    { keyword: '월 차임', weight: 2 },
    { keyword: '월임대료', weight: 2 },
    { keyword: '관리비', weight: 1 },
  ],
  commercial_lease: [
    { keyword: '권리금', weight: 3 },
    { keyword: '상가', weight: 3 },
    { keyword: '영업', weight: 1 },
    { keyword: '임대차', weight: 1 },
  ],
};

/**
 * 계약 유형 추정기
 *
 * 추출 텍스트를 키워드 사전과 대조하여 계약 유형별 원점수를 산출한 뒤,
 * 최고 점수 유형을 추정 유형으로 삼고 전체 점수 대비 비율로 신뢰도를 계산한다.
 * 신뢰도를 임계값(0.7)과 비교하여 확인 요청 / 직접 선택 요청 상태를 결정한다.
 */
export class ContractTypeEstimator {
  private readonly threshold: number;
  private readonly timeoutMs: number;

  /**
   * @param threshold - 확인 요청 신뢰도 임계값 (기본 0.7)
   * @param timeoutMs - 확인 요청 무응답 보류 시간(ms) (기본 30000)
   */
  constructor(threshold: number = CONFIRMATION_THRESHOLD, timeoutMs: number = CONFIRMATION_TIMEOUT_MS) {
    this.threshold = threshold;
    this.timeoutMs = timeoutMs;
  }

  /**
   * 추출 텍스트로부터 계약 유형을 추정하고 신뢰도 및 후속 상태를 산출한다.
   *
   * @param text - 문서 인식기가 추출한 계약서 텍스트
   * @returns 추정 결과 (유형, 신뢰도, 상태, 점수 세부 내역)
   */
  estimate(text: string): TypeEstimationResult {
    const breakdown = this.scoreAllTypes(text ?? '');
    const totalScore = breakdown.reduce((sum, item) => sum + item.score, 0);

    // 어떤 키워드에도 매칭되지 않으면 추정 불가 → 직접 선택 요청
    if (totalScore === 0) {
      return {
        estimatedType: null,
        confidence: 0,
        status: this.resolveStatus(0),
        breakdown,
      };
    }

    // 최고 점수 유형을 추정 유형으로 삼는다. (breakdown은 점수 내림차순 정렬)
    const top = breakdown[0];
    // 신뢰도 = 최고 점수 유형이 전체 점수에서 차지하는 비율 (0.0 ~ 1.0)
    const confidence = top.score / totalScore;

    return {
      estimatedType: top.contractType,
      confidence,
      status: this.resolveStatus(confidence),
      breakdown,
    };
  }

  /**
   * 신뢰도를 임계값과 비교하여 후속 상태를 결정한다.
   *
   * Property 6 대비: 신뢰도 >= 임계값(0.7)이면 확인 요청, 미만이면 직접 선택 요청.
   *
   * @param confidence - 추정 신뢰도 (0.0 ~ 1.0)
   * @returns 후속 상태
   */
  resolveStatus(confidence: number): EstimationStatus {
    return confidence >= this.threshold ? 'confirm_required' : 'manual_selection_required';
  }

  /**
   * 확인 요청에 대한 무응답 경과 시간을 반영하여 후속 상태를 결정한다.
   *
   * 확인 요청(confirm_required) 상태에서 30초(timeoutMs) 이상 무응답이면
   * 자동 확정을 보류하고 직접 선택 요청 상태로 전환한다. (요구사항 2.5)
   *
   * @param currentStatus - 현재 상태
   * @param elapsedMs - 확인 요청 이후 경과 시간(ms)
   * @returns 무응답 반영 후 상태
   */
  applyConfirmationTimeout(currentStatus: EstimationStatus, elapsedMs: number): EstimationStatus {
    if (currentStatus === 'confirm_required' && elapsedMs >= this.timeoutMs) {
      // 무응답 → 자동 확정 보류, 직접 선택 요청 상태 유지
      return 'manual_selection_required';
    }
    return currentStatus;
  }

  /**
   * 모든 계약 유형에 대해 키워드 매칭 원점수를 산출한다.
   *
   * @param text - 추출 텍스트
   * @returns 점수 내림차순으로 정렬된 유형별 세부 내역
   */
  private scoreAllTypes(text: string): TypeScoreBreakdown[] {
    const breakdown = (Object.keys(KEYWORD_DICTIONARY) as ContractType[]).map((contractType) =>
      this.scoreType(contractType, text)
    );

    // 점수 내림차순 정렬. 동점이면 유형 정의 순서를 유지한다(안정 정렬).
    return breakdown.sort((a, b) => b.score - a.score);
  }

  /**
   * 단일 계약 유형에 대한 키워드 매칭 점수를 산출한다.
   *
   * @param contractType - 대상 계약 유형
   * @param text - 추출 텍스트
   * @returns 해당 유형의 점수 세부 내역
   */
  private scoreType(contractType: ContractType, text: string): TypeScoreBreakdown {
    const keywords = KEYWORD_DICTIONARY[contractType];
    let score = 0;
    const matchedKeywords: string[] = [];

    for (const { keyword, weight } of keywords) {
      if (text.includes(keyword)) {
        score += weight;
        matchedKeywords.push(keyword);
      }
    }

    return { contractType, score, matchedKeywords };
  }
}
