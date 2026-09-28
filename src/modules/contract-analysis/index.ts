/**
 * @fileoverview 계약서 AI 분석 모듈 팩토리 및 진입점
 * @description 계약서 분석 전용 서비스의 전체 서브모듈을 초기화하고 의존성을
 * 주입하며, 표준 `ServiceModule` 인터페이스를 구현하여 플러그인 레지스트리에
 * 등록 가능한 팩토리 클래스를 제공한다.
 *
 * 설계 기준은 기존 판례 검색 모듈 팩토리(`src/modules/case-search/index.ts`)와
 * 동일한 패턴을 따른다:
 *   - `ServiceModule`을 구현하여 플러그인 레지스트리(`servicePrefix: 'CONTRACT'`)에
 *     등록한다.
 *   - 모든 실행(`execute`)을 Circuit Breaker(`src/common/utils/circuit-breaker.ts`)로
 *     감싸, 계약서 분석 모듈의 장애가 기존 법률/세무/판례 모듈로 전파되지 않도록
 *     격리한다.
 *   - `healthCheck`에서 Circuit Breaker 상태와 각 서브모듈 상태를 함께 점검한다.
 *
 * 의존성 주입:
 *   외부 인프라(S3/DynamoDB/OpenSearch/임베딩) 의존성이 없는 서브모듈
 *   (수정제안 생성기·특약 추천기·인용 표시기·판례 연동기·체크리스트·등기부
 *   대조기·정보 추출기·위험도 평가기)은 기본 인스턴스를 생성한다. 인프라
 *   의존성이 필수인 서브모듈(위험조항 탐지기·비교 분석기·오케스트레이터 등)은
 *   `ContractAnalysisModuleDeps`로 주입받으며, 주입되지 않으면 해당 서브모듈은
 *   비활성 상태로 두고 헬스체크에서 준비되지 않음(degraded)으로 보고한다.
 *
 * @module ContractAnalysisModuleFactory
 * @requirements 16.5 - 기존 인프라 공유, 독립 모듈 동작
 * @requirements 16.6 - Circuit Breaker 적용으로 오류 격리 (장애 전파 방지)
 */

import {
  HealthStatusEnum,
  type HealthStatus,
  type ModuleConfig,
  type ModuleInput,
  type ModuleOutput,
  type ServiceModule,
} from '../../common/interfaces/service-module.js';
import {
  CircuitBreaker,
  CircuitBreakerState,
  type CircuitBreakerConfig,
} from '../../common/utils/circuit-breaker.js';

import { InfoExtractorModule } from './info-extractor/index.js';
import { RiskEvaluatorModule } from './risk-evaluator/index.js';
import { RiskDetectorModule } from './risk-detector/index.js';
import { RevisionAdvisorModule } from './revision-advisor/index.js';
import { ClauseRecommenderModule } from './clause-recommender/index.js';
import { CitationModule } from './citation/index.js';
import { CaseLinkerModule } from './case-linker/index.js';
import { ComparatorModule } from './comparator/index.js';
import { RegistryMatcherModule } from './registry-matcher/index.js';
import { VersionManagerModule } from './version-manager/index.js';
import { SimulationEngineModule } from './simulation-engine/index.js';
import { ChecklistModule } from './checklist/index.js';
import { ChecklistService } from './checklist/checklist-service.js';
import { AnalysisOrchestrator } from './orchestrator/analysis-orchestrator.js';
import type { ContractAdminService } from './admin/admin-service.js';

/** 계약서 분석 모듈 서비스 접두사 (요구사항 16.5) */
export const CONTRACT_SERVICE_PREFIX = 'CONTRACT';

/**
 * Circuit Breaker 기본 설정 (계약서 분석 모듈용).
 *
 * 판례 검색 모듈과 동일한 보수적 기본값을 사용하여, 연속 실패 시 회로를
 * 개방하고 30초 후 복구를 시도한다. 이 격리로 계약서 분석 장애가 다른
 * 서비스로 전파되지 않는다(요구사항 16.6).
 */
export const CONTRACT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000,
  monitoringWindow: 60000,
};

/**
 * 계약서 분석 모듈이 지원하는 실행 작업 유형.
 *
 * `execute` 진입점에서 `ModuleInput.type`으로 사용되며, 각 유형은 대응하는
 * 서브모듈로 위임된다. 인프라 의존성이 필요한 유형은 해당 의존성이 주입된
 * 경우에만 처리된다.
 */
