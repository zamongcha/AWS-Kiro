/**
 * 세무 프롬프트 빌더 (TaxPromptBuilder)
 *
 * 세무 전문가 페르소나 프롬프트 템플릿을 구성하고,
 * 사용자 질문 + 검색 결과 + 계산 결과 + 세션 컨텍스트를 결합하여
 * LLM 호출에 사용할 완성된 프롬프트를 생성한다.
 *
 * @module TaxPromptBuilder
 * @requirements 4.1, 4.2, 4.3, 4.4, 11.1, 11.5
 */

import type {
  TaxSearchOutput,
  TaxSearchResult,
  TaxCalculationResult,
  ConversationContext,
} from '../interfaces/index.js';

/**
 * 프롬프트 빌더 설정
 */
export interface TaxPromptBuilderConfig {
  /** 최소 답변 길이 (기본값: 200) */
  minLength?: number;
  /** 최대 답변 길이 (기본값: 5000) */
  maxLength?: number;
  /** 면책 고지 문구 */
  disclaimer?: string;
}

/** 기본 면책 고지 */
const DEFAULT_DISCLAIMER =
  '본 답변은 참고용이며 법적 효력이 없습니다. 실제 세무 신고 시 세무사 상담을 권장합니다.';

/**
 * 세무 프롬프트 빌더 클래스
 *
 * 세무 전문가 페르소나 시스템 프롬프트와 사용자 메시지를 구성한다.
 * 답변 구조: 질문 요약 → 관련 세법 설명 → 관련 예규/심판례 설명 →
 *           세율 계산 결과 → 절세 포인트 → 종합 의견 → 참고 자료
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 11.1, 11.5
 */
export class TaxPromptBuilder {
  private minLength: number;
  private maxLength: number;
  private disclaimer: string;

  constructor(config: TaxPromptBuilderConfig = {}) {
    this.minLength = config.minLength ?? 200;
    this.maxLength = config.maxLength ?? 5000;
    this.disclaimer = config.disclaimer ?? DEFAULT_DISCLAIMER;
  }

  /**
   * 세무 전문가 페르소나 시스템 프롬프트를 생성한다.
   *
   * 시스템 프롬프트는 LLM에게 부동산 세무 전문가 역할을 지시하며,
   * 답변 구조, 형식(존댓말), 세법 용어 부연 설명 등의 규칙을 포함한다.
   *
   * @returns 시스템 프롬프트 문자열
   */
  buildSystemPrompt(): string {
    return `당신은 대한민국 부동산 세무 전문가입니다. 사용자의 부동산 세무 관련 질문에 정확하고 친절하게 답변합니다.

## 역할 및 전문 분야
- 취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세 관련 자문
- 세법 조항과 국세청 유권해석/예규/심판례를 근거로 한 답변
- 세율 계산 보조 및 절세 포인트 안내

## 답변 구조 (반드시 아래 7개 섹션 순서를 따르세요)
1. [질문 요약] - 사용자 질문의 핵심을 간략히 요약
2. [관련 세법 설명] - 관련 세법 조항을 인용하며 설명
3. [관련 예규/심판례 설명] - 관련 유권해석/예규/심판례를 설명
4. [세율 계산 결과] - 세율 계산 결과가 있는 경우에만 포함
5. [절세 포인트] - 합법적 절세 방법 안내
6. [종합 의견] - 전문가 관점의 종합 의견
7. [참고 자료] - 인용한 세법/예규 목록

## 답변 규칙
- 반드시 존댓말(해요체)을 사용하세요
- 답변 길이: ${this.minLength}자 이상 ${this.maxLength}자 이하
- 세법 전문 용어에는 괄호를 사용하여 부연 설명을 추가하세요
  예: "양도소득세(부동산을 팔 때 내는 세금)"
- 절세 포인트는 반드시 합법적인 방법만 안내하세요
- 탈세와 절세의 구분을 명확히 하세요
- 세율 계산 결과가 제공되면 단계별로 설명하세요
- 답변 말미에 반드시 면책 고지를 포함하세요: "${this.disclaimer}"
- 부동산 세무 범위 외 질문(법인세, 부가가치세 등)에는 범위 안내만 하세요

## 인용 형식
- 세법 인용: [N] 형식의 각주 번호 사용
- 예규 인용: [N] 형식의 각주 번호 사용
- 각주는 답변 내 자연스러운 위치에 삽입하세요`;
  }

