/**
 * @fileoverview 세무 질문 처리 오케스트레이터
 * @description 전체 세무 질문-응답 파이프라인을 조율하는 핵심 모듈이다.
 * 입력 검증 → 세션 컨텍스트 조회 → 범위 판별 → NLP 전처리 →
 * 검색 → 세율 계산(해당 시) → 응답 생성 → 인용 처리 → 세션 저장
 * 순서로 처리하며, 30초 전체 응답 타임아웃을 관리한다.
 *
 * @requirements 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8
 */

import { TaxInputValidator } from './tax-input-validator.js';
import { TaxSessionManager, TaxSessionRecord, TaxConversationEntry } from './tax-session-manager.js';
import { TaxScopeChecker, ScopeCheckResult } from '../tax-response-generator/tax-scope-checker.js';
import { TaxQueryProcessor, ProcessedQuery } from '../tax-search/tax-query-processor.js';
import { TaxSearchModule } from '../tax-search/index.js';
import { TaxCalculatorModule } from '../tax-calculator/index.js';
import { TaxResponseGeneratorModule } from '../tax-response-generator/index.js';
import { TaxCitationModule } from '../tax-citation/index.js';
import type {
  TaxSearchOutput,
  TaxCalculationResult,
  TaxResponseGeneratorInput,
  TaxResponseGeneratorOutput,
  TaxCitation,
  TaxSavingTip,
  TaxType,
  ExtractedNumericInfo,
} from '../interfaces/index.js';
import type { ModuleInput } from '../../../common/interfaces/service-module.js';

/** 전체 파이프라인 타임아웃 (밀리초): 30초 */
const PIPELINE_TIMEOUT_MS = 30000;

/** 범위 외 질문 안내 메시지 */
const OUT_OF_SCOPE_MESSAGE =
  '부동산 세무(취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세) 관련 질문만 지원합니다.';

/**
 * 오케스트레이터 입력 인터페이스
 */
export interface TaxOrchestratorInput {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 세션 ID (기존 세션 사용 시) */
  sessionId?: string;
  /** 구조화된 수치 입력 보조 필드 */
  numericInputs?: Record<string, number>;
}

/**
 * 오케스트레이터 출력 인터페이스
 */
export interface TaxOrchestratorOutput {
  /** 처리 성공 여부 */
  success: boolean;
  /** 세션 ID */
  sessionId: string;
  /** 최종 답변 텍스트 */
  answer?: string;
  /** 인용 목록 */
  citations?: TaxCitation[];
  /** 세율 계산 결과 */
  calculationResult?: TaxCalculationResult;
  /** 절세 포인트 */
  taxSavingTips?: TaxSavingTip[];
  /** 범위 외 여부 */
  isOutOfScope?: boolean;
  /** 오류 메시지 */
  error?: string;
  /** 재시도 가능 여부 */
  retryable?: boolean;
  /** 처리 메타데이터 */
  metadata?: TaxOrchestratorMetadata;
}

/**
 * 오케스트레이터 메타데이터
 */
export interface TaxOrchestratorMetadata {
  /** 전체 처리 시간 (밀리초) */
  totalTimeMs: number;
  /** 검색 시간 (밀리초) */
  searchTimeMs?: number;
  /** 계산 시간 (밀리초) */
  calculationTimeMs?: number;
  /** 응답 생성 시간 (밀리초) */
  generationTimeMs?: number;
  /** 처리 상태 */
  processingStatus: 'completed' | 'timeout' | 'error';
  /** 감지된 세목 */
  detectedTaxTypes?: TaxType[];
}

/**
 * 오케스트레이터 설정
 */
export interface TaxOrchestratorConfig {
  /** 전체 파이프라인 타임아웃 (밀리초, 기본값: 30000) */
  timeoutMs?: number;
  /** AWS 리전 */
  region?: string;
  /** DynamoDB 세션 테이블 이름 */
  sessionsTableName?: string;
}

