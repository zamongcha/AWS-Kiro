/**
 * @fileoverview 판례 검색 모듈 팩토리 및 진입점
 * @description 판례 검색 서비스의 전체 서브모듈을 초기화하고 의존성을 주입하며,
 * 플러그인 레지스트리에 등록하는 팩토리 클래스를 제공한다.
 *
 * @requirements 10.1 - 기존 인프라 공유, 독립 모듈 동작
 * @requirements 10.4 - 플러그인 레지스트리 등록 (servicePrefix: CASE_SEARCH)
 * @requirements 10.6 - Circuit Breaker 적용 (오류 격리)
 */

import type {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
} from '../../common/interfaces/index.js';
import { HealthStatusEnum } from '../../common/interfaces/index.js';
import { CircuitBreaker, CircuitBreakerConfig } from '../../common/utils/circuit-breaker.js';
import { FactAnalysisModule } from './fact-analysis/index.js';
import { CaseSearchEngineModule } from './case-search-engine/index.js';
import { CaseAnalysisModule } from './case-analysis/index.js';
import { ComparisonModule } from './comparison/index.js';
import { TrendAnalysisModule } from './trend-analysis/index.js';
import { CaseCitationModule } from './case-citation/index.js';
import { CategoryBrowseModule } from './category-browse/index.js';
import { CaseSearchOrchestrator } from './query-handler/orchestrator.js';

/** 판례 검색 모듈 서비스 접두사 */
const SERVICE_PREFIX = 'CASE_SEARCH';

/**
 * Circuit Breaker 기본 설정 (판례 검색 모듈용)
 */
const CASE_SEARCH_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000,
  monitoringWindow: 60000,
};

/**
 * 판례 검색 모듈 팩토리 클래스
 *
 * 전체 서브모듈을 초기화하고, 의존성을 주입하며,
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다.
 *
 * Circuit Breaker를 적용하여 외부 서비스 호출 실패 시
 * 기존 법률 자문 모듈에 영향을 미치지 않도록 오류를 격리한다.
 */
export class CaseSearchModuleFactory implements ServiceModule {
  private readonly factAnalysis: FactAnalysisModule;
  private readonly searchEngine: CaseSearchEngineModule;
  private readonly caseAnalysis: CaseAnalysisModule;
  private readonly comparison: ComparisonModule;
  private readonly trendAnalysis: TrendAnalysisModule;
  private readonly citation: CaseCitationModule;
  private readonly categoryBrowse: CategoryBrowseModule;
  private readonly orchestrator: CaseSearchOrchestrator;
  private readonly circuitBreaker: CircuitBreaker;
  private initialized = false;

  constructor() {
    this.factAnalysis = new FactAnalysisModule();
    this.searchEngine = new CaseSearchEngineModule();
    this.caseAnalysis = new CaseAnalysisModule();
    this.comparison = new ComparisonModule();
    this.trendAnalysis = new TrendAnalysisModule();
    this.citation = new CaseCitationModule();
    this.categoryBrowse = new CategoryBrowseModule();
    this.orchestrator = new CaseSearchOrchestrator(undefined, {
      factAnalysis: this.factAnalysis,
      searchEngine: this.searchEngine,
      caseAnalysis: this.caseAnalysis,
      comparison: this.comparison,
      trendAnalysis: this.trendAnalysis,
      citation: this.citation,
    });
    this.circuitBreaker = new CircuitBreaker(CASE_SEARCH_CIRCUIT_BREAKER_CONFIG);
  }

  /**
   * 모듈 초기화
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    this.initialized = true;
  }

  /**
   * 모듈 실행
   *
   * Circuit Breaker로 감싸서 장애 격리를 보장한다.
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return {
        success: false,
        errors: [{
          code: 'NOT_INITIALIZED',
          message: '판례 검색 모듈이 초기화되지 않았습니다.',
          severity: 'critical' as never,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    try {
      const result = await this.circuitBreaker.execute(async () => {
        switch (input.type) {
          case 'analyze':
            return this.orchestrator.process(input.payload as { situationDescription: string; sessionId?: string });
          case 'follow-up':
            return this.orchestrator.processFollowUp(
              (input.payload as { sessionId: string }).sessionId,
              (input.payload as { question: string }).question,
            );
          case 'categories':
            return this.categoryBrowse.getCategories();
          case 'category-list':
            return this.categoryBrowse.getCasesByCategory(input.payload as never);
          case 'case-detail':
            return this.categoryBrowse.getCaseById(input.payload as never);
          default:
            throw new Error(`지원하지 않는 작업 유형: ${input.type}`);
        }
      });

      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        errors: [{
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : '판례 검색 실행 중 오류가 발생했습니다.',
          severity: 'high' as never,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

  /**
   * 헬스체크 수행
   */
  async healthCheck(): Promise<HealthStatus> {
    const circuitState = this.circuitBreaker.getState();

    if (circuitState === 'OPEN') {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: {
          circuitBreaker: 'OPEN',
          message: 'Circuit Breaker가 열려 있습니다.',
        },
      };
    }

    if (circuitState === 'HALF_OPEN') {
      return {
        status: HealthStatusEnum.DEGRADED,
        lastCheck: new Date().toISOString(),
        details: {
          circuitBreaker: 'HALF_OPEN',
          message: '복구 시도 중입니다.',
        },
      };
    }

    return {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
      details: {
        circuitBreaker: 'CLOSED',
        initialized: this.initialized,
        modules: {
          factAnalysis: this.factAnalysis.getName(),
          searchEngine: this.searchEngine.getName(),
          caseAnalysis: this.caseAnalysis.getName(),
          comparison: this.comparison.getName(),
          trendAnalysis: this.trendAnalysis.getName(),
          citation: this.citation.getName(),
          categoryBrowse: this.categoryBrowse.getName(),
        },
      },
    };
  }

  getName(): string {
    return `${SERVICE_PREFIX}_MODULE`;
  }

  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 서비스 접두사를 반환한다.
   */
  getServicePrefix(): string {
    return SERVICE_PREFIX;
  }

  /**
   * 오케스트레이터 인스턴스를 반환한다 (외부 접근용).
   */
  getOrchestrator(): CaseSearchOrchestrator {
    return this.orchestrator;
  }

  /**
   * 카테고리 탐색 모듈을 반환한다.
   */
  getCategoryBrowse(): CategoryBrowseModule {
    return this.categoryBrowse;
  }
}

// 인터페이스 re-export
export * from './interfaces/index.js';

// 서브모듈 re-export
export { FactAnalysisModule } from './fact-analysis/index.js';
export { CaseSearchEngineModule } from './case-search-engine/index.js';
export { CaseAnalysisModule } from './case-analysis/index.js';
export { ComparisonModule } from './comparison/index.js';
export { TrendAnalysisModule } from './trend-analysis/index.js';
export { CaseCitationModule } from './case-citation/index.js';
export { CategoryBrowseModule } from './category-browse/index.js';
export { CaseSearchOrchestrator } from './query-handler/orchestrator.js';
