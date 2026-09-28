/**
 * 프롬프트 빌더 모듈
 *
 * 부동산 법률 자문 응답 생성을 위한 시스템 프롬프트와
 * 사용자 메시지를 구성한다. 검색 결과, 질문, 세션 컨텍스트를
 * 조합하여 LLM에 전달할 프롬프트를 생성한다.
 *
 * @module PromptBuilder
 * @requirements 4.2, 4.3, 4.4, 9.5
 */

import { SearchOutput, SearchResult, SearchResultType } from '../../common/interfaces/search.js';
import { ConversationEntry } from '../../common/interfaces/data-models.js';

/**
 * 프롬프트 빌더 설정 인터페이스
 */
export interface PromptBuilderConfig {
  /** 최소 답변 길이 (기본값: 200자) */
  minLength?: number;
  /** 최대 답변 길이 (기본값: 5000자) */
  maxLength?: number;
  /** 답변 언어 (기본값: 'ko') */
  language?: string;
  /** 면책 고지 문구 */
  disclaimer?: string;
}

/** 기본 면책 고지 문구 */
const DEFAULT_DISCLAIMER = '본 답변은 참고용이며 법적 효력이 없습니다. 구체적인 법률 문제는 반드시 전문 변호사와 상담하시기 바랍니다.';

/** 기본 최소 답변 길이 */
const DEFAULT_MIN_LENGTH = 200;

/** 기본 최대 답변 길이 */
const DEFAULT_MAX_LENGTH = 5000;

/**
 * 프롬프트 빌더 클래스
 *
 * 부동산 법률 자문 시스템의 시스템 프롬프트와 사용자 메시지를
 * 구성하는 역할을 한다.
 *
 * 시스템 프롬프트 주요 지시:
 * - 한국어(존댓말) 응답
 * - 질문 요약 / 관련 법령 / 관련 판례 / 종합 의견 / 참고 자료 구조
 * - 법률 용어 부연 설명
 * - 구체적 법령 조항 및 판례 사건번호 인용
 * - 200~5000자 답변 길이 제한
 *
 * @requirements 4.2, 4.3, 4.4, 9.5
 */
export class PromptBuilder {
  private minLength: number;
  private maxLength: number;
  private language: string;
  private disclaimer: string;

  constructor(config: PromptBuilderConfig = {}) {
    this.minLength = config.minLength ?? DEFAULT_MIN_LENGTH;
    this.maxLength = config.maxLength ?? DEFAULT_MAX_LENGTH;
    this.language = config.language ?? 'ko';
    this.disclaimer = config.disclaimer ?? DEFAULT_DISCLAIMER;
  }

  /**
   * 시스템 프롬프트를 생성한다.
   *
   * LLM에게 부동산 법률 자문 전문가 역할과 답변 형식,
   * 한국어 존댓말 사용, 법률 용어 설명 등을 지시한다.
   *
   * @returns 시스템 프롬프트 문자열
   *
   * @requirements 4.2, 4.4, 9.5
   */
  buildSystemPrompt(): string {
    return `당신은 대한민국 부동산 법률 전문 AI 자문 어시스턴트입니다.

## 역할 및 전문 분야
- 부동산 임대차, 매매, 등기, 중개, 재건축/재개발, 세금, 토지이용 관련 법률 자문
- 관련 법령(주택임대차보호법, 부동산 거래신고 등에 관한 법률, 공인중개사법, 부동산등기법, 민법 물권편, 상가건물 임대차보호법 등)과 판례를 근거로 답변

## 답변 형식 (반드시 아래 순서와 구조를 따르세요)
1. **[질문 요약]** - 사용자 질문의 핵심을 2~3문장으로 요약
2. **[관련 법령 설명]** - 질문에 직접 관련된 법령 조항을 인용하고 설명
3. **[관련 판례 설명]** - 관련 판례의 판결 요지를 인용하고 설명
4. **[종합 의견]** - 법령과 판례를 종합한 실질적 조언
5. **[참고 자료]** - 인용한 법령과 판례 목록 (각주 번호와 함께)

## 답변 규칙
- 반드시 한국어로 답변하세요.
- 존댓말(합쇼체 또는 해요체)을 사용하세요.
- 답변 총 길이는 ${this.minLength}자 이상 ${this.maxLength}자 이하로 작성하세요.
- 법률 용어가 등장할 때마다 괄호 안에 쉬운 설명을 추가하세요.
  예: "대항력(임차인이 제3자에게 임대차 사실을 주장할 수 있는 권리)"
- 법령 인용 시 반드시 법령명과 구체적 조항 번호를 명시하세요.
  예: "주택임대차보호법 제3조 제1항"
- 판례 인용 시 반드시 사건번호와 선고일자를 명시하세요.
  예: "대법원 2020다12345 (2021.3.15. 선고)"
- 인용은 본문 내 각주 형식 [1], [2]로 표시하고, [참고 자료] 섹션에 대응되는 상세 정보를 기재하세요.
- 답변 말미에 반드시 다음 면책 고지를 포함하세요:
  "${this.disclaimer}"

## 관련도 판단
- 제공된 검색 결과가 질문과 직접 관련이 없다고 판단되면, 해당 사실을 명시하고 일반적인 법률 원칙에 기반하여 답변하세요.
- 관련 법령/판례를 찾지 못한 경우, 답변 가능 범위를 명시하고 추가 확인 사항을 안내하세요.

## 범위 외 질문 처리
- 부동산 법률(임대차, 매매, 등기, 중개, 재건축/재개발, 세금, 토지이용)과 관련 없는 질문에는 "부동산 법률 관련 질문만 지원합니다."라고 안내하세요.
- 지원 가능한 카테고리: 임대차, 매매, 등기, 중개, 세금, 토지이용, 재건축/재개발`;
  }

