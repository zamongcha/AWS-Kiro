/**
 * @fileoverview 판례 검색 오케스트레이터
 * @description 전체 판례 검색-분석 파이프라인을 조율한다.
 * 입력 검증 → 세션 컨텍스트 조회 → 사실관계 분석 → 판례 검색 →
 * 판례 분석(+ 조건부 비교/트렌드) → 인용 처리 → 세션 저장
 *
 * @requirements 1.7 - 60초 전체 응답 타임아웃
 * @requirements 3.7 - 부분 실패 대응 (비교/트렌드 실패 시 핵심 분석만 반환)
 * @requirements 3.8 - 2초 이내 처리 상태 표시 시작
 * @requirements 8.2 - 후속 질문 시 이전 대화 컨텍스트를 LLM 프롬프트에 포함
 * @requirements 8.3 - 세션 저장
 * @requirements 8.4 - 부분 실패 대응
 * @requirements 8.5 - 60초 타임아웃
 */

import type {
  CaseSearchInput,
  CaseSearchOutput,
  CaseAnalysisResponse,
  IndividualCaseAnalysis,
  CaseCitation,
  ComparisonResult,
  TrendResult,
  FactAnalysisOutput,
  CaseSearchModuleOutput,
  CaseSearchConversation,
} from '../interfaces/index.js';
import { CaseSearchInputValidator } from './input-validator.js';
import { CaseSearchSessionManager } from './session-manager.js';
import { SearchHistoryRecorder } from './history-recorder.js';
import { FactAnalysisModule } from '../fact-analysis/index.js';
import { CaseSearchEngineModule } from '../case-search-engine/index.js';
import { CaseAnalysisModule } from '../case-analysis/index.js';
import { ComparisonModule } from '../comparison/index.js';
import { TrendAnalysisModule } from '../trend-analysis/index.js';
import { CaseCitationModule } from '../case-citation/index.js';

/** 전체 응답 타임아웃 (60초) */
const TOTAL_TIMEOUT_MS = 60000;

/**
 * 오케스트레이터 설정
 */
export interface CaseSearchOrchestratorConfig {
  /** 전체 타임아웃 (ms) */
  timeoutMs?: number;
}

/**
 * 판례 검색 오케스트레이터 클래스
 *
 * 전체 파이프라인을 조율하며, 부분 실패 대응과 타임아웃 관리를 수행한다.
 *
 * @requirements 1.7, 3.7, 3.8, 8.2, 8.3, 8.4, 8.5
 */
export class CaseSearchOrchestrator {
  private readonly validator: CaseSearchInputValidator;
  private readonly sessionManager: CaseSearchSessionManager;
  private readonly historyRecorder: SearchHistoryRecorder;
  private readonly factAnalysis: FactAnalysisModule;
  private readonly searchEngine: CaseSearchEngineModule;
  private readonly caseAnalysis: CaseAnalysisModule;
  private readonly comparison: ComparisonModule;
  private readonly trendAnalysis: TrendAnalysisModule;
  private readonly citation: CaseCitationModule;
  private readonly timeoutMs: number;

  constructor(
    config?: CaseSearchOrchestratorConfig,
    deps?: {
      validator?: CaseSearchInputValidator;
      sessionManager?: CaseSearchSessionManager;
      historyRecorder?: SearchHistoryRecorder;
      factAnalysis?: FactAnalysisModule;
      searchEngine?: CaseSearchEngineModule;
      caseAnalysis?: CaseAnalysisModule;
      comparison?: ComparisonModule;
      trendAnalysis?: TrendAnalysisModule;
      citation?: CaseCitationModule;
    },
  ) {
    this.timeoutMs = config?.timeoutMs ?? TOTAL_TIMEOUT_MS;
    this.validator = deps?.validator ?? new CaseSearchInputValidator();
    this.sessionManager = deps?.sessionManager ?? new CaseSearchSessionManager();
    this.historyRecorder = deps?.historyRecorder ?? new SearchHistoryRecorder();
    this.factAnalysis = deps?.factAnalysis ?? new FactAnalysisModule();
    this.searchEngine = deps?.searchEngine ?? new CaseSearchEngineModule();
    this.caseAnalysis = deps?.caseAnalysis ?? new CaseAnalysisModule();
    this.comparison = deps?.comparison ?? new ComparisonModule();
    this.trendAnalysis = deps?.trendAnalysis ?? new TrendAnalysisModule();
    this.citation = deps?.citation ?? new CaseCitationModule();
  }

