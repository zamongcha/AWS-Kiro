/**
 * @fileoverview 질문 처리 오케스트레이터
 * @description 전체 질문-응답 파이프라인을 조율하는 핵심 모듈이다.
 * 입력 검증 → 세션 컨텍스트 조회 → 범위 판별 → 검색 → 응답 생성 → 인용 처리 → 세션 저장
 * 순서로 처리하며, 30초 전체 응답 타임아웃을 관리한다.
 *
 * @requirements 6.2 - 전체 질문-응답 파이프라인 조율
 * @requirements 6.4 - 30초 전체 응답 타임아웃, 2초 이내 처리 상태 표시
 * @requirements 6.5 - API Gateway 엔드포인트 통합
 * @requirements 6.7 - 후속 질문 시 이전 대화 컨텍스트 참조
 */

import { InputValidator } from './input-validator.js';
import { SessionManager, StoredSessionRecord } from './session-manager.js';
import { SearchModule } from '../search/index.js';
import { ResponseGeneratorModule } from '../response-generator/index.js';
import { CitationModule, CitationModulePayload } from '../citation/index.js';
import { ScopeChecker, ScopeCheckResult, OUT_OF_SCOPE_MESSAGE } from '../response-generator/scope-checker.js';
import { ModuleInput } from '../../common/interfaces/service-module.js';
import { SearchOutput, SearchResultType } from '../../common/interfaces/search.js';
import { ResponseGeneratorInput, ResponseGeneratorOutput } from '../../common/interfaces/response.js';
import { Citation, ConversationEntry } from '../../common/interfaces/data-models.js';
import { LawCitationInput, CaseCitationInput } from '../citation/citation-formatter.js';

/** 전체 파이프라인 타임아웃 (밀리초) */
const PIPELINE_TIMEOUT_MS = 30000;

/** 처리 상태 표시 시작 시간 (밀리초) */
const STATUS_DISPLAY_THRESHOLD_MS = 2000;

/**
 * 오케스트레이터 입력 인터페이스
 */
export interface OrchestratorInput {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 세션 ID (기존 세션 사용 시) */
  sessionId?: string;
}

/**
 * 오케스트레이터 출력 인터페이스
 */
export interface OrchestratorOutput {
  /** 처리 성공 여부 */
  success: boolean;
  /** 세션 ID */
  sessionId: string;
  /** 포맷된 최종 답변 텍스트 */
  answer?: string;
  /** 인용 목록 */
  citations?: Citation[];
  /** 부동산 법률 범위 외 여부 */
  isOutOfScope?: boolean;
  /** 오류 메시지 (실패 시) */
  error?: string;
  /** 처리 메타데이터 */
  metadata?: OrchestratorMetadata;
}

/**
 * 오케스트레이터 메타데이터
 */
export interface OrchestratorMetadata {
  /** 전체 처리 시간 (밀리초) */
  totalTimeMs: number;
  /** 검색 시간 (밀리초) */
  searchTimeMs?: number;
  /** 응답 생성 시간 (밀리초) */
  generationTimeMs?: number;
  /** 처리 상태 */
  processingStatus: 'completed' | 'timeout' | 'error';
  /** 세션 대화 수 */
  conversationCount?: number;
}

/**
 * 오케스트레이터 설정 인터페이스
 */
export interface OrchestratorConfig {
  /** 전체 파이프라인 타임아웃 (밀리초, 기본값: 30000) */
  timeoutMs?: number;
  /** AWS 리전 (기본값: 'ap-northeast-2') */
  region?: string;
  /** DynamoDB 세션 테이블 이름 */
  sessionsTableName?: string;
}

/**
 * 질문 처리 오케스트레이터 클래스
 *
 * 전체 질문-응답 파이프라인을 조율한다:
 * 1. 입력 검증 (InputValidator)
 * 2. 세션 조회 또는 생성 (SessionManager)
 * 3. 범위 판별 (ScopeChecker)
 * 4. 검색 실행 (SearchModule)
 * 5. 응답 생성 (ResponseGeneratorModule)
 * 6. 인용 처리 (CitationModule)
 * 7. 세션 저장 (SessionManager)
 *
 * 30초 전체 응답 타임아웃을 적용하여 시간 초과 시 안내 메시지를 반환한다.
 *
 * @requirements 6.2, 6.4, 6.5, 6.7
 */
export class Orchestrator {
  private readonly inputValidator: InputValidator;
  private readonly sessionManager: SessionManager;
  private readonly scopeChecker: ScopeChecker;
  private readonly searchModule: SearchModule;
  private readonly responseGenerator: ResponseGeneratorModule;
  private readonly citationModule: CitationModule;
  private readonly timeoutMs: number;

