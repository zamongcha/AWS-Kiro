/**
 * 응답 생성 모듈 인터페이스 정의
 *
 * LLM 기반 법률 자문 응답 생성에 필요한 입력, 출력, 포맷 타입을 정의한다.
 */

import { SearchOutput } from './search.js';
import { Citation, ConversationEntry } from './data-models.js';

/**
 * 응답 생성기 입력 인터페이스
 *
 * 사용자 질문, 검색 결과, 세션 컨텍스트를 포함한다.
 */
export interface ResponseGeneratorInput {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 검색 모듈의 출력 결과 */
  searchResults: SearchOutput;
  /** 이전 대화 컨텍스트 (후속 질문 시 참조) */
  sessionContext?: ConversationEntry[];
  /** 응답 생성 옵션 */
  options?: ResponseGeneratorOptions;
}

/**
 * 응답 생성 옵션 인터페이스
 */
export interface ResponseGeneratorOptions {
  /** 최대 답변 길이 (기본값: 5000자) */
  maxLength?: number;
  /** 최소 답변 길이 (기본값: 200자) */
  minLength?: number;
  /** 답변 언어 (기본값: 'ko') */
  language?: string;
  /** LLM 호출 타임아웃 (밀리초, 기본값: 60000) */
  timeout?: number;
}

/**
 * 응답 생성기 출력 인터페이스
 */
export interface ResponseGeneratorOutput {
  /** 포맷된 답변 */
  answer: FormattedAnswer;
  /** 인용 목록 */
  citations: Citation[];
  /** 응답 메타데이터 */
  metadata?: ResponseMetadata;
}

/**
 * 응답 메타데이터 인터페이스
 */
export interface ResponseMetadata {
  /** 응답 생성 소요 시간 (밀리초) */
  generationTime?: number;
  /** 사용된 LLM 모델명 */
  model?: string;
  /** 부동산 법률 범위 외 여부 */
  isOutOfScope?: boolean;
  /** 면책 고지 포함 여부 */
  disclaimerIncluded?: boolean;
}

/**
 * 포맷된 답변 인터페이스
 *
 * 답변의 전체 텍스트와 구조화된 섹션을 포함한다.
 */
export interface FormattedAnswer {
  /** 답변 전체 텍스트 */
  text: string;
  /** 답변 섹션 목록 (순서대로: 질문 요약, 관련 법령, 관련 판례, 종합 의견, 참고 자료) */
  sections: AnswerSection[];
  /** 면책 고지 문구 */
  disclaimer: string;
  /** 답변 신뢰도 (0.0 ~ 1.0) */
  confidence: number;
}

/**
 * 답변 섹션 인터페이스
 */
export interface AnswerSection {
  /** 섹션 제목 */
  title: string;
  /** 섹션 내용 */
  content: string;
}
