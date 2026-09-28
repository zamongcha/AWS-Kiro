/**
 * 버전 비교기 (VersionComparator)
 *
 * 동일 계약서의 두 버전을 조항 단위로 대조하여 추가/삭제/변경을 구분하고,
 * 각 버전의 종합 위험도 등급과 두 버전 간 등급 변화(gradeShift)를 산출한다.
 *
 * 조항 분할: 버전 내용(content) 문자열을 줄바꿈(빈 줄 포함) 기준으로 조항
 * 단위로 분리한다. 두 버전에 동일하게 존재하는 조항은 위치가 달라도 "유지"로
 * 보아 변경 목록에 넣지 않으며, 한쪽에만 존재하는 조항은 유사 조항과 매칭을
 * 시도하여 매칭되면 "변경(changed)", 매칭되지 않으면 각각 "추가/삭제"로 본다.
 *
 * 등급 변화 판정(Property 31, 요구사항 12.6):
 *   - 두 번째(B) 등급이 첫 번째(A)보다 위험이 낮으면(등급 하락) gradeShift='down'
 *   - 두 번째(B) 등급이 첫 번째(A)보다 위험이 높으면(등급 상승) gradeShift='up'
 *   - 동일하면 gradeShift='same'
 *
 * @module VersionComparator
 * @requirements 12.5, 12.6, 12.8
 */

import type { RiskGrade } from '../interfaces/types.js';
import type {
  ClauseChange,
  VersionComparison,
} from '../interfaces/version-manager.js';

/**
 * 위험도 등급 순위 (상 > 중 > 하).
 *
 * 값이 클수록 위험이 높다. gradeShift 판정에 사용한다.
 */
export const GRADE_RANK: Record<RiskGrade, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** 변경 조항 매칭 최소 유사도 (이 값 이상이면 동일 조항이 변경된 것으로 본다) */
export const DEFAULT_CHANGE_MATCH_THRESHOLD = 0.4;

/**
 * 버전 비교기 설정
 */
export interface VersionComparatorConfig {
  /** 변경 조항 매칭 최소 유사도 (기본 0.4) */
  changeMatchThreshold?: number;
}

/**
 * 조항과 정규화 토큰 집합을 함께 담는 내부 표현
 */
interface ClauseEntry {
  /** 원본 조항 텍스트 */
  text: string;
  /** 정규화된 조항 텍스트 (동일 판정용) */
  normalized: string;
  /** 토큰 집합 (변경 매칭용) */
  tokens: Set<string>;
}

/**
 * 버전 비교기
 *
 * @requirements 12.5, 12.6, 12.8
 */
export class VersionComparator {
  private readonly changeMatchThreshold: number;

  constructor(config: VersionComparatorConfig = {}) {
    this.changeMatchThreshold =
      config.changeMatchThreshold ?? DEFAULT_CHANGE_MATCH_THRESHOLD;
  }

  /**
   * 두 버전의 내용을 조항 단위로 대조한다.
   *
   * 양쪽에 동일하게 존재하는 조항은 유지로 간주하여 어느 목록에도 넣지 않는다.
   * 남은 조항 중 유사도가 임계값 이상인 쌍을 "변경(changed)"으로 매칭하고,
   * 매칭되지 않은 버전 A 조항은 "삭제(removed)", 버전 B 조항은 "추가(added)"로 분류한다.
   *
   * @param contentA - 버전 A 내용
   * @param contentB - 버전 B 내용
   * @param gradeA - 버전 A 종합 위험도 등급
   * @param gradeB - 버전 B 종합 위험도 등급
   * @returns 버전 비교 결과
   *
   * @requirements 12.5, 12.6
   */
  compare(
    contentA: string,
    contentB: string,
    gradeA: RiskGrade,
    gradeB: RiskGrade,
  ): VersionComparison {
    const clausesA = this.splitClauses(contentA);
    const clausesB = this.splitClauses(contentB);

    // 1) 완전히 동일한 조항 상쇄 (유지 조항은 결과에 포함하지 않는다).
    const remainingA: ClauseEntry[] = [];
    const bMatched = new Array<boolean>(clausesB.length).fill(false);

    for (const a of clausesA) {
      const idx = clausesB.findIndex(
        (b, i) => !bMatched[i] && b.normalized === a.normalized,
      );
      if (idx === -1) {
        remainingA.push(a);
      } else {
        bMatched[idx] = true;
      }
    }

    const remainingB: ClauseEntry[] = clausesB.filter((_, i) => !bMatched[i]);

    // 2) 남은 조항 간 변경 매칭 (유사도 임계값 이상)
    const added: string[] = [];
    const removed: string[] = [];
    const changed: ClauseChange[] = [];
    const bConsumed = new Array<boolean>(remainingB.length).fill(false);

    for (const a of remainingA) {
      let bestIndex = -1;
      let bestScore = 0;
      for (let i = 0; i < remainingB.length; i++) {
        if (bConsumed[i]) {
          continue;
        }
        const score = this.jaccard(a.tokens, remainingB[i]!.tokens);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex !== -1 && bestScore >= this.changeMatchThreshold) {
        bConsumed[bestIndex] = true;
        changed.push({ before: a.text, after: remainingB[bestIndex]!.text });
      } else {
        removed.push(a.text);
      }
    }

    // 3) 매칭되지 않은 버전 B 조항 → 추가
    for (let i = 0; i < remainingB.length; i++) {
      if (!bConsumed[i]) {
        added.push(remainingB[i]!.text);
      }
    }

    return {
      added,
      removed,
      changed,
      gradeA,
      gradeB,
      gradeShift: this.computeGradeShift(gradeA, gradeB),
    };
  }