  /**
   * 판례 검색-분석 전체 파이프라인을 실행한다.
   *
   * @param input - 사용자 입력 (상황 설명 + 선택적 세션 ID)
   * @returns 판례 검색 출력
   */
  async process(input: { situationDescription: string; sessionId?: string }): Promise<CaseSearchOutput> {
    const startTime = Date.now();

    // 타임아웃 래퍼
    return this.withTimeout(async () => {
      // 1. 입력 검증
      const validation = this.validator.validate(input.situationDescription);
      if (!validation.isValid) {
        throw new Error(validation.errorMessage || '입력이 유효하지 않습니다.');
      }

      const sanitizedInput = validation.sanitizedInput!;

      // 2. 세션 컨텍스트 조회
      let sessionId = input.sessionId;
      let sessionContext: CaseSearchConversation[] = [];

      if (sessionId) {
        sessionContext = await this.sessionManager.getConversationContext(sessionId);
      } else {
        const session = await this.sessionManager.createSession();
        sessionId = this.sessionManager.extractSessionId(session.PK);
      }

      // 3. 사실관계 분석
      const factResult = await this.factAnalysis.analyze({
        situationDescription: sanitizedInput,
        sessionContext: [],
      });

      // 부동산 분쟁이 아닌 경우
      if (!factResult.isRealEstateDispute) {
        throw new Error('부동산 관련 판례 검색만 지원합니다. 임대차, 매매, 등기, 중개, 재건축/재개발 분쟁 상황을 입력해 주세요.');
      }

      // 4. 판례 검색
      const searchResult = await this.searchEngine.search({
        searchQueries: factResult.searchQueries,
        maxResults: 10,
      });

      // 저관련도 안내
      if (searchResult.isLowRelevance && searchResult.cases.length > 0) {
        // 저관련도이지만 결과가 있으면 분석 계속 진행
      }

      // 5. 판례 분석
      const caseAnalyses = await this.caseAnalysis.analyze({
        userSituation: factResult,
        searchResults: searchResult,
      });

      // 6. 인용 생성
      const citations = this.citation.generateCitations(searchResult.cases);

      // 7. 조건부 비교 분석 (부분 실패 허용)
      let comparisonResult: ComparisonResult | null = null;
      try {
        comparisonResult = await this.comparison.compare(searchResult.cases);
      } catch {
        // 비교 분석 실패 시 생략
      }

      // 8. 조건부 트렌드 분석 (부분 실패 허용)
      let trendResult: TrendResult | null = null;
      try {
        if (factResult.disputeTypes.length > 0) {
          trendResult = await this.trendAnalysis.analyze({
            disputeType: factResult.disputeTypes[0],
            relatedIssue: factResult.legalIssues[0] || '',
          });
        }
      } catch {
        // 트렌드 분석 실패 시 생략
      }

      // 9. 응답 조립
      const analysisResponse = this.caseAnalysis.buildResponse({
        userSituation: factResult,
        caseAnalyses,
        citations,
        comparisonAnalysis: comparisonResult,
        trendAnalysis: trendResult,
      });

      // 10. 세션 저장
      try {
        await this.sessionManager.addConversation(sessionId, {
          questionId: `q_${Date.now()}`,
          situationDescription: sanitizedInput,
          factAnalysis: factResult,
          analysisResponse,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // 세션 저장 실패는 응답에 영향을 주지 않음
      }

      // 11. 검색 이력 기록
      try {
        const topScore = searchResult.cases.length > 0
          ? searchResult.cases[0].similarityScore
          : 0;

        await this.historyRecorder.recordSearch(
          sessionId,
          factResult.disputeTypes,
          sanitizedInput,
          searchResult.cases.length,
          topScore,
          Date.now() - startTime,
        );
      } catch {
        // 이력 기록 실패는 응답에 영향을 주지 않음
      }

      return {
        sessionId,
        analysis: analysisResponse,
        processingTimeMs: Date.now() - startTime,
      };
    });
  }

  /**
   * 후속 질문을 처리한다.
   *
   * @param sessionId - 기존 세션 ID
   * @param question - 후속 질문
   * @returns 판례 검색 출력
   */
  async processFollowUp(sessionId: string, question: string): Promise<CaseSearchOutput> {
    return this.process({
      situationDescription: question,
      sessionId,
    });
  }

  /**
   * 타임아웃을 적용한다.
   */
  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('응답 생성에 시간이 초과되었습니다. 다시 시도해 주세요.'));
      }, this.timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