/**
 * 세무 질문 처리 오케스트레이터
 *
 * 전체 세무 질문-응답 파이프라인을 조율한다:
 * 1. 입력 검증 (TaxInputValidator)
 * 2. 세션 조회/생성 (TaxSessionManager)
 * 3. 범위 판별 (TaxScopeChecker)
 * 4. NLP 전처리 (TaxQueryProcessor)
 * 5. 검색 실행 (TaxSearchModule)
 * 6. 세율 계산 (TaxCalculatorModule - 수치 정보 존재 시)
 * 7. 응답 생성 (TaxResponseGeneratorModule)
 * 8. 인용 처리 (TaxCitationModule)
 * 9. 세션 저장 (TaxSessionManager)
 *
 * 30초 전체 응답 타임아웃(Promise.race) 적용.
 *
 * @requirements 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8
 */
export class TaxOrchestrator {
  private readonly inputValidator: TaxInputValidator;
  private readonly sessionManager: TaxSessionManager;
  private readonly scopeChecker: TaxScopeChecker;
  private readonly queryProcessor: TaxQueryProcessor;
  private readonly searchModule: TaxSearchModule;
  private readonly calculatorModule: TaxCalculatorModule;
  private readonly responseGenerator: TaxResponseGeneratorModule;
  private readonly citationModule: TaxCitationModule;
  private readonly timeoutMs: number;

  constructor(
    config?: TaxOrchestratorConfig,
    deps?: {
      inputValidator?: TaxInputValidator;
      sessionManager?: TaxSessionManager;
      scopeChecker?: TaxScopeChecker;
      queryProcessor?: TaxQueryProcessor;
      searchModule?: TaxSearchModule;
      calculatorModule?: TaxCalculatorModule;
      responseGenerator?: TaxResponseGeneratorModule;
      citationModule?: TaxCitationModule;
    },
  ) {
    this.timeoutMs = config?.timeoutMs ?? PIPELINE_TIMEOUT_MS;

    this.inputValidator = deps?.inputValidator ?? new TaxInputValidator();
    this.sessionManager = deps?.sessionManager ?? new TaxSessionManager(
      config?.region ?? 'ap-northeast-2',
      config?.sessionsTableName,
    );
    this.scopeChecker = deps?.scopeChecker ?? new TaxScopeChecker();
    this.queryProcessor = deps?.queryProcessor ?? new TaxQueryProcessor();
    this.searchModule = deps?.searchModule ?? new TaxSearchModule();
    this.calculatorModule = deps?.calculatorModule ?? new TaxCalculatorModule();
    this.responseGenerator = deps?.responseGenerator ?? new TaxResponseGeneratorModule();
    this.citationModule = deps?.citationModule ?? new TaxCitationModule();
  }