  /**
   * 두 종합 위험도 등급 간 변화를 판정한다(Property 31).
   *
   * 두 번째(B) 등급이 첫 번째(A)보다 위험이 낮으면 '하락'(down), 높으면
   * '상승'(up), 같으면 '동일'(same)로 판정한다.
   *
   * @param gradeA - 버전 A 등급
   * @param gradeB - 버전 B 등급
   * @returns 등급 변화 ('up' | 'down' | 'same')
   *
   * @requirements 12.6
   */
  computeGradeShift(gradeA: RiskGrade, gradeB: RiskGrade): 'up' | 'down' | 'same' {
    const rankA = GRADE_RANK[gradeA];
    const rankB = GRADE_RANK[gradeB];
    if (rankB < rankA) {
      return 'down';
    }
    if (rankB > rankA) {
      return 'up';
    }
    return 'same';
  }

  /**
   * 버전 내용을 조항 단위로 분할한다.
   *
   * 줄바꿈(하나 이상의 개행)을 조항 구분자로 사용하고, 앞뒤 공백을 제거한 뒤
   * 빈 조항은 제외한다.
   *
   * @param content - 버전 내용
   * @returns 조항 엔트리 목록
   */
  private splitClauses(content: string): ClauseEntry[] {
    if (!content) {
      return [];
    }
    return content
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => ({
        text,
        normalized: this.normalize(text),
        tokens: this.tokenize(text),
      }));
  }

  /**
   * 조항 텍스트를 동일 판정용으로 정규화한다.
   *
   * 모든 공백을 단일 공백으로 축약하고 소문자화한다.
   *
   * @param text - 원본 조항 텍스트
   * @returns 정규화된 텍스트
   */
  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * 조항 텍스트를 유사도 비교용 토큰 집합으로 정규화한다.
   *
   * 한글·영숫자 외 문자를 공백으로 치환하고 소문자화한 뒤 공백 기준으로
   * 분할한다. 길이 1 이하 토큰은 잡음으로 보아 제거한다.
   *
   * @param text - 원본 텍스트
   * @returns 정규화된 토큰 집합
   */
  private tokenize(text: string): Set<string> {
    if (!text) {
      return new Set<string>();
    }
    const normalized = text
      .toLowerCase()
      .replace(/[^0-9a-z가-힣]+/g, ' ')
      .trim();
    if (normalized.length === 0) {
      return new Set<string>();
    }
    return new Set(
      normalized.split(/\s+/).filter((token) => token.length > 1),
    );
  }

  /**
   * 두 토큰 집합의 자카드 유사도를 계산한다.
   *
   * 양쪽 모두 비어있으면 1.0, 한쪽만 비어있으면 0.0을 반환한다.
   *
   * @param a - 토큰 집합 A
   * @param b - 토큰 집합 B
   * @returns 0.0~1.0 자카드 유사도
   */
  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) {
      return 1;
    }
    if (a.size === 0 || b.size === 0) {
      return 0;
    }
    let intersection = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const token of small) {
      if (large.has(token)) {
        intersection++;
      }
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
