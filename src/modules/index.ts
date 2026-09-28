/**
 * @fileoverview 모듈 통합 및 초기화 팩토리
 * @description 모든 서비스 모듈을 초기화하고 플러그인 레지스트리에 등록하며,
 * Circuit Breaker 패턴으로 외부 서비스 호출을 보호하는 통합 모듈이다.
 * 완전히 연동된 Orchestrator 인스턴스를 생성하는 팩토리 함수를 제공한다.
 *
 * @requirements 8.1 - 전체 시스템 모듈 구조 설정
 * @requirements 8.2 - 플러그인 레지스트리에 모든 모듈 등록
 * @requirements 8.5 - 모듈 동작 상태 모니터링
 * @requirements 8.6 - Circuit Breaker 패턴 적용으로 장애 전파 방지
 */

import { PluginRegistry } from '../common/plugin-registry.js';
import { CircuitBreaker, CircuitBreakerConfig } from '../common/utils/circuit-breaker.js';
import { ModuleConfig } from '../common/interfaces/service-module.js';
import { SearchModule } from './search/index.js';
import { ResponseGeneratorModule } from './response-generator/index.js';
import { CitationModule } from './citation/index.js';
import { QueryHandlerModule } from './query-handler/index.js';
import { LawCollectorModule } from './law-collector/index.js';
import { CaseCollectorModule } from './case-collector/index.js';
import { AdminModule } from './admin/index.js';
import { Orchestrator, OrchestratorConfig } from './query-handler/orchestrator.js';
import { ContractAnalysisModuleFactory } from './contract-analysis/index.js';
import { CalculatorsModuleFactory } from './calculators/index.js';

/**
 * 시스템 전체 구성 인터페이스
 *
 * 모든 모듈 초기화에 필요한 환경 설정을 포함한다.
 */
export interface SystemConfig {
  /** AWS 리전 (기본값: 'ap-northeast-2') */
  region?: string;
  /** DynamoDB 세션 테이블 이름 */
  sessionsTableName?: string;
  /** DynamoDB DataManagement 테이블 이름 */
  dataManagementTableName?: string;
  /** DynamoDB Feedback 테이블 이름 */
  feedbackTableName?: string;
  /** DynamoDB 동의어 테이블 이름 */
  synonymTableName?: string;
  /** OpenSearch Serverless 엔드포인트 */
  openSearchEndpoint?: string;
  /** 법령 수집기 API 키 */
  lawApiKey?: string;
  /** 법령 수집기 API base URL */
  lawApiBaseUrl?: string;
  /** 판례 수집기 API 키 */
  caseApiKey?: string;
  /** 판례 수집기 API base URL */
  caseApiBaseUrl?: string;
  /** Bedrock 모델 리전 (기본값: 'us-east-1') */
  bedrockRegion?: string;
  /** Bedrock 모델 ID */
  bedrockModelId?: string;
  /** 검색 관련도 임계값 */
  relevanceThreshold?: number;
  /** 오케스트레이터 타임아웃 (밀리초) */
  orchestratorTimeoutMs?: number;
}

/**
 * Circuit Breaker 인스턴스 모음
 *
 * 외부 서비스별 Circuit Breaker를 관리한다.
 */
export interface CircuitBreakers {
  /** 검색 모듈 (OpenSearch + Bedrock Embeddings) */
  search: CircuitBreaker;
  /** 응답 생성 모듈 (Bedrock LLM) */
  responseGenerator: CircuitBreaker;
  /** 법령 수집기 (국가법령정보센터 API) */
  lawCollector: CircuitBreaker;
  /** 판례 수집기 (대법원 API) */
  caseCollector: CircuitBreaker;
}

/**
 * 초기화된 시스템 컨텍스트
 *
 * createInitializedSystem() 반환값으로, 모든 초기화된 모듈과
 * Orchestrator, PluginRegistry에 접근할 수 있다.
 */
