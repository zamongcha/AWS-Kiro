/**
 * 세무 응답 생성 모듈 (TaxResponseGeneratorModule)
 *
 * Amazon Bedrock Claude 3.5 Sonnet을 활용하여 부동산 세무 자문 응답을
 * 생성하는 서비스 모듈이다. 검색 결과, 세율 계산 결과, 사용자 질문을
 * 기반으로 구조화된 한국어 답변을 생성하며, 세법/예규 인용, 절세 포인트,
 * 면책 고지를 포함한다.
 *
 * @module TaxResponseGeneratorModule
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../../common/interfaces/service-module.js';
import { BedrockLLMClient, BedrockLLMClientConfig, LLMResponse } from '../../response-generator/bedrock-client.js';
import { TaxPromptBuilder, TaxPromptBuilderConfig } from './tax-prompt-builder.js';
import { TaxScopeChecker, ScopeCheckResult } from './tax-scope-checker.js';
import { TaxSavingEngine } from './tax-saving-engine.js';
import type {
  TaxResponseGeneratorInput,
  TaxResponseGeneratorOutput,
  TaxFormattedAnswer,
  TaxSavingTip,
  TaxCitation,
  TaxSearchResult,
  Reference,
} from '../interfaces/index.js';

/** 기본 LLM 타임아웃 (밀리초) */
const DEFAULT_TIMEOUT_MS = 60000;

/** 기본 최소 답변 길이 */
const DEFAULT_MIN_LENGTH = 200;

/** 기본 최대 답변 길이 */
const DEFAULT_MAX_LENGTH = 5000;

/** 면책 고지 */
const DEFAULT_DISCLAIMER =
  '본 답변은 참고용이며 법적 효력이 없습니다. 실제 세무 신고 시 세무사 상담을 권장합니다.';

/**
 * 세무 응답 생성 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * Claude 3.5 Sonnet을 통해 부동산 세무 자문 응답을 생성한다.
 *
 * 처리 흐름:
 * 1. 범위 판별 (부동산 세무 관련 여부)
 * 2. 절세 포인트 생성
 * 3. 프롬프트 구성 (시스템 프롬프트 + 사용자 메시지)
 * 4. LLM 호출 (Claude 3.5 Sonnet, 60초 타임아웃)
 * 5. 응답 파싱 및 구조화
 * 6. 인용 추출 및 면책 고지 확인
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */
export class TaxResponseGeneratorModule implements ServiceModule {
  private config: ModuleConfig | null = null;
  private llmClient: BedrockLLMClient | null = null;
  private promptBuilder: TaxPromptBuilder | null = null;
  private scopeChecker: TaxScopeChecker;
  private savingEngine: TaxSavingEngine;
  private initialized = false;

  constructor() {
    this.scopeChecker = new TaxScopeChecker();
    this.savingEngine = new TaxSavingEngine();
  }