export type ContractAnalysisOperation =
  | 'analyze'
  | 'advise'
  | 'recommend'
  | 'registry'
  | 'version'
  | 'simulate'
  | 'checklist'
  | 'admin';

/**
 * 계약서 분석 팩토리에 주입 가능한 인프라 의존 서브모듈.
 *
 * 각 항목은 외부 인프라(S3/DynamoDB/OpenSearch/임베딩/판례 서비스)에 의존하므로
 * 지연 생성 팩토리(`() => T`)로 주입한다. 미주입 시 해당 기능은 비활성 상태로
 * 두며, 헬스체크에서 준비되지 않음으로 보고한다.
 */
export interface ContractAnalysisModuleDeps {
  /** 위험조항 탐지기 (RuleMatcher·저장소 의존) */
  riskDetector?: () => RiskDetectorModule;
  /** 비교 분석기 (표준계약서 저장소 의존) */
  comparator?: () => ComparatorModule;
  /** 버전 관리기 (DynamoDB 의존) */
  versionManager?: () => VersionManagerModule;
  /** 시뮬레이션 엔진 (탐지·평가기 의존) */
  simulationEngine?: () => SimulationEngineModule;
  /** 분석 오케스트레이터 (전체 파이프라인 조율) */
  orchestrator?: () => AnalysisOrchestrator;
  /** 관리(admin) 데이터 적재 서비스 (임베딩·OpenSearch 의존) */
  adminService?: () => ContractAdminService;
}

/**
 * 지연 생성기를 만든다. 최초 호출 시 인스턴스를 생성하고 이후 재사용한다.
 *
 * @param create - 인스턴스 생성 함수
 * @returns 캐시된 인스턴스를 반환하는 함수
 */
function lazy<T>(create: () => T): () => T {
  let cached: T | undefined;
  return () => {
    if (cached === undefined) {
      cached = create();
    }
    return cached;
  };
}

/**
 * 계약서 AI 분석 모듈 팩토리.
 *
 * 전체 서브모듈을 초기화하고 의존성을 주입하며, `ServiceModule` 인터페이스를
 * 구현하여 플러그인 레지스트리에 등록 가능하다. 모든 실행은 Circuit Breaker로
 * 감싸져 있어 계약서 분석 장애가 기존 서비스(법률/세무/판례)로 전파되지 않는다.
 *
 * @requirements 16.5, 16.6
 */
export class ContractAnalysisModuleFactory implements ServiceModule {
  /** 정보 추출기 (인프라 비의존, 기본 인스턴스) */
  private readonly infoExtractor: InfoExtractorModule;
  /** 위험도 평가기 (인프라 비의존, 기본 인스턴스) */
  private readonly riskEvaluator: RiskEvaluatorModule;
  /** 수정제안 생성기 (인프라 비의존, 기본 인스턴스) */
  private readonly revisionAdvisor: RevisionAdvisorModule;
  /** 특약 추천기 (인프라 비의존, 기본 인스턴스) */
  private readonly clauseRecommender: ClauseRecommenderModule;
  /** 인용 표시기 (인프라 비의존, 기본 인스턴스) */
  private readonly citation: CitationModule;
  /** 판례 연동기 (판례 서비스 폴백 내장, 기본 인스턴스) */
  private readonly caseLinker: CaseLinkerModule;
  /** 등기부 대조기 (OCR 제공자 기본 생성, 기본 인스턴스) */
  private readonly registryMatcher: RegistryMatcherModule;
  /** 첨부서류 체크리스트 (코드 내 시드, 기본 인스턴스) */
  private readonly checklist: ChecklistModule;
  /** 첨부서류 체크리스트 서비스 (오케스트레이터 등 재사용) */
  private readonly checklistService: ChecklistService;

  /** 인프라 의존 서브모듈 지연 생성기 (미주입 시 undefined) */
  private readonly deps: ContractAnalysisModuleDeps;

  /** 실행 격리용 Circuit Breaker */
  private readonly circuitBreaker: CircuitBreaker;

  private initialized = false;

