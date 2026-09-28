/**
 * 조항 원문 매칭 스팬 빌더 (ClauseSpanBuilder)
 *
 * 위험 조항으로 판정된 조항에 대해 프론트엔드 하이라이트에 사용할 원문 매칭
 * 스팬(`ClauseSpan`)을 생성하는 책임을 담당한다.
 *
 * 원문 매칭 길이 규칙 (Property 11):
 *   - 매칭 원문 길이가 100자 미만이면 조항 전체 원문을 matchedText로 사용한다.
 *   - matchedText가 5000자를 초과하면 정확히 5000자까지 절단한다.
 *
 * 위 두 규칙은 순서대로 적용된다. 즉, 100자 미만이면 조항 전체로 대체한 뒤,
 * 그 결과가 5000자를 초과하면 5000자까지 절단한다.
 *
 * @module ClauseSpanBuilder
 * @requirements 3.6
 */

import type { ClauseSpan } from '../interfaces/index.js';

/** 원문 매칭 최소 길이 임계값 (미만이면 조항 전체 원문 사용) */
export const MIN_MATCH_LENGTH = 100;

/** 원문 매칭 최대 길이 (초과 시 절단) */
export const MAX_MATCH_LENGTH = 5000;

/**
 * 스팬 빌더 입력
 */
export interface SpanBuildInput {
  /** 문서 내 고유 조항 식별자 */
  clauseId: string;
  /** 조항 전체 원문 */
  clauseText: string;
  /** 룰셋/벡터 매칭 문구 (있는 경우) */
  matchedText?: string;
  /** 조항의 추출 텍스트 내 시작 위치 */
  startOffset?: number;
  /** 조항의 추출 텍스트 내 끝 위치 */
  endOffset?: number;
}

/**
 * 조항 원문 매칭 스팬 빌더
 *
 * 위험 조항의 매칭 문구와 조항 전체 원문을 받아 길이 규칙(Property 11)을
 * 적용한 `ClauseSpan`을 생성한다.
 *
 * @requirements 3.6
 */
export class ClauseSpanBuilder {
  /**
   * 위험 조항의 원문 매칭 스팬을 생성한다.
   *
   * 규칙 적용 순서:
   *   1. matchedText가 없거나 길이가 100자 미만이면 조항 전체 원문을 사용한다.
   *   2. 선택된 텍스트가 5000자를 초과하면 정확히 5000자까지 절단한다.
   *
   * @param input - 스팬 생성 입력
   * @returns 길이 규칙이 적용된 원문 매칭 스팬
   *
   * @requirements 3.6
   */
  build(input: SpanBuildInput): ClauseSpan {
    const matchedText = this.buildMatchedText(input.clauseText, input.matchedText);

    const span: ClauseSpan = {
      clauseId: input.clauseId,
      matchedText,
    };
    if (input.startOffset !== undefined) {
      span.startOffset = input.startOffset;
    }
    if (input.endOffset !== undefined) {
      span.endOffset = input.endOffset;
    }
    return span;
  }

  /**
   * 길이 규칙을 적용하여 최종 matchedText를 계산한다.
   *
   * matchedText가 지정되지 않았거나 100자 미만이면 조항 전체 원문으로
   * 대체하고, 그 결과가 5000자를 초과하면 5000자까지 절단한다.
   *
   * @param clauseText - 조항 전체 원문
   * @param matchedText - 매칭 문구 (선택)
   * @returns 길이 규칙이 적용된 matchedText
   */
  private buildMatchedText(clauseText: string, matchedText?: string): string {
    // 규칙 1: 매칭 문구가 없거나 100자 미만이면 조항 전체 원문 사용
    const candidate =
      matchedText !== undefined && matchedText.length >= MIN_MATCH_LENGTH
        ? matchedText
        : clauseText;

    // 규칙 2: 5000자 초과 시 정확히 5000자로 절단
    if (candidate.length > MAX_MATCH_LENGTH) {
      return candidate.slice(0, MAX_MATCH_LENGTH);
    }
    return candidate;
  }
}