  /**
   * 모듈 초기화
   *
   * Bedrock LLM 클라이언트와 프롬프트 빌더를 초기화한다.
   *
   * @param config - 모듈 설정
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const region = (config.config['region'] as string) || 'us-east-1';
    const modelId = (config.config['modelId'] as string) || undefined;
    const timeoutMs = (config.config['timeoutMs'] as number) || DEFAULT_TIMEOUT_MS;
    const maxTokens = (config.config['maxTokens'] as number) || 4096;
    const temperature = (config.config['temperature'] as number) || 0.3;
    const minLength = (config.config['minLength'] as number) || DEFAULT_MIN_LENGTH;
    const maxLength = (config.config['maxLength'] as number) || DEFAULT_MAX_LENGTH;
    const disclaimer = (config.config['disclaimer'] as string) || DEFAULT_DISCLAIMER;

    // Bedrock LLM 클라이언트 초기화
    const llmConfig: BedrockLLMClientConfig = {
      region,
      modelId,
      timeoutMs,
      maxTokens,
      temperature,
    };
    this.llmClient = new BedrockLLMClient(llmConfig);

    // 프롬프트 빌더 초기화
    const promptConfig: TaxPromptBuilderConfig = {
      minLength,
      maxLength,
      disclaimer,
    };
    this.promptBuilder = new TaxPromptBuilder(promptConfig);

    this.initialized = true;
  }

  /**
   * 세무 응답 생성 실행
   *
   * 사용자 질문과 검색 결과를 기반으로 구조화된 세무 자문 응답을 생성한다.
   *
   * @param input - 모듈 입력 (type: 'generate_tax_response', payload에 TaxResponseGeneratorInput)
   * @returns 응답 생성 결과 (ModuleOutput, data에 TaxResponseGeneratorOutput)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.llmClient || !this.promptBuilder) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '세무 응답 생성 모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const generatorInput = input.payload as TaxResponseGeneratorInput;

    try {
      // 1. 입력 검증
      if (!generatorInput.question || generatorInput.question.trim().length === 0) {
        return {
          success: false,
          errors: [{
            code: 'INVALID_INPUT',
            message: '질문이 비어있습니다.',
            severity: ErrorSeverity.LOW,
            timestamp: new Date().toISOString(),
          }],
        };
      }

      // 2. 범위 판별
      const scopeResult = this.scopeChecker.checkScope(generatorInput.question);
      if (!scopeResult.isInScope) {
        const outOfScopeOutput: TaxResponseGeneratorOutput = {
          answer: {
            questionSummary: generatorInput.question,
            taxLawExplanation: '',
            rulingExplanation: '',
            taxSavingPoints: '',
            opinion: '',
            references: [],
            totalLength: 0,
          },
          citations: [],
          taxSavingTips: [],
          isOutOfScope: true,
          disclaimer: scopeResult.outOfScopeMessage ?? DEFAULT_DISCLAIMER,
        };

        return {
          success: true,
          data: outOfScopeOutput,
          metadata: { isOutOfScope: 'true' },
        };
      }

      // 3. 절세 포인트 생성
      const allDocuments = [
        ...(generatorInput.searchResults.taxLawDocuments || []),
        ...(generatorInput.searchResults.rulingDocuments || []),
      ];
      const taxSavingTips = this.savingEngine.generateTips(
        generatorInput.question,
        scopeResult.detectedTaxTypes,
        allDocuments
      );

      // 4. 프롬프트 구성
      const systemPrompt = this.promptBuilder.buildSystemPrompt();
      let userMessage: string;
      let llmResponse: LLMResponse;

      if (generatorInput.sessionContext && generatorInput.sessionContext.length > 0) {
        // 세션 컨텍스트가 있는 경우: multi-turn 대화
        userMessage = this.promptBuilder.buildUserMessageWithContext(
          generatorInput.question,
          generatorInput.searchResults,
          generatorInput.sessionContext,
          generatorInput.calculationResult
        );

        const conversationHistory = this.promptBuilder.buildConversationHistory(
          generatorInput.sessionContext
        );

        llmResponse = await this.llmClient.invokeWithHistory(
          systemPrompt,
          conversationHistory,
          userMessage
        );
      } else {
        // 새 질문
        userMessage = this.promptBuilder.buildUserMessage(
          generatorInput.question,
          generatorInput.searchResults,
          generatorInput.calculationResult
        );

        llmResponse = await this.llmClient.invoke(systemPrompt, userMessage);
      }

      // 5. 응답 파싱 및 구조화
      const formattedAnswer = this.parseResponse(
        llmResponse.text,
        generatorInput.calculationResult !== undefined
      );

      // 6. 인용 추출
      const citations = this.extractCitations(
        llmResponse.text,
        generatorInput.searchResults.taxLawDocuments,
        generatorInput.searchResults.rulingDocuments
      );

      const output: TaxResponseGeneratorOutput = {
        answer: formattedAnswer,
        citations,
        taxSavingTips,
        isOutOfScope: false,
        disclaimer: this.promptBuilder.getDisclaimer(),
      };

      return {
        success: true,
        data: output,
        metadata: {
          model: llmResponse.model,
          inputTokens: String(llmResponse.inputTokens),
          outputTokens: String(llmResponse.outputTokens),
          detectedTaxTypes: scopeResult.detectedTaxTypes.join(','),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('타임아웃');

      return {
        success: false,
        errors: [{
          code: isTimeout ? 'LLM_TIMEOUT' : 'TAX_RESPONSE_GENERATION_FAILED',
          message: isTimeout
            ? '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.'
            : `일시적 오류가 발생했습니다. 다시 시도해 주세요.`,
          severity: isTimeout ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
          timestamp: new Date().toISOString(),
          context: { originalError: errorMessage },
        }],
      };
    }
  }

  /**
   * 모듈 헬스체크
   */
  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { reason: 'Module not initialized' },
      };
    }

    return {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: true,
        model: this.llmClient?.getModelId(),
        timeoutMs: this.llmClient?.getTimeoutMs(),
      },
    };
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'tax-response-generator';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * LLM 응답을 파싱하여 구조화된 TaxFormattedAnswer를 생성한다.
   */
  private parseResponse(responseText: string, hasCalculation: boolean): TaxFormattedAnswer {
    const questionSummary = this.extractSection(responseText, '질문 요약', '관련 세법');
    const taxLawExplanation = this.extractSection(responseText, '관련 세법', '관련 예규');
    const rulingExplanation = this.extractSection(responseText, '관련 예규', hasCalculation ? '세율 계산' : '절세 포인트');
    const calculationResult = hasCalculation
      ? this.extractSection(responseText, '세율 계산', '절세 포인트')
      : undefined;
    const taxSavingPoints = this.extractSection(responseText, '절세 포인트', '종합 의견');
    const opinion = this.extractSection(responseText, '종합 의견', '참고 자료');
    const referencesText = this.extractSection(responseText, '참고 자료', '');

    const references = this.parseReferences(referencesText);

    const answer: TaxFormattedAnswer = {
      questionSummary: questionSummary || responseText.substring(0, 100),
      taxLawExplanation: taxLawExplanation || '',
      rulingExplanation: rulingExplanation || '',
      calculationResult,
      taxSavingPoints: taxSavingPoints || '',
      opinion: opinion || '',
      references,
      totalLength: responseText.length,
    };

    return answer;
  }

  /**
   * 응답 텍스트에서 특정 섹션을 추출한다.
   */
  private extractSection(text: string, startMarker: string, endMarker: string): string {
    const patterns = [
      `\\[${startMarker}[^\\]]*\\]`,
      `\\*\\*\\[${startMarker}[^\\]]*\\]\\*\\*`,
      `##\\s*${startMarker}`,
      `\\*\\*${startMarker}\\*\\*`,
    ];

    for (const pattern of patterns) {
      const startRegex = new RegExp(pattern, 'i');
      const startMatch = text.match(startRegex);

      if (startMatch && startMatch.index !== undefined) {
        const contentStart = startMatch.index + startMatch[0].length;

        if (!endMarker) {
          return text.substring(contentStart).trim();
        }

        const endPatterns = [
          `\\[${endMarker}[^\\]]*\\]`,
          `\\*\\*\\[${endMarker}[^\\]]*\\]\\*\\*`,
          `##\\s*${endMarker}`,
          `\\*\\*${endMarker}\\*\\*`,
        ];

        for (const endPattern of endPatterns) {
          const endRegex = new RegExp(endPattern, 'i');
          const endMatch = text.substring(contentStart).match(endRegex);

          if (endMatch && endMatch.index !== undefined) {
            return text.substring(contentStart, contentStart + endMatch.index).trim();
          }
        }

        // endMarker를 찾지 못한 경우 나머지 텍스트 반환 (최대 1000자)
        return text.substring(contentStart, contentStart + 1000).trim();
      }
    }

    return '';
  }

  /**
   * 참고 자료 텍스트를 파싱하여 Reference 배열로 변환한다.
   */
  private parseReferences(text: string): Reference[] {
    if (!text) return [];

    const references: Reference[] = [];
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    for (const line of lines) {
      const trimmed = line.replace(/^[-•*\d.)\]]+\s*/, '').trim();
      if (trimmed.length > 0) {
        references.push({
          title: trimmed,
          source: '세무 자문 시스템',
        });
      }
    }

    return references;
  }

  /**
   * LLM 응답에서 인용 정보를 추출한다.
   */
  private extractCitations(
    responseText: string,
    taxLawDocs: TaxSearchResult[],
    rulingDocs: TaxSearchResult[]
  ): TaxCitation[] {
    const citations: TaxCitation[] = [];

    // 각주 패턴 매칭 [1], [2] 등
    const footnotePattern = /\[(\d+)\]/g;
    const footnoteNumbers = new Set<number>();
    let match: RegExpExecArray | null;

    while ((match = footnotePattern.exec(responseText)) !== null) {
      footnoteNumbers.add(parseInt(match[1], 10));
    }

    let footnoteIndex = 1;

    // 세법 인용
    for (const doc of taxLawDocs) {
      if (!doc.isLowRelevance && footnoteNumbers.has(footnoteIndex)) {
        citations.push({
          footnoteNumber: footnoteIndex,
          type: 'tax_law',
          source: {
            lawName: doc.metadata.title || '',
            articleNumber: (doc.metadata['articleNumber'] as string) || '',
            contentSummary: this.truncateText(doc.content, 100),
          },
          isAmended: false,
        });
      }
      footnoteIndex++;
    }

    // 예규 인용
    for (const doc of rulingDocs) {
      if (!doc.isLowRelevance && footnoteNumbers.has(footnoteIndex)) {
        citations.push({
          footnoteNumber: footnoteIndex,
          type: 'ruling',
          source: {
            documentNumber: doc.metadata.title || '',
            replyDate: doc.metadata.date || '',
            summary: this.truncateText(doc.content, 200),
          },
          isAmended: false,
        });
      }
      footnoteIndex++;
    }

    return citations;
  }

  /**
   * 텍스트를 지정된 길이로 잘라낸다.
   */
  private truncateText(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength - 3) + '...';
  }
}