  /**
   * 팩토리를 생성하고 인프라 비의존 서브모듈을 초기화한다.
   *
   * @param deps - 인프라 의존 서브모듈 주입 (선택)
   */
  constructor(deps: ContractAnalysisModuleDeps = {}) {
    // 인프라 비의존 서브모듈: 기본 인스턴스 생성
    this.infoExtractor = new InfoExtractorModule();
    this.riskEvaluator = new RiskEvaluatorModule();
    this.revisionAdvisor = new RevisionAdvisorModule();
    this.clauseRecommender = new ClauseRecommenderModule();
    this.citation = new CitationModule();
    this.caseLinker = new CaseLinkerModule();
    this.registryMatcher = new RegistryMatcherModule();
    this.checklist = new ChecklistModule();
    this.checklistService = new ChecklistService();

    // 인프라 의존 서브모듈: 지연 생성기로 보존(최초 사용 시 생성)
    this.deps = {
      ...(deps.riskDetector ? { riskDetector: lazy(deps.riskDetector) } : {}),
      ...(deps.comparator ? { comparator: lazy(deps.comparator) } : {}),
      ...(deps.versionManager ? { versionManager: lazy(deps.versionManager) } : {}),
      ...(deps.simulationEngine
        ? { simulationEngine: lazy(deps.simulationEngine) }
        : {}),
      ...(deps.orchestrator ? { orchestrator: lazy(deps.orchestrator) } : {}),
      ...(deps.adminService ? { adminService: lazy(deps.adminService) } : {}),
    };

    this.circuitBreaker = new CircuitBreaker(CONTRACT_CIRCUIT_BREAKER_CONFIG);
  }

  /**
   * 모듈을 초기화한다.
   *
   * 서브모듈 의존성은 생성자에서 이미 주입되었으므로, 초기화 완료 플래그만
   * 설정한다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    this.initialized = true;
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * `input.type`으로 작업을 판별하여 대응 서브모듈로 위임한다. 모든 위임은
   * Circuit Breaker로 감싸져 있어, 반복 실패 시 회로가 개방되어 이후 요청을
   * 즉시 거부한다(장애 격리, 요구사항 16.6). 인프라 의존 서브모듈이 주입되지
   * 않은 경우 해당 작업은 준비되지 않음(NOT_READY) 오류를 반환한다.
   *
   * @param input - 모듈 입력 (type: ContractAnalysisOperation)
   * @returns 모듈 출력
   *
   * @requirements 16.6
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return this.failure(
        'NOT_INITIALIZED',
        '계약서 분석 모듈이 초기화되지 않았어요.',
        'critical',
      );
    }

    try {
      return await this.circuitBreaker.execute(() => this.route(input));
    } catch (error) {
      return this.failure(
        'EXECUTION_ERROR',
        error instanceof Error
          ? error.message
          : '계약서 분석 실행 중 오류가 발생했어요.',
        'high',
      );
    }
  }

  /**
   * 작업 유형에 따라 대응 서브모듈로 위임한다.
   *
   * 표준 `ServiceModule.execute`를 제공하는 서브모듈은 해당 계약대로 위임하고,
   * 오케스트레이터·관리 서비스처럼 별도 API를 가진 서브모듈은 결과를
   * `ModuleOutput` 형태로 감싸 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 모듈 출력
   */
  private async route(input: ModuleInput): Promise<ModuleOutput> {
    switch (input.type as ContractAnalysisOperation) {
      case 'advise':
        return this.revisionAdvisor.execute(input);
      case 'registry':
        return this.registryMatcher.execute(input);
      case 'version':
        return this.requireDep(this.deps.versionManager, '버전 관리').execute(
          input,
        );
      case 'simulate':
        return this.requireDep(
          this.deps.simulationEngine,
          '협상 시나리오 시뮬레이션',
        ).execute(input);
      case 'checklist':
        return this.checklist.execute(input);
      case 'analyze':
        return this.executeAnalyze(input);
      case 'recommend':
        return this.executeRecommend(input);
      case 'admin':
        return this.executeAdmin(input);
      default:
        return this.failure(
          'UNSUPPORTED_OPERATION',
          `지원하지 않는 작업 유형이에요: ${input.type}`,
          'medium',
        );
    }
  }

  /**
   * 전체 분석 파이프라인을 오케스트레이터에 위임한다.
   *
   * 오케스트레이터는 타임아웃·부분 실패(Graceful Degradation)를 자체 처리하며,
   * 실패 결과는 표준 오류 형태로 변환하여 반환한다.
   *
   * @param input - 모듈 입력 (payload: AnalysisOrchestratorInput)
   * @returns 모듈 출력
   */
  private async executeAnalyze(input: ModuleInput): Promise<ModuleOutput> {
    const orchestrator = this.requireDep(this.deps.orchestrator, '계약서 분석');
    const result = await orchestrator.analyze(
      input.payload as Parameters<AnalysisOrchestrator['analyze']>[0],
    );
    if (result.success) {
      return { success: true, data: result.result };
    }
    return {
      success: false,
      errors: [
        {
          code: result.error.code,
          message: result.error.message,
          severity: 'high' as never,
          timestamp: new Date().toISOString(),
          context: {
            manualRetryAvailable: result.error.manualRetryAvailable,
            autoRetryCount: result.error.autoRetryCount,
            documentPreserved: result.error.documentPreserved,
          },
        },
      ],
    };
  }

