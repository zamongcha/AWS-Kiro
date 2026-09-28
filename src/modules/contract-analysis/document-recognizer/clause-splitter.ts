/**
 * @fileoverview 조항 분할기 (ClauseSplitter)
 * @description 문서 인식기가 추출한 전체 텍스트(fullText)를 조항 단위로 분할한다.
 * 한국어 계약서의 "제N조" 패턴과 줄바꿈을 기준으로 분할하며, 각 조항에 문서 내에서
 * 중복되지 않는 조항 식별자(clauseId)와 원문 내 위치 정보(startOffset/endOffset)를
 * 부여한다.
 *
 * 핵심 불변식 (Property 2 대비):
 *   1. 분할된 조항 수는 최대 1000개를 초과하지 않는다.
 *   2. 각 조항의 clauseId는 문서 내에서 유일하다.
 *   3. fullText.slice(startOffset, endOffset) === clause.text 가 항상 성립한다.
 *
 * @requirements 1.4 - 추출 텍스트를 최대 1000개 조항으로 분할, 조항 식별자·위치 정보 부여
 */

import type { RecognizedClause } from '../interfaces/document-recognizer.js';

/** 조항 최대 개수 (요구사항 1.4) */
export const MAX_CLAUSES = 1000;

/**
 * 조항 분할기 설정 인터페이스
 */
export interface ClauseSplitterConfig {
  /** 조항 최대 개수 (기본 1000) */
  maxClauses?: number;
  /** clauseId 접두사 (기본 'clause') */
  clauseIdPrefix?: string;
}

/**
 * 분할 후보 세그먼트 (원문 내 위치 포함, 트리밍 전)
 */
interface RawSegment {
  /** 원문 내 시작 위치 */
  start: number;
  /** 원문 내 끝 위치 (exclusive) */
  end: number;
}

/**
 * "제N조" 조항 헤더를 탐지하는 정규식.
 *
 * 줄의 시작 또는 텍스트 시작에서 "제", 숫자(아라비아/한글 혼용은 아라비아 우선),
 * "조"가 이어지는 패턴을 조항 경계로 간주한다.
 */
const ARTICLE_HEADER_REGEX = /제\s*\d+\s*조/g;

/**
 * 조항 분할기
 *
 * "제N조" 패턴을 1차 경계로 사용하고, 조항 헤더가 없는 구간은 줄바꿈 기준으로
 * 분할한다. 모든 세그먼트는 원문 내 절대 위치(start/end)를 유지하므로 분할 결과의
 * text는 항상 fullText.slice(start, end)와 정확히 일치한다.
 */
export class ClauseSplitter {
  private readonly maxClauses: number;
  private readonly clauseIdPrefix: string;

  constructor(config: ClauseSplitterConfig = {}) {
    this.maxClauses = config.maxClauses ?? MAX_CLAUSES;
    this.clauseIdPrefix = config.clauseIdPrefix ?? 'clause';
  }

  /**
   * 전체 텍스트를 조항 단위로 분할한다.
   *
   * @param fullText - 문서 인식기가 추출한 전체 텍스트
   * @returns 분할된 조항 목록 (최대 maxClauses개)
   */
  split(fullText: string): RecognizedClause[] {
    // 비어있거나 공백뿐인 텍스트는 분할 대상이 없다.
    if (fullText.trim().length === 0) {
      return [];
    }

    const rawSegments = this.buildSegments(fullText);
    const clauses: RecognizedClause[] = [];

    for (const segment of rawSegments) {
      // 각 세그먼트에서 앞뒤 공백을 제거한 실제 텍스트 범위를 계산한다.
      const trimmed = this.trimSegment(fullText, segment);
      if (trimmed === null) {
        // 공백뿐인 세그먼트는 건너뛴다.
        continue;
      }

      const text = fullText.slice(trimmed.start, trimmed.end);
      clauses.push({
        clauseId: this.buildClauseId(clauses.length),
        text,
        order: clauses.length,
        startOffset: trimmed.start,
        endOffset: trimmed.end,
      });

      // 최대 개수 도달 시 즉시 중단한다 (요구사항 1.4).
      if (clauses.length >= this.maxClauses) {
        break;
      }
    }

    return clauses;
  }