export interface InitializedSystem {
  /** 완전히 연동된 Orchestrator */
  orchestrator: Orchestrator;
  /** 플러그인 레지스트리 (모든 모듈 등록 완료) */
  registry: PluginRegistry;
  /** 외부 서비스별 Circuit Breaker 인스턴스 */
  circuitBreakers: CircuitBreakers;
  /** 개별 모듈 인스턴스 (직접 접근 필요 시) */
  modules: {
    search: SearchModule;
    responseGenerator: ResponseGeneratorModule;
    citation: CitationModule;
    queryHandler: QueryHandlerModule;
    lawCollector: LawCollectorModule;
    caseCollector: CaseCollectorModule;
    admin: AdminModule;
    /** 계약서 분석 모듈 팩토리 (Circuit Breaker로 오류 격리) */
    contractAnalysis: ContractAnalysisModuleFactory;
    /** 계산기 통합 모듈 팩토리 (AI 채널만 Circuit Breaker로 격리) */
    calculators: CalculatorsModuleFactory;
  };
}

/**
 * 검색 모듈 전용 Circuit Breaker 설정
 *
 * OpenSearch와 Bedrock Embeddings 호출을 보호한다.
 * 검색은 빠른 복구가 중요하므로 타임아웃을 짧게 설정한다.
 */
const SEARCH_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000, // 30초 후 반개방 시도
  monitoringWindow: 60000, // 60초 윈도우
};

/**
 * 응답 생성 모듈 전용 Circuit Breaker 설정
 *
 * Bedrock Claude 3.5 Sonnet 호출을 보호한다.
 * LLM은 응답 시간이 길어 타임아웃을 넉넉하게 설정한다.
 */
const RESPONSE_GENERATOR_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 60000, // 60초 후 반개방 시도
  monitoringWindow: 120000, // 2분 윈도우
};

/**
 * 법령 수집기 전용 Circuit Breaker 설정
 *
 * 국가법령정보센터 API 호출을 보호한다.
 * 배치 수집이므로 넉넉한 복구 시간을 허용한다.
 */
const LAW_COLLECTOR_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 120000, // 2분 후 반개방 시도
  monitoringWindow: 300000, // 5분 윈도우
};

/**
 * 판례 수집기 전용 Circuit Breaker 설정
 *
 * 대법원 종합법률정보 API 호출을 보호한다.
 */
const CASE_COLLECTOR_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 120000, // 2분 후 반개방 시도
  monitoringWindow: 300000, // 5분 윈도우
};

/**
 * 환경 변수에서 시스템 구성을 로드한다.
 *
 * Lambda 실행 환경에서 환경 변수를 읽어 SystemConfig를 구성한다.
 *
 * @returns 환경 변수 기반 시스템 구성
 */
export function loadConfigFromEnvironment(): SystemConfig {
  return {
    region: process.env['AWS_REGION'] || 'ap-northeast-2',
    sessionsTableName: process.env['SESSIONS_TABLE'] || 'Sessions',
    dataManagementTableName: process.env['DATA_MANAGEMENT_TABLE'] || 'DataManagement',
    feedbackTableName: process.env['FEEDBACK_TABLE'] || 'Feedback',
    synonymTableName: process.env['SYNONYM_TABLE'] || 'SynonymDictionary',
    openSearchEndpoint: process.env['OPENSEARCH_ENDPOINT'] || '',
    lawApiKey: process.env['LAW_API_KEY'] || '',
    lawApiBaseUrl: process.env['LAW_API_BASE_URL'] || '',
    caseApiKey: process.env['CASE_API_KEY'] || '',
    caseApiBaseUrl: process.env['CASE_API_BASE_URL'] || '',
    bedrockRegion: process.env['BEDROCK_REGION'] || 'us-east-1',
    bedrockModelId: process.env['BEDROCK_MODEL_ID'] || undefined,
    relevanceThreshold: process.env['RELEVANCE_THRESHOLD']
      ? parseFloat(process.env['RELEVANCE_THRESHOLD'])
      : 0.5,
    orchestratorTimeoutMs: process.env['ORCHESTRATOR_TIMEOUT_MS']
      ? parseInt(process.env['ORCHESTRATOR_TIMEOUT_MS'], 10)
      : 30000,
  };
}