  /**
   * Orchestrator 생성자
   *
   * @param config - 오케스트레이터 설정
   * @param deps - 의존 모듈 주입 (테스트용)
   */
  constructor(
    config?: OrchestratorConfig,
    deps?: {
      inputValidator?: InputValidator;
      sessionManager?: SessionManager;
      scopeChecker?: ScopeChecker;
      searchModule?: SearchModule;
      responseGenerator?: ResponseGeneratorModule;
      citationModule?: CitationModule;
    },
  ) {
    this.timeoutMs = config?.timeoutMs ?? PIPELINE_TIMEOUT_MS;

    // 의존성 주입 또는 기본 인스턴스 생성
    this.inputValidator = deps?.inputValidator ?? new InputValidator();
    this.sessionManager = deps?.sessionManager ?? new SessionManager(
      config?.region ?? 'ap-northeast-2',
      config?.sessionsTableName,
    );
    this.scopeChecker = deps?.scopeChecker ?? new ScopeChecker();
    this.searchModule = deps?.searchModule ?? new SearchModule();
    this.responseGenerator = deps?.responseGenerator ?? new ResponseGeneratorModule();
    this.citationModule = deps?.citationModule ?? new CitationModule();
  }

  /**
   * 전체 질문-응답 파이프라인을 실행한다.
   *
   * 30초 타임아웃이 적용되며, 시간 초과 시 안내 메시지를 반환한다.
   * 각 단계에서 오류 발생 시 적절한 사용자 안내 메시지를 포함하여 응답한다.
   *
   * @param input - 사용자 질문 및 세션 정보
   * @returns 최종 응답 (답변 + 인용 + 메타데이터)
   *
   * @example
   * ```typescript
   * const orchestrator = new Orchestrator();
   * const result = await orchestrator.process({
   *   query: "임대차보호법에서 보증금 반환 기한은 어떻게 되나요?",
   *   sessionId: "sess_12345_abc"
   * });
   * ```
   */
  async process(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const startTime = Date.now();

    // 30초 타임아웃 적용
    const timeoutPromise = new Promise<OrchestratorOutput>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          sessionId: input.sessionId || '',
          error: '응답 시간이 초과되었습니다. 다시 시도해 주세요.',
          metadata: {
            totalTimeMs: this.timeoutMs,
            processingStatus: 'timeout',
          },
        });
      }, this.timeoutMs);
    });

    const processingPromise = this.executeSteps(input, startTime);

    return Promise.race([processingPromise, timeoutPromise]);
  }

  /**
   * 파이프라인 각 단계를 순차 실행한다.
   *
   * @param input - 오케스트레이터 입력
   * @param startTime - 처리 시작 시각 (밀리초)
   * @returns 최종 응답
   */
  private async executeSteps(
    input: OrchestratorInput,
    startTime: number,
  ): Promise<OrchestratorOutput> {
    try {
      // ─── Step 1: 입력 검증 ─────────────────────────────────────────────────
      const validationResult = this.inputValidator.validate(input.query);
      if (!validationResult.valid) {
        return {
          success: false,
          sessionId: input.sessionId || '',
          error: validationResult.error,
          metadata: {
            totalTimeMs: Date.now() - startTime,
            processingStatus: 'error',
          },
        };
      }

      // ─── Step 2: 세션 조회 또는 생성 ───────────────────────────────────────
      let session: StoredSessionRecord;
      if (input.sessionId) {
        const existingSession = await this.sessionManager.getSession(input.sessionId);
        if (existingSession) {
          session = existingSession;
        } else {
          // 세션이 만료되었거나 존재하지 않으면 새로 생성
          session = await this.sessionManager.createSession();
        }
      } else {
        session = await this.sessionManager.createSession();
      }

      // ─── Step 3: 범위 판별 ─────────────────────────────────────────────────
      const scopeResult = this.scopeChecker.checkScope(input.query);
      if (!scopeResult.isInScope) {
        // 범위 외 질문: 즉시 반환
        const outOfScopeAnswer = this.buildOutOfScopeResponse(scopeResult);

        // 범위 외 질문도 세션에 기록
        await this.sessionManager.addConversation(
          session.sessionId,
          input.query,
          outOfScopeAnswer,
          [],
        );

        return {
          success: true,
          sessionId: session.sessionId,
          answer: outOfScopeAnswer,
          citations: [],
          isOutOfScope: true,
          metadata: {
            totalTimeMs: Date.now() - startTime,
            processingStatus: 'completed',
            conversationCount: session.conversations.length + 1,
          },
        };
      }

      // ─── Step 4: 검색 실행 ─────────────────────────────────────────────────
      const searchStartTime = Date.now();
      const searchInput: ModuleInput = {
        type: 'search',
        payload: {
          query: input.query,
          options: {
            maxResults: 5,
            threshold: 0.5,
          },
        },
      };

      const searchOutput = await this.searchModule.execute(searchInput);
      const searchTimeMs = Date.now() - searchStartTime;

      if (!searchOutput.success || !searchOutput.data) {
        return {
          success: false,
          sessionId: session.sessionId,
          error: '일시적 오류가 발생했습니다. 질문이 보존되어 있으니 다시 시도해 주세요.',
          metadata: {
            totalTimeMs: Date.now() - startTime,
            searchTimeMs,
            processingStatus: 'error',
          },
        };
      }

      const searchResults = searchOutput.data as SearchOutput;

      // ─── Step 5: 응답 생성 ─────────────────────────────────────────────────
      const generationStartTime = Date.now();

      // 이전 대화 컨텍스트를 전달하여 후속 질문 지원
      const sessionContext: ConversationEntry[] = session.conversations;

      const responseInput: ModuleInput = {
        type: 'generate_response',
        payload: {
          query: input.query,
          searchResults,
          sessionContext: sessionContext.length > 0 ? sessionContext : undefined,
        } as ResponseGeneratorInput,
      };

      const responseOutput = await this.responseGenerator.execute(responseInput);
      const generationTimeMs = Date.now() - generationStartTime;

      if (!responseOutput.success || !responseOutput.data) {
        // LLM 타임아웃 또는 실패
        const errorMsg = responseOutput.errors?.[0]?.message
          ?? '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.';

        return {
          success: false,
          sessionId: session.sessionId,
          error: errorMsg,
          metadata: {
            totalTimeMs: Date.now() - startTime,
            searchTimeMs,
            generationTimeMs,
            processingStatus: 'error',
          },
        };
      }

      const generatedResponse = responseOutput.data as ResponseGeneratorOutput;

      // ─── Step 6: 인용 처리 ─────────────────────────────────────────────────
      const citationPayload = this.buildCitationPayload(
        generatedResponse.answer.text,
        generatedResponse.citations,
        searchResults,
      );

      const citationInput: ModuleInput = {
        type: 'citation',
        payload: citationPayload,
      };

      const citationOutput = await this.citationModule.execute(citationInput);

      // 인용 처리 실패해도 원본 답변으로 계속 진행 (graceful degradation)
      let finalAnswer: string;
      if (citationOutput.success && citationOutput.data) {
        const citationData = citationOutput.data as { finalText: string };
        finalAnswer = citationData.finalText;
      } else {
        // 인용 처리 실패 시 원본 답변 + 면책 고지 사용
        finalAnswer = this.scopeChecker.appendDisclaimer(generatedResponse.answer.text);
      }

      // ─── Step 7: 세션 저장 ─────────────────────────────────────────────────
      const citations = generatedResponse.citations;
      await this.sessionManager.addConversation(
        session.sessionId,
        input.query,
        finalAnswer,
        citations,
      );

      return {
        success: true,
        sessionId: session.sessionId,
        answer: finalAnswer,
        citations,
        isOutOfScope: false,
        metadata: {
          totalTimeMs: Date.now() - startTime,
          searchTimeMs,
          generationTimeMs,
          processingStatus: 'completed',
          conversationCount: session.conversations.length + 1,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        sessionId: input.sessionId || '',
        error: `일시적 오류가 발생했습니다. 질문이 보존되어 있으니 다시 시도해 주세요.`,
        metadata: {
          totalTimeMs: Date.now() - startTime,
          processingStatus: 'error',
        },
      };
    }
  }

  /**
   * 범위 외 질문에 대한 응답 메시지를 생성한다.
   *
   * @param scopeResult - 범위 판별 결과
   * @returns 범위 외 안내 메시지
   */
  private buildOutOfScopeResponse(scopeResult: ScopeCheckResult): string {
    return scopeResult.outOfScopeMessage ?? OUT_OF_SCOPE_MESSAGE;
  }

  /**
   * 인용 모듈에 전달할 페이로드를 구성한다.
   *
   * 응답 생성기에서 추출한 Citation 목록과 검색 결과를 기반으로
   * CitationModulePayload를 생성한다.
   *
   * @param answerText - 답변 본문 텍스트
   * @param citations - 인용 목록
   * @param searchResults - 검색 결과
   * @returns CitationModulePayload
   */
  private buildCitationPayload(
    answerText: string,
    citations: Citation[],
    searchResults: SearchOutput,
  ): CitationModulePayload {
    const lawCitations: LawCitationInput[] = [];
    const caseCitations: CaseCitationInput[] = [];

    // 검색 결과에서 법령/판례 인용 정보 추출
    for (const result of searchResults.results) {
      if (result.type === SearchResultType.LAW) {
        lawCitations.push({
          lawName: result.source.title,
          articleNumber: '',
          content: result.content,
          isAmended: false,
        });
      } else if (result.type === SearchResultType.CASE) {
        caseCitations.push({
          caseNumber: result.source.title,
          judgmentDate: result.source.date || '',
          summary: result.content,
        });
      }
    }

    return {
      answerText,
      lawCitations,
      caseCitations,
    };
  }

  /**
   * 현재 파이프라인의 경과 시간이 상태 표시 임계값(2초)을 초과했는지 확인한다.
   * API Gateway에서 스트리밍 응답 시작 여부 결정에 사용한다.
   *
   * @param startTime - 처리 시작 시각 (밀리초)
   * @returns 임계값 초과 여부
   */
  shouldShowProcessingStatus(startTime: number): boolean {
    return (Date.now() - startTime) >= STATUS_DISPLAY_THRESHOLD_MS;
  }
}