  /**
   * 전체 세무 질문-응답 파이프라인을 실행한다.
   * 30초 타임아웃이 적용되며, 시간 초과 시 안내 메시지를 반환한다.
   */
  async process(input: TaxOrchestratorInput): Promise<TaxOrchestratorOutput> {
    const startTime = Date.now();

    const timeoutPromise = new Promise<TaxOrchestratorOutput>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          sessionId: input.sessionId || '',
          error: '응답 시간이 초과되었습니다. 다시 시도해 주세요.',
          retryable: true,
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
   */
  private async executeSteps(
    input: TaxOrchestratorInput,
    startTime: number,
  ): Promise<TaxOrchestratorOutput> {
    try {
      // ─── Step 1: 입력 검증 ─────────────────────────────────────────────
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

      const query = input.query.trim();

      // ─── Step 2: 세션 조회/생성 ────────────────────────────────────────
      let session: TaxSessionRecord;
      if (input.sessionId) {
        const existing = await this.sessionManager.getSession(input.sessionId);
        if (existing) {
          session = existing;
        } else {
          session = await this.sessionManager.createSession();
        }
      } else {
        session = await this.sessionManager.createSession();
      }

      // ─── Step 3: 범위 판별 ─────────────────────────────────────────────
      const scopeResult = this.scopeChecker.checkScope(query);
      if (!scopeResult.isInScope) {
        const outOfScopeAnswer = scopeResult.outOfScopeMessage || OUT_OF_SCOPE_MESSAGE;

        await this.sessionManager.addConversation(
          session.sessionId,
          query,
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
          },
        };
      }

      // ─── Step 4: NLP 전처리 ────────────────────────────────────────────
      const processedQuery = this.queryProcessor.processQuery(query);

      // ─── Step 5: 검색 실행 ─────────────────────────────────────────────
      const searchStartTime = Date.now();
      const searchInput: ModuleInput = {
        type: 'tax_search',
        payload: {
          query,
          sessionContext: this.sessionManager.getConversationContext(session),
          maxResults: 5,
        },
      };

      const searchOutput = await this.searchModule.execute(searchInput);
      const searchTimeMs = Date.now() - searchStartTime;

      let searchResults: TaxSearchOutput | null = null;
      if (searchOutput.success && searchOutput.data) {
        searchResults = searchOutput.data as TaxSearchOutput;
      }

      // ─── Step 6: 세율 계산 (수치 정보 존재 시) ────────────────────────
      let calculationResult: TaxCalculationResult | undefined;
      let calculationTimeMs: number | undefined;

      const numerics = processedQuery.extractedNumerics;
      const hasNumerics = numerics && (
        numerics.amount !== undefined ||
        numerics.acquisitionPrice !== undefined ||
        numerics.transferPrice !== undefined ||
        numerics.officialPrice !== undefined
      );

      if (hasNumerics && processedQuery.taxTypes.length > 0) {
        const calcStartTime = Date.now();
        const taxType = processedQuery.taxTypes[0]; // 첫 번째 세목으로 계산

        const calcInput: ModuleInput = {
          type: 'tax_calculation',
          payload: {
            taxType,
            parameters: this.buildCalculationParams(taxType, numerics, input.numericInputs),
          },
        };

        const calcOutput = await this.calculatorModule.execute(calcInput);
        calculationTimeMs = Date.now() - calcStartTime;

        if (calcOutput.success && calcOutput.data) {
          calculationResult = calcOutput.data as TaxCalculationResult;
        }
      }

      // ─── Step 7: 응답 생성 ─────────────────────────────────────────────
      const generationStartTime = Date.now();
      const responseInput: ModuleInput = {
        type: 'tax_response_generation',
        payload: {
          question: query,
          searchResults: searchResults || { taxLawDocuments: [], rulingDocuments: [] },
          calculationResult,
          sessionContext: session.conversations,
        } as TaxResponseGeneratorInput,
      };

      const responseOutput = await this.responseGenerator.execute(responseInput);
      const generationTimeMs = Date.now() - generationStartTime;

      if (!responseOutput.success || !responseOutput.data) {
        return {
          success: false,
          sessionId: session.sessionId,
          error: '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.',
          retryable: true,
          metadata: {
            totalTimeMs: Date.now() - startTime,
            searchTimeMs,
            calculationTimeMs,
            generationTimeMs,
            processingStatus: 'error',
            detectedTaxTypes: processedQuery.taxTypes,
          },
        };
      }

      const generatedResponse = responseOutput.data as TaxResponseGeneratorOutput;

      // ─── Step 8: 인용 처리 ─────────────────────────────────────────────
      const citationInput: ModuleInput = {
        type: 'tax_citation',
        payload: {
          answerText: generatedResponse.answer?.questionSummary
            ? this.buildFullAnswer(generatedResponse)
            : (generatedResponse as any).answer || '',
          referencedLaws: this.extractLawCitations(searchResults),
          referencedRulings: this.extractRulingCitations(searchResults),
        },
      };

      const citationOutput = await this.citationModule.execute(citationInput);

      let finalAnswer: string;
      if (citationOutput.success && citationOutput.data) {
        const citationData = citationOutput.data as { formattedAnswer: string };
        finalAnswer = citationData.formattedAnswer;
      } else {
        finalAnswer = this.buildFullAnswer(generatedResponse);
      }

      const citations = generatedResponse.citations || [];
      const taxSavingTips = generatedResponse.taxSavingTips || [];

      // ─── Step 9: 세션 저장 ─────────────────────────────────────────────
      await this.sessionManager.addConversation(
        session.sessionId,
        query,
        finalAnswer,
        citations,
        calculationResult,
        taxSavingTips,
      );

      return {
        success: true,
        sessionId: session.sessionId,
        answer: finalAnswer,
        citations,
        calculationResult,
        taxSavingTips,
        isOutOfScope: false,
        metadata: {
          totalTimeMs: Date.now() - startTime,
          searchTimeMs,
          calculationTimeMs,
          generationTimeMs,
          processingStatus: 'completed',
          detectedTaxTypes: processedQuery.taxTypes,
        },
      };
    } catch (error) {
      return {
        success: false,
        sessionId: input.sessionId || '',
        error: '일시적 오류가 발생했습니다. 질문이 보존되어 있으니 다시 시도해 주세요.',
        retryable: true,
        metadata: {
          totalTimeMs: Date.now() - startTime,
          processingStatus: 'error',
        },
      };
    }
  }