/**
 * Circuit Breaker 인스턴스를 생성한다.
 *
 * 각 외부 서비스별로 독립적인 Circuit Breaker를 생성하여
 * 모듈 간 장애 전파를 방지한다.
 *
 * @returns 서비스별 Circuit Breaker 모음
 */
export function createCircuitBreakers(): CircuitBreakers {
  return {
    search: new CircuitBreaker(SEARCH_CIRCUIT_BREAKER_CONFIG),
    responseGenerator: new CircuitBreaker(RESPONSE_GENERATOR_CIRCUIT_BREAKER_CONFIG),
    lawCollector: new CircuitBreaker(LAW_COLLECTOR_CIRCUIT_BREAKER_CONFIG),
    caseCollector: new CircuitBreaker(CASE_COLLECTOR_CIRCUIT_BREAKER_CONFIG),
  };
}

/**
 * 모듈 설정을 생성한다.
 *
 * SystemConfig를 각 모듈별 ModuleConfig로 변환한다.
 *
 * @param systemConfig - 시스템 전체 구성
 * @returns 모듈별 설정 맵
 */
function buildModuleConfigs(systemConfig: SystemConfig): Record<string, ModuleConfig> {
  const region = systemConfig.region || 'ap-northeast-2';

  return {
    search: {
      name: 'search',
      version: '1.0.0',
      enabled: true,
      config: {
        region,
        openSearchEndpoint: systemConfig.openSearchEndpoint || '',
        synonymTableName: systemConfig.synonymTableName || '',
        relevanceThreshold: systemConfig.relevanceThreshold || 0.5,
        maxResultsPerType: 5,
      },
    },
    responseGenerator: {
      name: 'response-generator',
      version: '1.0.0',
      enabled: true,
      config: {
        region: systemConfig.bedrockRegion || 'us-east-1',
        modelId: systemConfig.bedrockModelId,
        timeoutMs: 60000,
        maxTokens: 4096,
        temperature: 0.3,
        minLength: 200,
        maxLength: 5000,
      },
    },
    citation: {
      name: 'citation-module',
      version: '1.0.0',
      enabled: true,
      config: {},
    },
    queryHandler: {
      name: 'query-handler',
      version: '1.0.0',
      enabled: true,
      config: {
        region,
        sessionsTableName: systemConfig.sessionsTableName || 'Sessions',
      },
    },
    lawCollector: {
      name: 'law-collector',
      version: '1.0.0',
      enabled: true,
      config: {
        apiKey: systemConfig.lawApiKey || '',
        baseUrl: systemConfig.lawApiBaseUrl || undefined,
        timeoutMs: 30000,
      },
    },
    caseCollector: {
      name: 'case-collector',
      version: '1.0.0',
      enabled: true,
      config: {
        apiKey: systemConfig.caseApiKey || '',
        baseUrl: systemConfig.caseApiBaseUrl || undefined,
        timeoutMs: 30000,
      },
    },
    admin: {
      name: 'admin',
      version: '1.0.0',
      enabled: true,
      config: {
        dataManagementTable: systemConfig.dataManagementTableName || 'DataManagement',
        feedbackTable: systemConfig.feedbackTableName || 'Feedback',
        region,
      },
    },
    contractAnalysis: {
      name: 'CONTRACT_MODULE',
      version: '1.0.0',
      enabled: true,
      config: {
        region,
        openSearchEndpoint: systemConfig.openSearchEndpoint || '',
      },
    },
    calculators: {
      name: 'CALC_MODULE',
      version: '1.0.0',
      enabled: true,
      config: {
        region,
      },
    },
  };
}

/**
 * 모든 서비스 모듈을 초기화하고 플러그인 레지스트리에 등록한 뒤,
 * 완전히 연동된 Orchestrator를 반환하는 팩토리 함수이다.
 *
 * 처리 흐름:
 * 1. Circuit Breaker 인스턴스 생성
 * 2. 각 서비스 모듈 인스턴스 생성
 * 3. 모듈별 설정으로 초기화 (initialize)
 * 4. 플러그인 레지스트리에 등록
 * 5. Orchestrator에 의존 모듈 주입
 *
 * @param systemConfig - 시스템 전체 구성 (선택, 미지정 시 환경 변수에서 로드)
 * @returns 초기화된 시스템 컨텍스트
 *
 * @example
 * ```typescript
 * const system = await createInitializedSystem();
 * const result = await system.orchestrator.process({
 *   query: "임대차보호법에서 보증금 반환 기한은?",
 * });
 * ```
 */