  /**
   * 실시간 특약 추천을 특약 추천기에 위임한다.
   *
   * 특약 추천기는 표준 `ServiceModule.execute`가 아닌 `recommend()` API를
   * 제공하므로, 결과를 `ModuleOutput`으로 감싸 반환한다.
   *
   * @param input - 모듈 입력 (payload: ClauseRecommenderInput)
   * @returns 모듈 출력
   */
  private async executeRecommend(input: ModuleInput): Promise<ModuleOutput> {
    const output = await this.clauseRecommender.recommend(
      input.payload as Parameters<ClauseRecommenderModule['recommend']>[0],
    );
    return { success: true, data: output };
  }

  /**
   * 관리자 룰셋/표준계약서 갱신을 관리 서비스에 위임한다.
   *
   * @param input - 모듈 입력 (payload: { kind, contractType, rules?/clauses? })
   * @returns 모듈 출력
   */
  private async executeAdmin(input: ModuleInput): Promise<ModuleOutput> {
    const admin = this.requireDep(this.deps.adminService, '관리자 데이터 갱신');
    const payload = input.payload as {
      kind: 'ruleset' | 'standard';
      contractType: Parameters<ContractAdminService['updateRuleSet']>[0];
      rules?: Parameters<ContractAdminService['updateRuleSet']>[1];
      clauses?: Parameters<ContractAdminService['updateStandardForm']>[1];
    };

    if (payload.kind === 'ruleset') {
      const result = await admin.updateRuleSet(
        payload.contractType,
        payload.rules ?? [],
      );
      return { success: result.success, data: result };
    }
    if (payload.kind === 'standard') {
      const result = await admin.updateStandardForm(
        payload.contractType,
        payload.clauses ?? [],
      );
      return { success: result.success, data: result };
    }
    return this.failure(
      'CONTRACT_ADMIN_INVALID_INPUT',
      'kind는 ruleset 또는 standard여야 해요.',
      'medium',
    );
  }

  /**
   * 인프라 의존 서브모듈을 반환하되, 주입되지 않았으면 오류를 던진다.
   *
   * 던져진 오류는 `execute`의 Circuit Breaker/try-catch에서 표준 오류 응답으로
   * 변환된다.
   *
   * @param factory - 지연 생성기 (없으면 undefined)
   * @param feature - 사용 불가 기능 이름 (한국어)
   * @returns 서브모듈 인스턴스
   * @throws 서브모듈이 주입되지 않은 경우
   */
  private requireDep<T>(factory: (() => T) | undefined, feature: string): T {
    if (!factory) {
      throw new Error(
        `${feature} 기능이 현재 준비되지 않았어요. 잠시 후 다시 시도해 주세요.`,
      );
    }
    return factory();
  }

