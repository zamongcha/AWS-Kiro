/**
 * 인용 포맷터 모듈
 *
 * 법령 및 판례 인용을 구조화된 형식으로 포맷하고,
 * 답변 본문에 각주 번호를 삽입하며, 답변 하단에 인용 목록을 생성한다.
 *
 * - 법령 인용: 법령명 + 조항 번호 + 100자 이내 요약
 * - 판례 인용: 사건번호 + 선고일자 + 200자 이내 요지
 * - 본문 내 [1], [2] 형식 각주 번호 삽입
 * - 답변 하단 각주 번호 순 인용 목록 생성
 */

import { CitationType } from '../../common/interfaces/data-models.js';
import { resolveUrl } from './url-resolver.js';

/**
 * 법령 인용 입력 데이터
 */
export interface LawCitationInput {
  /** 법령명 */
  lawName: string;
  /** 조항 번호 */
  articleNumber: string;
  /** 조항 내용 (요약 대상) */
  content: string;
  /** 법령 고유 ID (URL 생성용) */
  lawId?: string;
  /** 개정 여부 */
  isAmended?: boolean;
  /** 현행 법령 정보 (개정된 경우) */
  currentLawInfo?: string;
}

/**
 * 판례 인용 입력 데이터
 */
export interface CaseCitationInput {
  /** 사건번호 */
  caseNumber: string;
  /** 선고일자 (ISO 8601 또는 YYYY.MM.DD) */
  judgmentDate: string;
  /** 판결 요지 (요약 대상) */
  summary: string;
  /** 판례 고유 ID (URL 생성용) */
  caseId?: string;
}

/**
 * 포맷된 인용 항목
 */
export interface FormattedCitation {
  /** 각주 번호 (1부터 시작) */
  footnoteNumber: number;
  /** 인용 유형 */
  type: CitationType;
  /** 포맷된 인용 텍스트 */
  formattedText: string;
  /** 원문 URL */
  url?: string;
  /** 개정 여부 (법령만) */
  isAmended?: boolean;
  /** 현행 법령 정보 (개정된 경우) */
  currentLawInfo?: string;
}

/**
 * 인용 처리 결과
 */
export interface CitationResult {
  /** 각주가 삽입된 답변 본문 */
  annotatedText: string;
  /** 답변 하단 인용 목록 */
  footnoteList: string;
  /** 포맷된 인용 항목 배열 */
  citations: FormattedCitation[];
  /** 인용 없음 안내 메시지 (인용이 없는 경우) */
  noCitationMessage?: string;
}

/** 법령 인용 요약 최대 길이 */
const LAW_SUMMARY_MAX_LENGTH = 100;

/** 판례 인용 요지 최대 길이 */
const CASE_SUMMARY_MAX_LENGTH = 200;

/**
 * 텍스트를 지정된 최대 길이로 자른다.
 * 초과 시 말줄임표(...)를 붙인다.
 */
function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength - 3) + '...';
}

/**
 * 법령 인용을 포맷한다.
 *
 * 형식: "법령명 제N조 - [100자 이내 요약]"
 * 개정된 경우: "⚠️ 개정됨 | 법령명 제N조 - [100자 이내 요약]"
 *
 * @param input - 법령 인용 입력 데이터
 * @returns 포맷된 법령 인용 텍스트
 */
export function formatLawCitation(input: LawCitationInput): string {
  const summary = truncateText(input.content, LAW_SUMMARY_MAX_LENGTH);
  const baseCitation = `${input.lawName} ${input.articleNumber} - ${summary}`;

  if (input.isAmended) {
    const amendedMark = '⚠️ 개정됨';
    const currentInfo = input.currentLawInfo
      ? ` (현행: ${input.currentLawInfo})`
      : '';
    return `${amendedMark} | ${baseCitation}${currentInfo}`;
  }

  return baseCitation;
}

/**
 * 판례 인용을 포맷한다.
 *
 * 형식: "사건번호 (선고일자) - [200자 이내 요지]"
 *
 * @param input - 판례 인용 입력 데이터
 * @returns 포맷된 판례 인용 텍스트
 */