  /**
   * 사용자 메시지를 구성한다. (새 질문, 세션 컨텍스트 없음)
   *
   * 질문, 검색 결과, 계산 결과를 하나의 메시지로 결합한다.
   *
   * @param query - 사용자 질문
   * @param searchResults - 세무 검색 결과
   * @param calculationResult - 세율 계산 결과 (선택)
   * @returns 사용자 메시지 문자열
   */
  buildUserMessage(
    query: string,
    searchResults: TaxSearchOutput,
    calculationResult?: TaxCalculationResult
  ): string {
    let message = `## 사용자 질문\n${query}\n\n`;

    // 검색된 세법 문서
    message += this.formatTaxLawDocuments(searchResults.taxLawDocuments);

    // 검색된 예규/심판례 문서
    message += this.formatRulingDocuments(searchResults.rulingDocuments);

    // 세율 계산 결과 (있는 경우)
    if (calculationResult) {
      message += this.formatCalculationResult(calculationResult);
    }

    // 수치 정보 (있는 경우)
    if (searchResults.extractedNumerics) {
      const numerics = searchResults.extractedNumerics;
      const parts: string[] = [];
      if (numerics.amount !== undefined) parts.push(`금액: ${numerics.amount.toLocaleString()}원`);
      if (numerics.area !== undefined) parts.push(`면적: ${numerics.area}㎡`);
      if (numerics.holdingPeriod !== undefined) parts.push(`보유기간: ${numerics.holdingPeriod}년`);
      if (numerics.housingCount !== undefined) parts.push(`주택 수: ${numerics.housingCount}채`);
      if (numerics.officialPrice !== undefined) parts.push(`공시가격: ${numerics.officialPrice.toLocaleString()}원`);
      if (numerics.acquisitionPrice !== undefined) parts.push(`취득가액: ${numerics.acquisitionPrice.toLocaleString()}원`);
      if (numerics.transferPrice !== undefined) parts.push(`양도가액: ${numerics.transferPrice.toLocaleString()}원`);

      if (parts.length > 0) {
        message += `## 추출된 수치 정보\n${parts.join('\n')}\n\n`;
      }
    }

    return message;
  }

  /**
   * 세션 컨텍스트를 포함한 사용자 메시지를 구성한다. (후속 질문)
   *
   * @param query - 현재 질문
   * @param searchResults - 세무 검색 결과
   * @param sessionContext - 이전 대화 컨텍스트
   * @param calculationResult - 세율 계산 결과 (선택)
   * @returns 사용자 메시지 문자열
   */
  buildUserMessageWithContext(
    query: string,
    searchResults: TaxSearchOutput,
    sessionContext: ConversationContext[],
    calculationResult?: TaxCalculationResult
  ): string {
    let message = '## 이전 대화 컨텍스트\n';
    for (const ctx of sessionContext.slice(-3)) {
      message += `Q: ${ctx.question}\nA: ${ctx.answer.substring(0, 200)}...\n\n`;
    }

    message += this.buildUserMessage(query, searchResults, calculationResult);
    return message;
  }

  /**
   * 대화 이력을 LLM 호출 형식으로 변환한다.
   *
   * @param sessionContext - 세션 대화 컨텍스트
   * @returns user/assistant 역할 기반 메시지 배열
   */
  buildConversationHistory(
    sessionContext: ConversationContext[]
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const ctx of sessionContext.slice(-5)) {
      history.push({ role: 'user', content: ctx.question });
      history.push({ role: 'assistant', content: ctx.answer });
    }

    return history;
  }

  /**
   * 면책 고지 문구를 반환한다.
   */
  getDisclaimer(): string {
    return this.disclaimer;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * 세법 문서 목록을 프롬프트 형식으로 포맷한다.
   */
  private formatTaxLawDocuments(documents: TaxSearchResult[]): string {
    if (!documents || documents.length === 0) {
      return '## 관련 세법 문서\n관련 세법을 찾지 못했습니다.\n\n';
    }

    let text = '## 관련 세법 문서\n';
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const relevance = doc.isLowRelevance ? ' [관련도 낮음]' : '';
      text += `[${i + 1}] ${doc.metadata.title}${relevance}\n`;
      text += `  유사도: ${(doc.similarityScore * 100).toFixed(1)}%\n`;
      text += `  내용: ${doc.content.substring(0, 500)}\n\n`;
    }

    return text;
  }

  /**
   * 예규/심판례 문서 목록을 프롬프트 형식으로 포맷한다.
   */
  private formatRulingDocuments(documents: TaxSearchResult[]): string {
    if (!documents || documents.length === 0) {
      return '## 관련 예규/심판례\n관련 예규/심판례를 찾지 못했습니다.\n\n';
    }

    let text = '## 관련 예규/심판례\n';
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const relevance = doc.isLowRelevance ? ' [관련도 낮음]' : '';
      text += `[${i + 1}] ${doc.metadata.title}${relevance}\n`;
      text += `  유사도: ${(doc.similarityScore * 100).toFixed(1)}%\n`;
      text += `  내용: ${doc.content.substring(0, 500)}\n\n`;
    }

    return text;
  }

  /**
   * 세율 계산 결과를 프롬프트 형식으로 포맷한다.
   */
  private formatCalculationResult(result: TaxCalculationResult): string {
    let text = '## 세율 계산 결과\n';
    text += `세목: ${result.taxType}\n`;
    text += `예상 세액: ${result.estimatedTax.toLocaleString()}원\n`;
    text += `실효세율: ${(result.effectiveRate * 100).toFixed(2)}%\n`;
    text += `적용 세법: ${result.appliedArticle}\n`;
    text += `기준일: ${result.appliedDate}\n\n`;

    if (result.calculationSteps.length > 0) {
      text += '계산 단계:\n';
      for (const step of result.calculationSteps) {
        text += `  ${step.stepNumber}. ${step.description}: ${step.formula} = ${step.amount.toLocaleString()}원\n`;
      }
      text += '\n';
    }

    if (result.possibleExemptions.length > 0) {
      text += '감면/비과세 가능성:\n';
      for (const exemption of result.possibleExemptions) {
        text += `  - ${exemption.name} (${exemption.lawArticle}): ${exemption.benefit} [가능성: ${exemption.likelihood}]\n`;
      }
      text += '\n';
    }

    return text;
  }
}
