/**
 * 조항 비교기 (ClauseComparator)
 *
 * 표준계약서 조항과 업로드 계약서 조항을 조항 단위로 대조하여
 * 누락(missing)/변경(changed)/추가(added)를 식별한다.
 *
 * 매칭 전략(요구사항 8.2, 설계 "조항 제목/키워드/유사도 기반 매칭"):
 *   1. 각 표준 조항을 가장 잘 대응하는 업로드 조항과 1:1로 매칭한다.
 *      매칭 점수는 (조항 제목 기반 키워드 겹침) + (본문 토큰 자카드 유사도)로
 *      산출하며, 임계값 이상인 최고 점수 조항을 대응 조항으로 본다.
 *   2. 표준·업로드 양쪽 모두 매칭되면 내용 유사도로 동일/상이를 판정한다:
 *        - 유사도가 변경 임계값 이상이면 "동일"로 보아 비교 항목을 생성하지 않는다.
 *        - 유사도가 변경 임계값 미만이면 "변경(changed)"으로 분류한다.
 *   3. 매칭되지 않은 표준 조항은 "누락(missing)"으로 분류한다.
 *   4. 매칭되지 않은 업로드 조항은 "추가(added)"로 분류한다.
 *
 * Property 25: 각 비교 항목의 diffType은 {missing, changed, added} 중 정확히 하나이며,
 *   - missing: standardClause 존재, uploadedClause 부재
 *   - changed: standardClause·uploadedClause 모두 존재(내용 상이)
 *   - added:   standardClause 부재, uploadedClause 존재
 *
 * @module ClauseComparator
 * @requirements 8.2, 8.3, 8.4
 */

import type {
  ClauseComparison,
  ComparatorOutput,
} from '../interfaces/comparator.js';
import type { RecognizedClause } from '../interfaces/document-recognizer.js';
import type { StandardFormDocument } from '../storage/opensearch-store.js';

/** 표준-업로드 조항 매칭 최소 점수 임계값 (이 값 미만이면 대응 조항 없음) */
export const DEFAULT_MATCH_THRESHOLD = 0.3;

/** 내용 동일 판정 유사도 임계값 (이 값 이상이면 "동일", 미만이면 "변경") */
export const DEFAULT_CHANGE_THRESHOLD = 0.85;

/**
 * 조항 비교기 설정
 */
export interface ClauseComparatorConfig {
  /** 표준-업로드 조항 매칭 최소 점수 (기본 0.3) */
  matchThreshold?: number;
  /** 내용 동일 판정 유사도 임계값 (기본 0.85) */
  changeThreshold?: number;
}

/**
 * 내부 매칭 후보 표현
 */
interface UploadedEntry {
  /** 업로드 조항 */
  clause: RecognizedClause;
  /** 본문 토큰 집합 (자카드 유사도 계산용) */
  tokens: Set<string>;
}

/**
 * 조항 비교기
 *
 * @requirements 8.2, 8.3, 8.4
 */
export class ClauseComparator {
  private readonly matchThreshold: number;
  private readonly changeThreshold: number;

  constructor(config: ClauseComparatorConfig = {}) {
    this.matchThreshold = config.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;
    this.changeThreshold = config.changeThreshold ?? DEFAULT_CHANGE_THRESHOLD;
  }