  /**
   * 표준 실패 `ModuleOutput`을 생성한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 대면 메시지 (존댓말 한국어)
   * @param severity - 오류 심각도 문자열
   * @returns 실패 모듈 출력
   */
  private failure(
    code: string,
    message: string,
    severity: 'critical' | 'high' | 'medium' | 'low',
  ): ModuleOutput {
    return {
      success: false,
      errors: [
        {
          code,
          message,
          severity: severity as never,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  /**
   * 모듈 헬스체크를 수행한다.
   *
   * Circuit Breaker 상태를 우선 반영하고(개방=UNHEALTHY, 반개방=DEGRADED),
   * 정상(닫힘) 상태에서는 각 서브모듈의 헬스 상태를 함께 점검한다. 인프라
   * 의존 서브모듈이 주입되지 않은 경우 준비되지 않음(notReady)으로 표기하되
   * 전체 상태를 UNHEALTHY로 낮추지는 않는다(인프라 비의존 핵심 기능은 계속
   * 제공되므로 DEGRADED로 표기한다).
   *
   * @returns 헬스 상태
   *
   * @requirements 16.5, 16.6
   */
  async healthCheck(): Promise<HealthStatus> {
    const now = new Date().toISOString();
    const circuitState = this.circuitBreaker.getState();

    if (circuitState === CircuitBreakerState.Open) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: now,
        details: {
          circuitBreaker: circuitState,
          message: 'Circuit Breaker가 열려 있어요. 잠시 후 다시 시도해 주세요.',
        },
      };
    }

    // 인프라 비의존 서브모듈 헬스 점검
    const submoduleHealth = await this.checkSubmodules();
    const anyUnhealthy = Object.values(submoduleHealth).some(
      (status) => status === HealthStatusEnum.UNHEALTHY,
    );

    // 인프라 의존 서브모듈 준비 여부
    const notReady = this.listNotReadyDeps();

    let status: HealthStatusEnum;
    if (anyUnhealthy) {
      status = HealthStatusEnum.UNHEALTHY;
    } else if (
      circuitState === CircuitBreakerState.HalfOpen ||
      notReady.length > 0
    ) {
      status = HealthStatusEnum.DEGRADED;
    } else {
      status = HealthStatusEnum.HEALTHY;
    }

    return {
      status,
      lastCheck: now,
      details: {
        circuitBreaker: circuitState,
        initialized: this.initialized,
        submodules: submoduleHealth,
        notReady,
      },
    };
  }

  /**
   * 인프라 비의존 서브모듈들의 헬스 상태를 병렬로 점검한다.
   *
   * 개별 헬스체크 실패는 UNHEALTHY로 간주하며, 다른 서브모듈 점검에 영향을
   * 주지 않는다.
   *
   * @returns 서브모듈 이름 → 헬스 상태 문자열 매핑
   */
  private async checkSubmodules(): Promise<Record<string, HealthStatusEnum>> {
    const entries: Array<[string, ServiceModule]> = [
      ['info-extractor', this.infoExtractor],
      ['risk-evaluator', this.riskEvaluator],
      ['revision-advisor', this.revisionAdvisor],
      ['clause-recommender', this.clauseRecommender],
      ['citation', this.citation],
      ['case-linker', this.caseLinker],
      ['registry-matcher', this.registryMatcher],
      ['checklist', this.checklist],
    ];

    const results = await Promise.all(
      entries.map(async ([name, module]) => {
        try {
          const health = await module.healthCheck();
          return [name, health.status] as const;
        } catch {
          return [name, HealthStatusEnum.UNHEALTHY] as const;
        }
      }),
    );

    return Object.fromEntries(results) as Record<string, HealthStatusEnum>;
  }

  /**
   * 주입되지 않은 인프라 의존 서브모듈 이름 목록을 반환한다.
   *
   * @returns 준비되지 않은 서브모듈 키 목록
   */
  private listNotReadyDeps(): string[] {
    const keys: Array<keyof ContractAnalysisModuleDeps> = [
      'riskDetector',
      'comparator',
      'versionManager',
      'simulationEngine',
      'orchestrator',
      'adminService',
    ];
    return keys.filter((key) => this.deps[key] === undefined);
  }

  /**
   * 모듈 이름을 반환한다.
   *
   * 플러그인 레지스트리 등록 시 사용되며, 서비스 접두사를 포함한다.
   */
  getName(): string {
    return `${CONTRACT_SERVICE_PREFIX}_MODULE`;
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 서비스 접두사를 반환한다(요구사항 16.5: 'CONTRACT').
   */
  getServicePrefix(): string {
    return CONTRACT_SERVICE_PREFIX;
  }

  /**
   * 첨부서류 체크리스트 서비스를 반환한다(오케스트레이터 조립 등 외부 재사용).
   */
  getChecklistService(): ChecklistService {
    return this.checklistService;
  }
}

// 인터페이스 re-export (기존 export 보존)
export * from './interfaces/index.js';

// 서브모듈 re-export
export { InfoExtractorModule } from './info-extractor/index.js';
export { RiskEvaluatorModule } from './risk-evaluator/index.js';
export { RiskDetectorModule } from './risk-detector/index.js';
export { RevisionAdvisorModule } from './revision-advisor/index.js';
export { ClauseRecommenderModule } from './clause-recommender/index.js';
export { CitationModule } from './citation/index.js';
export { CaseLinkerModule } from './case-linker/index.js';
export { ComparatorModule } from './comparator/index.js';
export { RegistryMatcherModule } from './registry-matcher/index.js';
export { VersionManagerModule } from './version-manager/index.js';
export { SimulationEngineModule } from './simulation-engine/index.js';
export { ChecklistModule } from './checklist/index.js';
export { ChecklistService } from './checklist/checklist-service.js';
export { AnalysisOrchestrator } from './orchestrator/analysis-orchestrator.js';