  /**
   * 전체 텍스트에서 분할 후보 세그먼트(원문 위치 포함)를 생성한다.
   *
   * 1) "제N조" 헤더 위치를 경계로 큰 구간을 나눈다.
   * 2) 첫 헤더 이전의 서두(제목 등)는 별도 구간으로 유지한다.
   * 3) 헤더가 전혀 없으면 줄바꿈 기준으로 분할한다.
   *
   * @param fullText - 전체 텍스트
   * @returns 원문 위치를 유지한 세그먼트 목록
   */
  private buildSegments(fullText: string): RawSegment[] {
    const headerOffsets = this.findArticleHeaderOffsets(fullText);

    if (headerOffsets.length === 0) {
      // "제N조" 헤더가 없으면 줄바꿈 기준으로 분할한다.
      return this.splitByNewline(fullText, 0, fullText.length);
    }

    const segments: RawSegment[] = [];

    // 첫 헤더 이전 서두(제목/전문)를 줄바꿈 단위로 분할한다.
    if (headerOffsets[0] > 0) {
      segments.push(...this.splitByNewline(fullText, 0, headerOffsets[0]));
    }

    // 각 헤더 시작 위치부터 다음 헤더 직전까지를 하나의 조항 구간으로 본다.
    for (let i = 0; i < headerOffsets.length; i += 1) {
      const start = headerOffsets[i];
      const end = i + 1 < headerOffsets.length ? headerOffsets[i + 1] : fullText.length;
      segments.push({ start, end });
    }

    return segments;
  }

  /**
   * "제N조" 헤더가 각 줄의 (공백 제외) 첫머리에 등장하는 위치 목록을 구한다.
   *
   * 조항 본문 중간에 등장하는 "제3조" 같은 참조는 경계로 삼지 않기 위해,
   * 줄 시작(또는 텍스트 시작) 직후 공백을 건너뛴 위치에서 시작하는 헤더만 채택한다.
   *
   * @param fullText - 전체 텍스트
   * @returns 조항 경계로 사용할 헤더 시작 오프셋 목록 (오름차순)
   */
  private findArticleHeaderOffsets(fullText: string): number[] {
    const offsets: number[] = [];
    ARTICLE_HEADER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = ARTICLE_HEADER_REGEX.exec(fullText)) !== null) {
      const matchStart = match.index;
      if (this.isLineStart(fullText, matchStart)) {
        offsets.push(matchStart);
      }
    }

    return offsets;
  }

  /**
   * 주어진 위치가 줄의 첫머리(선행 공백만 존재)인지 판별한다.
   *
   * @param fullText - 전체 텍스트
   * @param position - 검사할 위치
   * @returns 줄 시작 여부
   */
  private isLineStart(fullText: string, position: number): boolean {
    let cursor = position - 1;
    while (cursor >= 0) {
      const ch = fullText[cursor];
      if (ch === '\n') {
        return true;
      }
      // 줄바꿈 이전에 공백이 아닌 문자가 있으면 줄 첫머리가 아니다.
      if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
        return false;
      }
      cursor -= 1;
    }
    // 텍스트 맨 앞까지 공백만 존재하면 줄 시작으로 본다.
    return true;
  }

  /**
   * 지정 구간을 줄바꿈 기준으로 분할하여 원문 위치를 유지한 세그먼트를 만든다.
   *
   * @param fullText - 전체 텍스트
   * @param from - 구간 시작 위치
   * @param to - 구간 끝 위치 (exclusive)
   * @returns 줄 단위 세그먼트 목록
   */
  private splitByNewline(fullText: string, from: number, to: number): RawSegment[] {
    const segments: RawSegment[] = [];
    let lineStart = from;

    for (let i = from; i < to; i += 1) {
      if (fullText[i] === '\n') {
        segments.push({ start: lineStart, end: i });
        lineStart = i + 1;
      }
    }

    // 마지막 줄(줄바꿈으로 끝나지 않는 경우 포함)
    if (lineStart < to) {
      segments.push({ start: lineStart, end: to });
    }

    return segments;
  }

  /**
   * 세그먼트의 앞뒤 공백을 제거한 실제 텍스트 범위를 계산한다.
   *
   * 반환한 범위는 원문 위치를 그대로 유지하므로
   * fullText.slice(start, end)가 조항 text와 정확히 일치한다.
   *
   * @param fullText - 전체 텍스트
   * @param segment - 원본 세그먼트
   * @returns 트리밍된 범위 또는 null(공백뿐인 경우)
   */
  private trimSegment(fullText: string, segment: RawSegment): RawSegment | null {
    let start = segment.start;
    let end = segment.end;

    while (start < end && this.isWhitespace(fullText[start])) {
      start += 1;
    }
    while (end > start && this.isWhitespace(fullText[end - 1])) {
      end -= 1;
    }

    if (start >= end) {
      return null;
    }
    return { start, end };
  }

  /**
   * 공백 문자 여부를 판별한다 (스페이스/탭/개행/캐리지리턴).
   *
   * @param ch - 검사할 문자
   * @returns 공백 여부
   */
  private isWhitespace(ch: string | undefined): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  /**
   * 문서 내에서 유일한 조항 식별자를 생성한다.
   *
   * 조항 순번(index)을 0-패딩하여 사용하므로 동일 문서 내에서 항상 유일하다.
   *
   * @param index - 조항 순번 (0부터 시작)
   * @returns 유일한 clauseId (예: clause-0001)
   */
  private buildClauseId(index: number): string {
    return `${this.clauseIdPrefix}-${String(index + 1).padStart(4, '0')}`;
  }
}