  /**
   * 사용자 메시지를 구성한다.
   *
   * 사용자 질문과 검색 결과를 조합하여 LLM에 전달할
   * 사용자 메시지를 생성한다.
   *
   * @param query - 사용자 질문 텍스트
   * @param searchResults - 검색 모듈의 출력 결과
   * @returns 구성된 사용자 메시지 문자열
   *
   * @requirements 4.3
   */
  buildUserMessage(query: string, searchResults: SearchOutput): string {
    const lawResults = searchResults.results.filter(
      (r) => r.type === SearchResultType.LAW
    );
    const caseResults = searchResults.results.filter(
      (r) => r.type === SearchResultType.CASE
    );

    let message = `## 사용자 질문\n${query}\n\n`;

    // 법령 검색 결과
    message += '## 관련 법령 검색 결과\n';
    if (lawResults.length > 0) {
      lawResults.forEach((result, index) => {
        message += this.formatSearchResult(result, index + 1);
      });
    } else {
      message += '관련 법령을 찾지 못했습니다.\n';
    }
    message += '\n';

    // 판례 검색 결과
    message += '## 관련 판례 검색 결과\n';
    if (caseResults.length > 0) {
      caseResults.forEach((result, index) => {
        message += this.formatSearchResult(result, index + 1);
      });
    } else {
      message += '관련 판례를 찾지 못했습니다.\n';
    }
    message += '\n';

    message += '위 검색 결과를 기반으로 사용자 질문에 대해 지정된 답변 형식에 맞춰 답변해 주세요.';

    return message;
  }

  /**
   * 세션 컨텍스트를 포함한 사용자 메시지를 구성한다.
   *
   * 이전 대화 이력을 요약하여 현재 질문의 컨텍스트로 포함한다.
   *
   * @param query - 현재 사용자 질문 텍스트
   * @param searchResults - 검색 모듈의 출력 결과
   * @param sessionContext - 이전 대화 이력
   * @returns 구성된 사용자 메시지 문자열
   *
   * @requirements 4.3
   */
  buildUserMessageWithContext(
    query: string,
    searchResults: SearchOutput,
    sessionContext: ConversationEntry[]
  ): string {
    let message = '';

    // 이전 대화 컨텍스트 요약 (최근 3개만 포함)
    if (sessionContext.length > 0) {
      const recentContext = sessionContext.slice(-3);
      message += '## 이전 대화 컨텍스트\n';
      recentContext.forEach((entry, index) => {
        message += `### 대화 ${index + 1}\n`;
        message += `- 질문: ${entry.question}\n`;
        message += `- 답변 요약: ${this.truncateText(entry.answer, 200)}\n\n`;
      });
    }

    message += this.buildUserMessage(query, searchResults);

    if (sessionContext.length > 0) {
      message += '\n\n이전 대화 맥락을 고려하여 후속 질문에 답변해 주세요.';
    }

    return message;
  }

  /**
   * 대화 이력을 LLM 메시지 형식으로 변환한다.
   *
   * ConversationEntry 배열을 user/assistant 역할별 메시지 배열로
   * 변환하여 LLM의 multi-turn 대화에 사용한다.
   *
   * @param sessionContext - 대화 이력
   * @returns user/assistant 역할별 메시지 배열
   *
   * @requirements 4.3
   */
  buildConversationHistory(
    sessionContext: ConversationEntry[]
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // 최근 5개 대화만 포함 (토큰 제한 고려)
    const recentEntries = sessionContext.slice(-5);

    for (const entry of recentEntries) {
      history.push({ role: 'user', content: entry.question });
      history.push({ role: 'assistant', content: entry.answer });
    }

    return history;
  }

  /**
   * 면책 고지 문구를 반환한다.
   */
  getDisclaimer(): string {
    return this.disclaimer;
  }

  /**
   * 최소 답변 길이를 반환한다.
   */
  getMinLength(): number {
    return this.minLength;
  }

  /**
   * 최대 답변 길이를 반환한다.
   */
  getMaxLength(): number {
    return this.maxLength;
  }

  /**
   * 검색 결과를 포맷팅된 문자열로 변환한다.
   *
   * @param result - 검색 결과
   * @param index - 결과 순번
   * @returns 포맷팅된 문자열
   */
  private formatSearchResult(result: SearchResult, index: number): string {
    const typeLabel = result.type === SearchResultType.LAW ? '법령' : '판례';
    const relevanceNote = result.source.isLowRelevance ? ' (관련도 낮음)' : '';

    let formatted = `### ${typeLabel} ${index}${relevanceNote}\n`;
    formatted += `- 출처: ${result.source.title}\n`;
    if (result.source.date) {
      formatted += `- 날짜: ${result.source.date}\n`;
    }
    formatted += `- 유사도 점수: ${result.score.toFixed(3)}\n`;
    formatted += `- 내용:\n${result.content}\n\n`;

    return formatted;
  }

  /**
   * 텍스트를 지정된 길이로 잘라낸다.
   *
   * @param text - 원본 텍스트
   * @param maxLength - 최대 길이
   * @returns 잘라낸 텍스트 (초과 시 '...' 추가)
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }
}
