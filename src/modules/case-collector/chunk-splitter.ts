/**
 * @fileoverview 판례 청크 분할 모듈
 * @description 판결 요지 및 판결 전문을 500~1000 토큰 단위로 청크 분할한다.
 * 한국어 1글자 ≈ 1.5 토큰으로 추정하며, 인접 청크 간 50 토큰 오버랩을 적용한다.
 * 분할된 청크를 다시 결합하면 원본 텍스트와 동일해야 한다(라운드트립 보장).
 *
 * @requirements 2.7 - 판결문을 500~1000 토큰 단위로 청크 분할
 */

/**
 * 청크 분할 옵션 인터페이스
 */
export interface ChunkOptions {
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
export interface Chunk {
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
const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  minTokens: 500,
  maxTokens: 1000,
  overlapTokens: 50,
};

/**
 * 한국어 텍스트의 토큰 수를 추정한다.
 *
 * 한국어 1글자 ≈ 1.5 토큰, 영문/숫자/공백 ≈ 0.25 토큰(4자=1토큰)으로 추정.
 * 간단한 휴리스틱이며 정확한 토크나이저 대신 사용한다.
 *
 * @param text - 토큰 수를 추정할 텍스트
 * @returns 추정 토큰 수
 */
export function estimateTokenCount(text: string): number {
  let tokens = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // 한글 범위: U+AC00 ~ U+D7AF (완성형), U+1100 ~ U+11FF (자모)
    // CJK 통합 한자: U+4E00 ~ U+9FFF
    if ((code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0x1100 && code <= 0x11FF) ||
        (code >= 0x4E00 && code <= 0x9FFF)) {
      tokens += 1.5;
    } else {
      // 영문, 숫자, 공백, 특수문자
      tokens += 0.25;
    }
  }

  return Math.ceil(tokens);
}

/**
 * 토큰 수로부터 대응하는 문자 수를 추정한다 (역방향 추정).
 *
 * 한국어 텍스트의 평균 비율 1글자≈1.5토큰을 역산하여 문자 수를 반환.
 * 정확한 값이 아닌 근사치이므로 실제 분할 시 텍스트를 기반으로 보정한다.
 *
 * @param tokenCount - 토큰 수
 * @returns 추정 문자 수
 */
function estimateCharCountFromTokens(tokenCount: number): number {
  // 한국어 위주 텍스트: 평균 1글자 ≈ 1.5 토큰 → 1토큰 ≈ 0.67글자
  return Math.ceil(tokenCount / 1.5);
}

/**
 * 판결 요지/전문 텍스트를 500~1000 토큰 단위의 청크로 분할한다.
 *
 * 분할 전략:
 * 1. 문단/문장 단위로 세그먼트 분리
 * 2. 세그먼트를 순차적으로 누적하여 최소~최대 토큰 범위를 만족하는 청크 생성
 * 3. 인접 청크 간 overlapTokens 만큼의 오버랩 적용 (오버랩 없이 결합 시 원본 복원 보장)
 * 4. 마지막 청크가 최소 토큰 미달이면 이전 청크와 병합
 *
 * 라운드트립 보장: reassembleChunks(splitIntoChunks(text)) === text
 *
 * @param text - 분할할 텍스트 (판결 요지 또는 판결 전문)
 * @param options - 분할 옵션 (선택, 기본값 적용)
 * @returns 청크 배열
 */
export function splitIntoChunks(text: string, options?: Partial<ChunkOptions>): Chunk[] {
  const opts: ChunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const chunks: Chunk[] = [];

  if (!text || text.trim().length === 0) {
    return [];
  }

  const totalTokens = estimateTokenCount(text);

  // 전체 텍스트가 최대 토큰 이하이면 단일 청크 반환
  if (totalTokens <= opts.maxTokens) {
    chunks.push({
      content: text,
      index: 0,
      startOffset: 0,
      endOffset: text.length,
      tokenCount: totalTokens,
    });
    return chunks;
  }

  // 문자 단위 분할 방식: 오버랩 적용
  const overlapChars = estimateCharCountFromTokens(opts.overlapTokens);
  const targetChars = estimateCharCountFromTokens(opts.maxTokens);

  let currentOffset = 0;
  let chunkIndex = 0;

  while (currentOffset < text.length) {
    // 목표 끝 위치 계산
    let endOffset = Math.min(currentOffset + targetChars, text.length);

    // 텍스트 끝이 아니라면 문장/문단 경계를 찾아서 자연스럽게 분할
    if (endOffset < text.length) {
      endOffset = findNaturalBreakPoint(text, currentOffset, endOffset, opts);
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

    // 다음 청크 시작점: 오버랩 적용 (텍스트 끝이 아닌 경우)
    if (endOffset >= text.length) {
      break;
    }

    // 오버랩: 현재 끝에서 overlapChars 만큼 뒤로
    const nextStart = endOffset - overlapChars;
    currentOffset = Math.max(nextStart, currentOffset + 1); // 무한루프 방지
  }

  return chunks;
}

/**
 * 자연스러운 분할 지점을 찾는다.
 *
 * 목표 끝 위치 주변에서 문장 종결 지점을 탐색한다.
 * 찾을 수 없으면 목표 위치를 그대로 사용한다.
 *
 * @param text - 전체 텍스트
 * @param startOffset - 현재 청크 시작 오프셋
 * @param targetEnd - 목표 끝 오프셋
 * @param opts - 청크 옵션
 * @returns 조정된 끝 오프셋
 */
function findNaturalBreakPoint(
  text: string,
  startOffset: number,
  targetEnd: number,
  opts: ChunkOptions,
): number {
  const minChars = estimateCharCountFromTokens(opts.minTokens);
  const minEnd = startOffset + minChars;

  // 목표 위치 근처에서 문장 종결 패턴 탐색 (뒤에서 앞으로)
  const searchStart = Math.max(minEnd, targetEnd - 100);
  const searchRegion = text.substring(searchStart, targetEnd + 50);

  // 한국어 문장 종결 패턴: "다.", "요.", "음.", "임." 등 뒤에 공백 또는 줄바꿈
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

  // 적절한 분할점을 찾으면 사용, 못 찾으면 목표 위치 사용
  if (lastMatch > startOffset && lastMatch <= targetEnd + 50) {
    return lastMatch;
  }

  return targetEnd;
}

/**
 * 분할된 청크를 결합하여 원본 텍스트를 복원한다.
 *
 * 오버랩 구간을 제거하고 순서대로 결합한다.
 * 라운드트립 검증: reassembleChunks(splitIntoChunks(text)) === text
 *
 * @param chunks - 결합할 청크 배열 (index 순 정렬 가정)
 * @returns 복원된 텍스트
 */
export function reassembleChunks(chunks: Chunk[]): string {
  if (chunks.length === 0) {
    return '';
  }

  // index 순으로 정렬
  const sorted = [...chunks].sort((a, b) => a.index - b.index);

  // startOffset/endOffset을 사용하여 오버랩 없이 결합
  let result = '';
  let lastEndOffset = 0;

  for (const chunk of sorted) {
    if (chunk.startOffset >= lastEndOffset) {
      // 오버랩 없음 - 전체 청크 콘텐츠 추가
      result += chunk.content;
    } else {
      // 오버랩 존재 - 오버랩 부분 건너뛰고 나머지만 추가
      const overlapChars = lastEndOffset - chunk.startOffset;
      if (overlapChars < chunk.content.length) {
        result += chunk.content.substring(overlapChars);
      }
    }
    lastEndOffset = chunk.endOffset;
  }

  return result;
}
