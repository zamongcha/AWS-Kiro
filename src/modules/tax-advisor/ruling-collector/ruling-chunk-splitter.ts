/**
 * @fileoverview 예규/심판례 청크 분할 모듈
 * @description 예규/심판례의 질의 요지 및 회신 내용을 500~1000 토큰 단위로
 * 청크 분할한다. 기존 case-collector/chunk-splitter.ts의 동일 로직을 적용하며,
 * 분할된 청크를 다시 결합하면 원본 텍스트와 동일하다(라운드트립 보장).
 *
 * @requirements 2.7 - 예규 텍스트를 500~1000 토큰 단위로 청크 분할
 */

/**
 * 청크 분할 옵션 인터페이스
 */
export interface RulingChunkOptions {
  /** 최소 토큰 수 (기본 500) */
  minTokens: number;
  /** 최대 토큰 수 (기본 1000) */
  maxTokens: number;
  /** 인접 청크 간 오버랩 토큰 수 (기본 50) */
  overlapTokens: number;
}

/**
 * 청크 데이터 인터페이스
 */
export interface RulingChunk {
  /** 청크 내용 */
  content: string;
  /** 청크 인덱스 (0부터 시작) */
  index: number;
  /** 원본 텍스트 내 시작 오프셋 (문자 단위) */
  startOffset: number;
  /** 원본 텍스트 내 종료 오프셋 (문자 단위, exclusive) */
  endOffset: number;
  /** 추정 토큰 수 */
  tokenCount: number;
}

/** 기본 청크 분할 옵션 */
const DEFAULT_OPTIONS: RulingChunkOptions = {
  minTokens: 500,
  maxTokens: 1000,
  overlapTokens: 50,
};

/**
 * 한국어 텍스트의 토큰 수를 추정한다.
 *
 * 한국어 1글자 ≈ 1.5 토큰, 영문/숫자/공백 ≈ 0.25 토큰(4자=1토큰)으로 추정.
 *
 * @param text - 토큰 수를 추정할 텍스트
 * @returns 추정 토큰 수
 */
export function estimateTokenCount(text: string): number {
  let tokens = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0x1100 && code <= 0x11FF) ||
      (code >= 0x4E00 && code <= 0x9FFF)
    ) {
      tokens += 1.5;
    } else {
      tokens += 0.25;
    }
  }

  return Math.ceil(tokens);
}

/**
 * 토큰 수로부터 대응하는 문자 수를 추정한다 (역방향 추정).
 *
 * @param tokenCount - 토큰 수
 * @returns 추정 문자 수
 */
function estimateCharCountFromTokens(tokenCount: number): number {
  return Math.ceil(tokenCount / 1.5);
}

/**
 * 예규/심판례 청크 분할기
 *
 * 예규/심판례의 질의 요지 및 회신 내용을 500~1000 토큰 단위로 분할한다.
 * 기존 case-collector/chunk-splitter.ts의 동일 로직을 적용한다.
 */
export class RulingChunkSplitter {
  private options: RulingChunkOptions;