export async function createInitializedSystem(
  systemConfig?: SystemConfig,
): Promise<InitializedSystem> {
  const config = systemConfig || loadConfigFromEnvironment();

  // 1. Circuit Breaker 생성
  const circuitBreakers = createCircuitBreakers();

  // 2. 모듈 인스턴스 생성
  const searchModule = new SearchModule();
  const responseGeneratorModule = new ResponseGeneratorModule();
  const citationModule = new CitationModule();
  const queryHandlerModule = new QueryHandlerModule();
  const lawCollectorModule = new LawCollectorModule();
  const caseCollectorModule = new CaseCollectorModule();
  const adminModule = new AdminModule();
  // 계약서 분석 모듈은 자체 Circuit Breaker로 오류를 격리하므로, 인프라 의존
  // 서브모듈 미주입 상태(핵심 인프라 비의존 기능만 활성)로 등록한다.
  const contractAnalysisModule = new ContractAnalysisModuleFactory();
  // 계산기 통합 모듈: 계산 경로는 외부 의존 없는 결정론적 순수 함수이며, AI 자문
  // 보조 채널만 자체 Circuit Breaker로 격리하여 기존 서비스로 장애가 전파되지 않는다.
  const calculatorsModule = new CalculatorsModuleFactory();

  // 3. 모듈 설정 생성 및 초기화
  const moduleConfigs = buildModuleConfigs(config);

  await searchModule.initialize(moduleConfigs['search']);
  await responseGeneratorModule.initialize(moduleConfigs['responseGenerator']);
  await citationModule.initialize(moduleConfigs['citation']);
  await queryHandlerModule.initialize(moduleConfigs['queryHandler']);
  await lawCollectorModule.initialize(moduleConfigs['lawCollector']);
  await caseCollectorModule.initialize(moduleConfigs['caseCollector']);
  await adminModule.initialize(moduleConfigs['admin']);
  await contractAnalysisModule.initialize(moduleConfigs['contractAnalysis']);
  await calculatorsModule.initialize(moduleConfigs['calculators']);

  // 4. 플러그인 레지스트리에 등록
  const registry = PluginRegistry.getInstance();

  // 이미 등록된 모듈이 있으면 해제 후 재등록 (Lambda 재활용 시)
  const moduleNames = [
    'search', 'response-generator', 'citation-module',
    'query-handler', 'law-collector', 'case-collector', 'admin',
    // 계약서 분석 모듈(getName(): 'CONTRACT_MODULE')
    contractAnalysisModule.getName(),
    // 계산기 통합 모듈(getName(): 'CALC_MODULE')
    calculatorsModule.getName(),
  ];
  for (const name of moduleNames) {
    registry.deregister(name);
  }

  await registry.register(searchModule, moduleConfigs['search']);
  await registry.register(responseGeneratorModule, moduleConfigs['responseGenerator']);
  await registry.register(citationModule, moduleConfigs['citation']);
  await registry.register(queryHandlerModule, moduleConfigs['queryHandler']);
  await registry.register(lawCollectorModule, moduleConfigs['lawCollector']);
  await registry.register(caseCollectorModule, moduleConfigs['caseCollector']);
  await registry.register(adminModule, moduleConfigs['admin']);
  // 계약서 분석 모듈 등록 (요구사항 16.5: servicePrefix 'CONTRACT').
  // 자체 Circuit Breaker로 오류를 격리하므로 기존 서비스에 장애가 전파되지 않는다.
  await registry.register(contractAnalysisModule, moduleConfigs['contractAnalysis']);
  // 계산기 통합 모듈 등록 (요구사항 9.7: servicePrefix 'CALC').
  // 계산 경로는 순수 함수이며, AI 자문 보조 채널만 자체 Circuit Breaker로 격리하므로
  // 기존 AI 자문 서비스(법률/세무/판례/계약서)로 장애가 전파되지 않는다.
  await registry.register(calculatorsModule, moduleConfigs['calculators']);

  // 5. Orchestrator 생성 (Circuit Breaker로 보호된 모듈 주입)
  const wrappedSearchModule = wrapModuleWithCircuitBreaker(searchModule, circuitBreakers.search);
  const wrappedResponseGenerator = wrapModuleWithCircuitBreaker(responseGeneratorModule, circuitBreakers.responseGenerator);

  const orchestratorConfig: OrchestratorConfig = {
    timeoutMs: config.orchestratorTimeoutMs || 30000,
    region: config.region || 'ap-northeast-2',
    sessionsTableName: config.sessionsTableName || 'Sessions',
  };

  const orchestrator = new Orchestrator(orchestratorConfig, {
    searchModule: wrappedSearchModule as unknown as SearchModule,
    responseGenerator: wrappedResponseGenerator as unknown as ResponseGeneratorModule,
    citationModule,
  });

  return {
    orchestrator,
    registry,
    circuitBreakers,
    modules: {
      search: searchModule,
      responseGenerator: responseGeneratorModule,
      citation: citationModule,
      queryHandler: queryHandlerModule,
      lawCollector: lawCollectorModule,
      caseCollector: caseCollectorModule,
      admin: adminModule,
      contractAnalysis: contractAnalysisModule,
      calculators: calculatorsModule,
    },
  };
}