  /**
   * 표준계약서 조항과 업로드 계약서 조항을 조항 단위로 대조한다.
   *
   * 표준 조항을 우선 순회하며 최적 업로드 조항과 매칭하고, 매칭되지 않은
   * 표준 조항은 누락, 매칭되지 않은 업로드 조항은 추가로 분류한다.
   * 매칭된 쌍은 내용 유사도로 동일/변경을 판정한다.
   *
   * @param standardClauses - 표준계약서 조항 목록
   * @param uploadedClauses - 업로드 계약서 조항 목록
   * @param standardFormVersion - 표준양식 버전 (선택)
   * @returns 비교 결과 (comparisons, standardFormExists=true)
   *
   * @requirements 8.2, 8.3, 8.4
   */
  compare(
    standardClauses: StandardFormDocument[],
    uploadedClauses: RecognizedClause[],
    standardFormVersion?: number,
  ): ComparatorOutput {
    const comparisons: ClauseComparison[] = [];

    // 업로드 조항을 토큰 집합과 함께 전처리하고, 매칭 소비 여부를 추적한다.
    const uploadedEntries: UploadedEntry[] = uploadedClauses.map((clause) => ({
      clause,
      tokens: this.tokenize(clause.text),
    }));
    const consumed = new Array<boolean>(uploadedEntries.length).fill(false);

    // 1) 표준 조항 → 최적 업로드 조항 매칭
    for (const std of standardClauses) {
      const stdContent = this.standardContent(std);
      const stdTokens = this.tokenize(
        `${std.clause_title ?? ''} ${std.clause_content ?? ''}`,
      );

      let bestIndex = -1;
      let bestScore = 0;

      for (let i = 0; i < uploadedEntries.length; i++) {
        if (consumed[i]) {
          continue;
        }
        const score = this.matchScore(stdTokens, uploadedEntries[i]!.tokens);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex === -1 || bestScore < this.matchThreshold) {
        // 대응 업로드 조항 없음 → 누락
        comparisons.push({
          diffType: 'missing',
          standardClause: stdContent,
        });
        continue;
      }

      // 대응 업로드 조항 확정
      consumed[bestIndex] = true;
      const matched = uploadedEntries[bestIndex]!;
      const contentSimilarity = this.jaccard(
        this.tokenize(std.clause_content ?? ''),
        this.tokenize(matched.clause.text),
      );

      // 내용 동일 판정 임계값 미만이면 변경으로 분류, 이상이면 동일(항목 생략)
      if (contentSimilarity < this.changeThreshold) {
        comparisons.push({
          diffType: 'changed',
          standardClause: stdContent,
          uploadedClause: matched.clause.text,
        });
      }
    }

    // 2) 매칭되지 않은 업로드 조항 → 추가
    for (let i = 0; i < uploadedEntries.length; i++) {
      if (!consumed[i]) {
        comparisons.push({
          diffType: 'added',
          uploadedClause: uploadedEntries[i]!.clause.text,
        });
      }
    }

    return {
      comparisons,
      standardFormExists: true,
      ...(standardFormVersion !== undefined
        ? { standardFormVersion }
        : {}),
    };
  }

  /**
   * 표준 조항의 표시용 내용을 구성한다(제목이 있으면 제목을 앞에 붙인다).
   *
   * @param std - 표준계약서 조항 문서
   * @returns 표시용 조항 내용
   */
  private standardContent(std: StandardFormDocument): string {
    const title = std.clause_title?.trim();
    const content = std.clause_content ?? '';
    return title ? `${title}: ${content}` : content;
  }

  /**
   * 매칭 점수를 산출한다.
   *
   * 표준 조항(제목+본문) 토큰과 업로드 조항 토큰의 자카드 유사도를 사용한다.
   * 제목 키워드가 본문에 반영되어 있어 제목/키워드 기반 매칭 효과를 갖는다.
   *
   * @param stdTokens - 표준 조항 토큰 집합
   * @param uploadedTokens - 업로드 조항 토큰 집합
   * @returns 0.0~1.0 매칭 점수
   */
  private matchScore(stdTokens: Set<string>, uploadedTokens: Set<string>): number {
    return this.jaccard(stdTokens, uploadedTokens);
  }

  /**
   * 두 토큰 집합의 자카드 유사도를 계산한다.
   *
   * 양쪽 모두 비어있으면 1.0(동일), 한쪽만 비어있으면 0.0을 반환한다.
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

  /**
   * 텍스트를 비교용 토큰 집합으로 정규화한다.
   *
   * 한글·영숫자를 제외한 문자를 공백으로 치환하고, 소문자화 후 공백 기준으로
   * 분할한다. 길이 1 이하의 토큰은 잡음으로 보아 제거한다.
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
    const tokens = normalized
      .split(/\s+/)
      .filter((token) => token.length > 1);
    return new Set(tokens);
  }
}
