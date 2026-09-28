/**
 * @fileoverview 응답 생성 모듈
 * @description Amazon Bedrock Claude 3.5 Sonnet을 활용하여 부동산 법률 자문 응답을
 * 생성하는 서비스 모듈이다. 검색 결과와 사용자 질문을 기반으로 구조화된 한국어
 * 답변을 생성하며, 법령/판례 인용과 면책 고지를 포함한다.
 *
 * @requirements 4.1 - Bedrock Claude 3.5 Sonnet 기반 응답 생성
 * @requirements 4.2 - 한국어 존댓말 형식 응답
 * @requirements 4.3 - 세션 컨텍스트 기반 후속 응답
 * @requirements 4.4 - 5개 섹션 구조 (질문 요약/법령/판례/종합 의견/참고 자료)
 * @requirements 9.1 - 한국어 자연어 응답 생성
 * @requirements 9.5 - 법률 용어 부연 설명
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../common/interfaces/service-module.js';
import {
  ResponseGeneratorInput,
  ResponseGeneratorOutput,
  FormattedAnswer,
  AnswerSection,
} from '../../common/interfaces/response.js';
import { SearchOutput, SearchResultType } from '../../common/interfaces/search.js';
import { Citation, CitationType } from '../../common/interfaces/data-models.js';
import { BedrockLLMClient, BedrockLLMClientConfig } from './bedrock-client.js';
import { PromptBuilder, PromptBuilderConfig } from './prompt-builder.js';

/** 기본 최소 답변 길이 */
const DEFAULT_MIN_LENGTH = 200;

/** 기본 최대 답변 길이 */
const DEFAULT_MAX_LENGTH = 5000;

/** 기본 LLM 타임아웃 (밀리초) */
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * 답변 섹션 제목 정의
 */
const SECTION_TITLES = {
  QUESTION_SUMMARY: '질문 요약',
  LAW_EXPLANATION: '관련 법령 설명',
  CASE_EXPLANATION: '관련 판례 설명',
  OPINION: '종합 의견',
  REFERENCES: '참고 자료',
} as const;

/**
 * 응답 생성 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * Claude 3.5 Sonnet을 통해 부동산 법률 자문 응답을 생성한다.
 *
 * 처리 흐름:
 * 1. 입력 검증 (질문, 검색 결과)
 * 2. 프롬프트 구성 (시스템 프롬프트 + 사용자 메시지)
 * 3. LLM 호출 (Claude 3.5 Sonnet, 60초 타임아웃)
 * 4. 응답 파싱 및 섹션 구조화
 * 5. 인용 추출 및 면책 고지 추가
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 9.1, 9.5
 */
export class ResponseGeneratorModule implements ServiceModule {
  private config: ModuleConfig | null = null;
  private llmClient: BedrockLLMClient | null = null;
  private promptBuilder: PromptBuilder | null = null;
  private initialized = false;