/**
 * 완전히 연동된 Orchestrator만 생성하는 간편 팩토리 함수이다.
 *
 * Lambda 핸들러에서 간단히 Orchestrator만 필요할 때 사용한다.
 *
 * @param systemConfig - 시스템 전체 구성 (선택)
 * @returns 초기화된 Orchestrator 인스턴스
 */
export async function createInitializedOrchestrator(
  systemConfig?: SystemConfig,
): Promise<Orchestrator> {
  const system = await createInitializedSystem(systemConfig);
  return system.orchestrator;
}

/**
 * ServiceModule의 execute 메서드를 Circuit Breaker로 감싸는 프록시를 생성한다.
 *
 * Circuit Breaker가 열려 있으면 즉시 에러를 반환하여
 * 장애가 전파되지 않도록 격리한다.
 *
 * @param module - 원본 서비스 모듈
 * @param circuitBreaker - 적용할 Circuit Breaker
 * @returns Circuit Breaker가 적용된 프록시 모듈
 */
function wrapModuleWithCircuitBreaker<T extends { execute: (...args: any[]) => Promise<any> }>(
  module: T,
  circuitBreaker: CircuitBreaker,
): T {
  // Proxy를 사용하여 execute 메서드만 Circuit Breaker로 감싼다
  return new Proxy(module, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return async (...args: any[]) => {
          return circuitBreaker.execute(() => target.execute(...args));
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

/**
 * 법령 수집기를 Circuit Breaker로 보호하여 실행한다.
 *
 * EventBridge 트리거에서 호출 시 Circuit Breaker로 장애를 격리한다.
 *
 * @param lawCollector - 법령 수집 모듈
 * @param circuitBreaker - 적용할 Circuit Breaker
 * @param input - 모듈 입력
 * @returns 수집 결과
 */
export async function executeLawCollectorWithBreaker(
  lawCollector: LawCollectorModule,
  circuitBreaker: CircuitBreaker,
  input: { type: string; payload: unknown },
): Promise<any> {
  return circuitBreaker.execute(() => lawCollector.execute(input));
}

/**
 * 판례 수집기를 Circuit Breaker로 보호하여 실행한다.
 *
 * EventBridge 트리거에서 호출 시 Circuit Breaker로 장애를 격리한다.
 *
 * @param caseCollector - 판례 수집 모듈
 * @param circuitBreaker - 적용할 Circuit Breaker
 * @param input - 모듈 입력
 * @returns 수집 결과
 */
export async function executeCaseCollectorWithBreaker(
  caseCollector: CaseCollectorModule,
  circuitBreaker: CircuitBreaker,
  input: { type: string; payload: unknown },
): Promise<any> {
  return circuitBreaker.execute(() => caseCollector.execute(input));
}
