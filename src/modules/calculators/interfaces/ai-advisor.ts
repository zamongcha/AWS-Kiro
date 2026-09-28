/**
 * AI 자문 보조 (ai-advisor-assist) 인터페이스 정의
 *
 * 계산 결과와 완전히 분리된 별도 설명 보조 채널의 입출력 타입을 정의한다. AI
 * 보조는 질문과 계산 컨텍스트를 프롬프트로 구성해 세율·세액을 재계산하지 않고
 * 설명·보완만 수행하며, 계산 결과는 응답에 포함하지 않고 절대 변경하지 않는다.
 * 30초 타임아웃과 Circuit Breaker로 장애를 격리한다.
 */

import type { CalculatorType } from './types.js';
import type { LineItem } from './result.js';

/**
 * AI 자문 보조 입력
 */
export interface AiAssistInput {
  /** 계산기 유형 */
  calculatorType: CalculatorType;
  /** 사용자 자연어 질문 */
  question: string;
  /** 현재 입력·계산 결과 컨텍스트 */
  calculationContext: AiCalculationContext;
}

/**
 * AI 계산 컨텍스트 (프롬프트 구성용)
 */
export interface AiCalculationContext {
  /** 현재 입력 조건 */
  inputs: Record<string, unknown>;
  /** 계산 결과 (재계산 없이 설명 근거로만 사용) */
  result: {
    /** 총액 (원) */
    total: number;
    /** 항목별 세부 내역 */
    lineItems: LineItem[];
    /** 적용 세율/요율 */
    appliedRates: Record<string, number>;
    /** 과세표준 (해당 시) */
    taxBase?: number;
  };
}

/**
 * AI 자문 보조 출력
 *
 * 계산 결과는 이 응답에 포함하지 않으며 절대 변경하지 않는다.
 */
export interface AiAssistOutput {
  /** AI 설명형 답변 (성공 시) */
  answer?: string;
  /** 부동산 취득/양도/중개보수/세무 범위 외 여부 */
  isOutOfScope: boolean;
  /** AI 채널 가용 여부 (실패/타임아웃 시 false) */
  isAvailable: boolean;
  /** 면책 고지 (참고용, 법적 효력 없음, 전문가 상담) */
  disclaimer: string;
}
