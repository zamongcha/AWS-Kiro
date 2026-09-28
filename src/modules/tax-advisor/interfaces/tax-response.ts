/**
 * 세무 응답 생성 모듈 인터페이스 정의
 *
 * 세무 전문가 응답 생성의 입출력, 응답 구조, 절세 포인트,
 * 인용 정보를 정의한다.
 */

import type { TaxType } from './tax-types.js';
import type { TaxSearchOutput } from './tax-search.js';
import type { TaxCalculationResult } from './tax-calculator.js';

/**
 * 세무 대화 항목 (응답 생성 컨텍스트용)
 */
export interface ConversationContext {
  /** 질문 */
  question: string;
  /** 답변 */
  answer: string;
  /** 시각 (ISO 8601) */
  timestamp: string;
}

/**
 * 세무 응답 생성기 입력 인터페이스
 */
export interface TaxResponseGeneratorInput {
  /** 사용자 질문 */
  question: string;
  /** 검색 결과 */
  searchResults: TaxSearchOutput;
  /** 세율 계산 결과 (해당 시) */
  calculationResult?: TaxCalculationResult;
  /** 세션 대화 컨텍스트 */
  sessionContext?: ConversationContext[];
}

/**
 * 참고 자료 항목 인터페이스
 */
export interface Reference {
  /** 참고 자료 제목 */
  title: string;
  /** 출처 */
  source: string;
  /** URL (있는 경우) */
  url?: string;
}

/**
 * 세무 답변 구조 인터페이스
 *
 * 구조화된 세무 답변의 각 섹션을 포함한다.
 */
export interface TaxFormattedAnswer {
  /** 질문 요약 */
  questionSummary: string;
  /** 관련 세법 설명 */
  taxLawExplanation: string;
  /** 관련 예규/심판례 설명 */
  rulingExplanation: string;
  /** 세율 계산 결과 설명 (해당 시) */
  calculationResult?: string;
  /** 절세 포인트 */
  taxSavingPoints: string;
  /** 종합 의견 */
  opinion: string;
  /** 참고 자료 목록 */
  references: Reference[];
  /** 전체 답변 길이 (자) */
  totalLength: number;
}

/**
 * 절세 포인트 인터페이스
 *
 * 거래 유형별 합법적 절세 방법을 안내한다.
 */
export interface TaxSavingTip {
  /** 절세 방법 제목 */
  title: string;
  /** 설명 */
  description: string;
  /** 근거 법 조항 */
  legalBasis: string;
  /** 적용 요건 */
  conditions: string;
  /** 주의사항 */
  cautions: string;
  /** 합법적 절세 여부 (항상 true) */
  isLegal: boolean;
}

/**
 * 세법 인용 정보 인터페이스
 */
export interface TaxLawCitationSource {
  /** 법령명 */
  lawName: string;
  /** 조항 번호 */
  articleNumber: string;
  /** 내용 요약 (100자 이내) */
  contentSummary: string;
}

/**
 * 예규 인용 정보 인터페이스
 */
export interface TaxRulingCitationSource {
  /** 문서번호 */
  documentNumber: string;
  /** 회신일자 (ISO 8601) */
  replyDate: string;
  /** 요지 (200자 이내) */
  summary: string;
}

/**
 * 세무 인용 인터페이스
 */
export interface TaxCitation {
  /** 각주 번호 */
  footnoteNumber: number;
  /** 인용 유형 */
  type: 'tax_law' | 'ruling';
  /** 인용 출처 정보 */
  source: TaxLawCitationSource | TaxRulingCitationSource;
  /** 원문 URL */
  originalUrl?: string;
  /** 개정 여부 */
  isAmended?: boolean;
  /** 현행법 정보 (개정 시) */
  currentLawInfo?: string;
}

/**
 * 세무 응답 생성기 출력 인터페이스
 */
export interface TaxResponseGeneratorOutput {
  /** 구조화된 답변 */
  answer: TaxFormattedAnswer;
  /** 인용 목록 */
  citations: TaxCitation[];
  /** 절세 포인트 목록 */
  taxSavingTips: TaxSavingTip[];
  /** 범위 외 질문 여부 */
  isOutOfScope: boolean;
  /** 면책 고지 */
  disclaimer: string;
}