  constructor(options: Partial<RulingChunkOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 텍스트를 500~1000 토큰 단위의 청크로 분할한다.
   *
   * 분할 전략:
   * 1. 전체 토큰 수가 최대 이하이면 단일 청크 반환
   * 2. 문장/문단 단위로 자연스러운 분할 지점 탐색
   * 3. 인접 청크 간 오버랩 적용
   *
   * @param text - 분할할 텍스트
   * @param targetMin - 최소 토큰 수 (기본값 사용 시 생략 가능)
   * @param targetMax - 최대 토큰 수 (기본값 사용 시 생략 가능)
   * @returns 청크 내용 문자열 배열
   */
  splitIntoChunks(text: string, targetMin?: number, targetMax?: number): string[] {
    const minTokens = targetMin ?? this.options.minTokens;
    const maxTokens = targetMax ?? this.options.maxTokens;

    if (!text || text.trim().length === 0) {
      return [];
    }

    const totalTokens = estimateTokenCount(text);

    // 전체 텍스트가 최대 토큰 이하이면 단일 청크 반환
    if (totalTokens <= maxTokens) {
      return [text];
    }

    const chunks: string[] = [];
    const overlapChars = estimateCharCountFromTokens(this.options.overlapTokens);
    const targetChars = estimateCharCountFromTokens(maxTokens);

    let currentOffset = 0;

    while (currentOffset < text.length) {
      // 목표 끝 위치 계산
      let endOffset = Math.min(currentOffset + targetChars, text.length);

      // 텍스트 끝이 아니라면 문장 경계를 찾아서 자연스럽게 분할
      if (endOffset < text.length) {
        endOffset = this.findNaturalBreakPoint(text, currentOffset, endOffset, minTokens);
      }

      const chunkContent = text.substring(currentOffset, endOffset);
      chunks.push(chunkContent);

      // 텍스트 끝에 도달하면 종료
      if (endOffset >= text.length) {
        break;
      }

      // 다음 청크 시작점: 오버랩 적용
      const nextStart = endOffset - overlapChars;
      currentOffset = Math.max(nextStart, currentOffset + 1); // 무한루프 방지
    }

    return chunks;
  }

  /**
   * 상세 청크 데이터로 분할한다 (메타데이터 포함).
   *
   * @param text - 분할할 텍스트
   * @returns 상세 청크 배열
   */
  splitIntoDetailedChunks(text: string): RulingChunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const totalTokens = estimateTokenCount(text);

    // 단일 청크
    if (totalTokens <= this.options.maxTokens) {
      return [{
        content: text,
        index: 0,
        startOffset: 0,
        endOffset: text.length,
        tokenCount: totalTokens,
      }];
    }

    const chunks: RulingChunk[] = [];
    const overlapChars = estimateCharCountFromTokens(this.options.overlapTokens);
    const targetChars = estimateCharCountFromTokens(this.options.maxTokens);

    let currentOffset = 0;
    let chunkIndex = 0;

    while (currentOffset < text.length) {
      let endOffset = Math.min(currentOffset + targetChars, text.length);

      if (endOffset < text.length) {
        endOffset = this.findNaturalBreakPoint(text, currentOffset, endOffset, this.options.minTokens);
      }

      const chunkContent = text.substring(currentOffset, endOffset);
      const chunkTokens = estimateTokenCount(chunkContent);

      chunks.push({
        content: chunkContent,
        index: chunkIndex,
        startOffset: currentOffset,
        endOffset: endOffset,
        tokenCount: chunkTokens,
      });

      chunkIndex++;

      if (endOffset >= text.length) {
        break;
      }

      const nextStart = endOffset - overlapChars;
      currentOffset = Math.max(nextStart, currentOffset + 1);
    }

    return chunks;
  }

  /**
   * 분할된 청크를 결합하여 원본 텍스트를 복원한다.
   *
   * 오버랩 구간을 제거하고 순서대로 결합한다.
   *
   * @param chunks - 결합할 청크 배열
   * @returns 복원된 텍스트
   */
  reassembleChunks(chunks: RulingChunk[]): string {
    if (chunks.length === 0) {
      return '';
    }

    const sorted = [...chunks].sort((a, b) => a.index - b.index);

    let result = '';
    let lastEndOffset = 0;

    for (const chunk of sorted) {
      if (chunk.startOffset >= lastEndOffset) {
        result += chunk.content;
      } else {
        const overlapChars = lastEndOffset - chunk.startOffset;
        if (overlapChars < chunk.content.length) {
          result += chunk.content.substring(overlapChars);
        }
      }
      lastEndOffset = chunk.endOffset;
    }

    return result;
  }

  /**
   * 자연스러운 분할 지점을 찾는다.
   *
   * @param text - 전체 텍스트
   * @param startOffset - 현재 청크 시작 오프셋
   * @param targetEnd - 목표 끝 오프셋
   * @param minTokens - 최소 토큰 수
   * @returns 조정된 끝 오프셋
   */
  private findNaturalBreakPoint(
    text: string,
    startOffset: number,
    targetEnd: number,
    minTokens: number,
  ): number {
    const minChars = estimateCharCountFromTokens(minTokens);
    const minEnd = startOffset + minChars;

    // 목표 위치 근처에서 문장 종결 패턴 탐색
    const searchStart = Math.max(minEnd, targetEnd - 100);
    const searchRegion = text.substring(searchStart, targetEnd + 50);

    // 한국어 문장 종결 패턴
    const endingPattern = /[다요음임됨함니까]\.\s/g;
    let lastMatch = -1;
    let match: RegExpExecArray | null;

    while ((match = endingPattern.exec(searchRegion)) !== null) {
      const absolutePos = searchStart + match.index + match[0].length;
      if (absolutePos >= minEnd && absolutePos <= targetEnd + 50) {
        lastMatch = absolutePos;
      }
    }

    // 줄바꿈 기준도 탐색
    if (lastMatch === -1) {
      const newlineIdx = text.lastIndexOf('\n', targetEnd);
      if (newlineIdx > minEnd) {
        lastMatch = newlineIdx + 1;
      }
    }

    if (lastMatch > startOffset && lastMatch <= targetEnd + 50) {
      return lastMatch;
    }

    return targetEnd;
  }
}