  /**
   * 세목에 따른 세율 계산 파라미터를 구성한다.
   */
  private buildCalculationParams(
    taxType: TaxType,
    numerics: ExtractedNumericInfo,
    extraInputs?: Record<string, number>,
  ): Record<string, unknown> {
    const params: Record<string, unknown> = { ...extraInputs };

    switch (taxType) {
      case 'acquisition':
        params['purchasePrice'] = numerics.amount || numerics.acquisitionPrice;
        params['propertyType'] = 'house';
        params['housingCount'] = numerics.housingCount || 1;
        break;
      case 'capital_gains':
        params['acquisitionPrice'] = numerics.acquisitionPrice || numerics.amount;
        params['transferPrice'] = numerics.transferPrice;
        params['holdingPeriod'] = numerics.holdingPeriod || 0;
        params['housingCount'] = numerics.housingCount || 1;
        break;
      case 'comprehensive_property':
        params['officialPrice'] = numerics.officialPrice || numerics.amount;
        params['housingCount'] = numerics.housingCount || 1;
        break;
      case 'property':
        params['officialPrice'] = numerics.officialPrice || numerics.amount;
        params['propertyType'] = 'house';
        break;
      case 'gift':
        params['giftAmount'] = numerics.amount;
        params['relationship'] = 'lineal_descendant';
        break;
      case 'inheritance':
        params['totalEstate'] = numerics.amount;
        params['heirs'] = 1;
        break;
    }

    return params;
  }

  /**
   * 검색 결과에서 세법 인용 정보를 추출한다.
   */
  private extractLawCitations(searchResults: TaxSearchOutput | null): unknown[] {
    if (!searchResults?.taxLawDocuments) return [];
    return searchResults.taxLawDocuments.map((doc) => ({
      lawName: doc.metadata?.title || '',
      articleNumber: doc.metadata?.articleNumber || '',
      content: doc.content,
      isAmended: false,
    }));
  }

  /**
   * 검색 결과에서 예규 인용 정보를 추출한다.
   */
  private extractRulingCitations(searchResults: TaxSearchOutput | null): unknown[] {
    if (!searchResults?.rulingDocuments) return [];
    return searchResults.rulingDocuments.map((doc) => ({
      documentNumber: doc.metadata?.title || '',
      replyDate: doc.metadata?.date || '',
      summary: doc.content,
    }));
  }

  /**
   * 응답 생성 결과에서 전체 답변 텍스트를 구성한다.
   */
  private buildFullAnswer(response: TaxResponseGeneratorOutput): string {
    const answer = response.answer;
    if (!answer) return response.disclaimer || '';

    const sections: string[] = [];

    if (answer.questionSummary) {
      sections.push(`[질문 요약]\n${answer.questionSummary}`);
    }
    if (answer.taxLawExplanation) {
      sections.push(`[관련 세법 설명]\n${answer.taxLawExplanation}`);
    }
    if (answer.rulingExplanation) {
      sections.push(`[관련 예규/심판례 설명]\n${answer.rulingExplanation}`);
    }
    if (answer.calculationResult) {
      sections.push(`[세율 계산 결과]\n${answer.calculationResult}`);
    }
    if (answer.taxSavingPoints) {
      sections.push(`[절세 포인트]\n${answer.taxSavingPoints}`);
    }
    if (answer.opinion) {
      sections.push(`[종합 의견]\n${answer.opinion}`);
    }

    const disclaimer = response.disclaimer ||
      '본 답변은 참고용이며 법적 효력이 없습니다. 실제 세무 신고 시 세무사 상담을 권장합니다.';
    sections.push(`\n⚠️ ${disclaimer}`);

    return sections.join('\n\n');
  }
}