export function formatCaseCitation(input: CaseCitationInput): string {
  const summary = truncateText(input.summary, CASE_SUMMARY_MAX_LENGTH);
  return `${input.caseNumber} (${input.judgmentDate}) - ${summary}`;
}

/**
 * 답변 본문에 각주 번호 [1], [2], ... 를 삽입한다.
 *
 * 답변 본문에서 인용 마커(예: {{cite:0}}, {{cite:1}})를 찾아
 * [1], [2] 형식의 각주 번호로 치환한다.
 *
 * @param text - 인용 마커가 포함된 답변 본문
 * @param citationCount - 총 인용 수
 * @returns 각주 번호가 삽입된 답변 본문
 */
export function insertFootnotes(text: string, citationCount: number): string {
  let result = text;

  for (let i = 0; i < citationCount; i++) {
    const marker = `{{cite:${i}}}`;
    const footnote = `[${i + 1}]`;
    result = result.replace(new RegExp(escapeRegExp(marker), 'g'), footnote);
  }

  return result;
}

/**
 * 정규식 특수문자를 이스케이프한다.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 답변 하단에 삽입할 각주 인용 목록을 생성한다.
 *
 * 형식:
 * ---
 * [1] 법령명 제N조 - 요약 (URL)
 * [2] 사건번호 (선고일자) - 요지 (URL)
 *
 * @param citations - 포맷된 인용 항목 배열
 * @returns 각주 인용 목록 문자열
 */
export function generateFootnoteList(citations: FormattedCitation[]): string {
  if (citations.length === 0) {
    return '';
  }

  const header = '\n---\n📚 참고 자료\n';
  const items = citations.map((citation) => {
    let line = `[${citation.footnoteNumber}] ${citation.formattedText}`;
    if (citation.url) {
      line += `\n    원문: ${citation.url}`;
    }
    if (citation.isAmended && citation.currentLawInfo) {
      line += `\n    현행 법령: ${citation.currentLawInfo}`;
    }
    return line;
  });

  return header + items.join('\n');
}

/**
 * 법령 및 판례 인용을 포맷하고 각주 시스템을 적용한다.
 *
 * @param answerText - 인용 마커가 포함된 답변 본문
 * @param lawCitations - 법령 인용 입력 배열
 * @param caseCitations - 판례 인용 입력 배열
 * @returns 인용 처리 결과
 */
export function processCitations(
  answerText: string,
  lawCitations: LawCitationInput[],
  caseCitations: CaseCitationInput[]
): CitationResult {
  // 인용할 문서가 없는 경우
  if (lawCitations.length === 0 && caseCitations.length === 0) {
    return {
      annotatedText: answerText,
      footnoteList: '',
      citations: [],
      noCitationMessage:
        '직접 관련된 법령/판례를 찾지 못했습니다. 답변은 일반적인 법률 지식에 기반하여 작성되었습니다.',
    };
  }

  const formattedCitations: FormattedCitation[] = [];
  let footnoteNumber = 1;

  // 법령 인용 포맷
  for (const law of lawCitations) {
    const formattedText = formatLawCitation(law);
    const url = law.lawId
      ? resolveUrl({ type: 'law', lawName: law.lawName, lawId: law.lawId })
      : resolveUrl({ type: 'law', lawName: law.lawName });

    formattedCitations.push({
      footnoteNumber,
      type: CitationType.LAW,
      formattedText,
      url,
      isAmended: law.isAmended,
      currentLawInfo: law.currentLawInfo,
    });
    footnoteNumber++;
  }

  // 판례 인용 포맷
  for (const courtCase of caseCitations) {
    const formattedText = formatCaseCitation(courtCase);
    const url = resolveUrl({
      type: 'case',
      caseNumber: courtCase.caseNumber,
    });

    formattedCitations.push({
      footnoteNumber,
      type: CitationType.CASE,
      formattedText,
      url,
    });
    footnoteNumber++;
  }

  // 본문에 각주 번호 삽입
  const annotatedText = insertFootnotes(answerText, formattedCitations.length);

  // 하단 각주 목록 생성
  const footnoteList = generateFootnoteList(formattedCitations);

  return {
    annotatedText,
    footnoteList,
    citations: formattedCitations,
  };
}