  /**
   * 모듈 초기화
   *
   * Bedrock LLM 클라이언트와 프롬프트 빌더를 초기화한다.
   *
   * @param config - 모듈 설정
   *   config.config에 다음 필드를 포함할 수 있다:
   *   - region: AWS 리전 (기본값: 'us-east-1')
   *   - modelId: Bedrock 모델 ID (기본값: 'anthropic.claude-3-5-sonnet-20240620-v1:0')
   *   - timeoutMs: LLM 호출 타임아웃 밀리초 (기본값: 60000)
   *   - maxTokens: 최대 출력 토큰 수 (기본값: 4096)
   *   - temperature: 생성 온도 (기본값: 0.3)
   *   - minLength: 최소 답변 길이 (기본값: 200)
   *   - maxLength: 최대 답변 길이 (기본값: 5000)
   *   - disclaimer: 면책 고지 문구
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const region = (config.config['region'] as string) || 'us-east-1';
    const modelId = (config.config['modelId'] as string) || undefined;
    const timeoutMs = (config.config['timeoutMs'] as number) || DEFAULT_TIMEOUT_MS;
    const maxTokens = (config.config['maxTokens'] as number) || undefined;
    const temperature = (config.config['temperature'] as number) || undefined;
    const minLength = (config.config['minLength'] as number) || DEFAULT_MIN_LENGTH;
    const maxLength = (config.config['maxLength'] as number) || DEFAULT_MAX_LENGTH;
    const disclaimer = (config.config['disclaimer'] as string) || undefined;

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
    const promptConfig: PromptBuilderConfig = {
      minLength,
      maxLength,
      disclaimer,
    };
    this.promptBuilder = new PromptBuilder(promptConfig);

    this.initialized = true;
  }

  /**
   * 응답 생성 실행
   *
   * 사용자 질문과 검색 결과를 기반으로 구조화된 법률 자문 응답을 생성한다.
   *
   * 처리 흐름:
   * 1. 입력 검증 (ResponseGeneratorInput 형식 확인)
   * 2. 시스템 프롬프트 생성 (PromptBuilder)
   * 3. 사용자 메시지 구성 (질문 + 검색 결과 + 컨텍스트)
   * 4. Claude 3.5 Sonnet 호출 (60초 타임아웃)
   * 5. 응답 파싱: 섹션 분리, 인용 추출, 면책 고지 확인
   * 6. 구조화된 FormattedAnswer 반환
   *
   * @param input - 모듈 입력 (type: 'generate_response', payload에 ResponseGeneratorInput 포함)
   * @returns 응답 생성 결과 (ModuleOutput 형식, data에 ResponseGeneratorOutput 포함)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.llmClient || !this.promptBuilder) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '응답 생성 모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const generatorInput = input.payload as ResponseGeneratorInput;
    const startTime = Date.now();

    try {
      // 입력 검증
      if (!generatorInput.query || generatorInput.query.trim().length === 0) {
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

      if (!generatorInput.searchResults) {
        return {
          success: false,
          errors: [{
            code: 'INVALID_INPUT',
            message: '검색 결과가 제공되지 않았습니다.',
            severity: ErrorSeverity.LOW,
            timestamp: new Date().toISOString(),
          }],
        };
      }

      // 시스템 프롬프트 생성
      const systemPrompt = this.promptBuilder.buildSystemPrompt();

      // 사용자 메시지 구성
      let userMessage: string;
      let llmResponse;

      if (generatorInput.sessionContext && generatorInput.sessionContext.length > 0) {
        // 세션 컨텍스트가 있는 경우: multi-turn 대화 지원
        userMessage = this.promptBuilder.buildUserMessageWithContext(
          generatorInput.query,
          generatorInput.searchResults,
          generatorInput.sessionContext
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
        // 새 질문: 단순 호출
        userMessage = this.promptBuilder.buildUserMessage(
          generatorInput.query,
          generatorInput.searchResults
        );

        llmResponse = await this.llmClient.invoke(systemPrompt, userMessage);
      }

      // 응답 파싱 및 구조화
      const formattedAnswer = this.parseResponse(
        llmResponse.text,
        generatorInput.searchResults
      );

      // 인용 추출
      const citations = this.extractCitations(
        llmResponse.text,
        generatorInput.searchResults
      );

      const generationTime = Date.now() - startTime;

      const output: ResponseGeneratorOutput = {
        answer: formattedAnswer,
        citations,
        metadata: {
          generationTime,
          model: llmResponse.model,
          isOutOfScope: this.isOutOfScope(llmResponse.text),
          disclaimerIncluded: llmResponse.text.includes(this.promptBuilder.getDisclaimer())
            || llmResponse.text.includes('법적 효력이 없습니다'),
        },
      };

      return {
        success: true,
        data: output,
        metadata: {
          generationTimeMs: String(generationTime),
          model: llmResponse.model,
          inputTokens: String(llmResponse.inputTokens),
          outputTokens: String(llmResponse.outputTokens),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('타임아웃');

      return {
        success: false,
        errors: [{
          code: isTimeout ? 'LLM_TIMEOUT' : 'RESPONSE_GENERATION_FAILED',
          message: isTimeout
            ? '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.'
            : `응답 생성 실패: ${errorMessage}`,
          severity: isTimeout ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
          timestamp: new Date().toISOString(),
          context: { originalError: errorMessage },
        }],
      };
    }
  }

  /**
   * 모듈 헬스체크
   *
   * 모듈 초기화 상태를 확인한다.
   *
   * @returns 현재 헬스 상태
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
    return 'response-generator';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * LLM 응답을 파싱하여 구조화된 FormattedAnswer를 생성한다.
   *
   * 응답 텍스트에서 5개 섹션을 추출하고, 면책 고지를 분리하며,
   * 신뢰도를 계산한다.
   *
   * @param responseText - LLM 응답 전체 텍스트
   * @param searchResults - 검색 결과 (신뢰도 계산용)
   * @returns 구조화된 답변
   */
  private parseResponse(responseText: string, searchResults: SearchOutput): FormattedAnswer {
    const sections = this.extractSections(responseText);
    const disclaimer = this.promptBuilder!.getDisclaimer();
    const confidence = this.calculateConfidence(searchResults);

    return {
      text: responseText,
      sections,
      disclaimer,
      confidence,
    };
  }

  /**
   * 응답 텍스트에서 섹션을 추출한다.
   *
   * [질문 요약], [관련 법령 설명], [관련 판례 설명],
   * [종합 의견], [참고 자료] 섹션을 파싱한다.
   *
   * @param text - LLM 응답 텍스트
   * @returns 섹션 배열
   */
  private extractSections(text: string): AnswerSection[] {
    const sections: AnswerSection[] = [];

    const sectionPatterns = [
      { title: SECTION_TITLES.QUESTION_SUMMARY, pattern: /\[질문\s*요약\][\s\S]*?(?=\[관련\s*법령|$)/i },
      { title: SECTION_TITLES.LAW_EXPLANATION, pattern: /\[관련\s*법령\s*설명\][\s\S]*?(?=\[관련\s*판례|$)/i },
      { title: SECTION_TITLES.CASE_EXPLANATION, pattern: /\[관련\s*판례\s*설명\][\s\S]*?(?=\[종합\s*의견|$)/i },
      { title: SECTION_TITLES.OPINION, pattern: /\[종합\s*의견\][\s\S]*?(?=\[참고\s*자료|$)/i },
      { title: SECTION_TITLES.REFERENCES, pattern: /\[참고\s*자료\][\s\S]*$/i },
    ];

    for (const { title, pattern } of sectionPatterns) {
      const match = text.match(pattern);
      if (match) {
        // 섹션 헤더 제거 후 내용만 추출
        const content = match[0]
          .replace(/^\[.*?\]\s*/i, '')
          .replace(/\*\*\[.*?\]\*\*\s*/i, '')
          .trim();

        sections.push({ title, content });
      } else {
        // 섹션을 찾지 못한 경우 빈 내용으로 추가
        sections.push({ title, content: '' });
      }
    }

    return sections;
  }

  /**
   * LLM 응답에서 인용 정보를 추출한다.
   *
   * 검색 결과의 출처 정보를 기반으로 인용 목록을 생성한다.
   *
   * @param responseText - LLM 응답 텍스트
   * @param searchResults - 검색 결과
   * @returns 인용 목록
   */
  private extractCitations(responseText: string, searchResults: SearchOutput): Citation[] {
    const citations: Citation[] = [];

    // 각주 패턴 매칭 [1], [2] 등
    const footnotePattern = /\[(\d+)\]/g;
    const footnoteNumbers = new Set<number>();
    let match: RegExpExecArray | null;

    while ((match = footnotePattern.exec(responseText)) !== null) {
      footnoteNumbers.add(parseInt(match[1], 10));
    }

    // 검색 결과에서 인용 정보 추출
    const allResults = searchResults.results;
    for (let i = 0; i < allResults.length && i < footnoteNumbers.size; i++) {
      const result = allResults[i];

      if (result.type === SearchResultType.LAW) {
        citations.push({
          type: CitationType.LAW,
          source: result.source.title,
          content: this.truncateContent(result.content, 100),
          confidence: result.score,
        });
      } else {
        citations.push({
          type: CitationType.CASE,
          source: result.source.title,
          content: this.truncateContent(result.content, 200),
          confidence: result.score,
        });
      }
    }

    return citations;
  }

  /**
   * 응답이 부동산 법률 범위 외인지 판별한다.
   *
   * @param responseText - LLM 응답 텍스트
   * @returns 범위 외 여부
   */
  private isOutOfScope(responseText: string): boolean {
    const outOfScopeIndicators = [
      '부동산 법률 관련 질문만 지원합니다',
      '부동산 법률과 관련이 없',
      '지원 범위에 해당하지 않',
    ];

    return outOfScopeIndicators.some((indicator) =>
      responseText.includes(indicator)
    );
  }

  /**
   * 검색 결과의 평균 유사도 점수로 신뢰도를 계산한다.
   *
   * @param searchResults - 검색 결과
   * @returns 신뢰도 (0.0 ~ 1.0)
   */
  private calculateConfidence(searchResults: SearchOutput): number {
    if (!searchResults.results || searchResults.results.length === 0) {
      return 0.3; // 검색 결과 없을 시 기본 낮은 신뢰도
    }

    const totalScore = searchResults.results.reduce((sum, r) => sum + r.score, 0);
    return Math.min(totalScore / searchResults.results.length, 1.0);
  }

  /**
   * 텍스트를 지정된 길이로 잘라낸다.
   *
   * @param content - 원본 텍스트
   * @param maxLength - 최대 길이
   * @returns 잘라낸 텍스트
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }
}
