/**
 * @fileoverview 세무 자문 시스템 모듈 통합 및 초기화 팩토리
 * @description 모든 세무 서비스 모듈을 초기화하고 플러그인 레지스트리에 등록하며,
 * Circuit Breaker 패턴으로 외부 서비스 호출을 보호하는 통합 모듈이다.
 * 완전히 연동된 TaxOrchestrator 인스턴스를 생성하는 팩토리 함수를 제공한다.
 *
 * 법률 자문 시스템(src/modules/index.ts)과 유사한 구조이나,
 * 세무 전용 모듈(NLP, 검색, 계산기, 응답 생성, 인용, 질문 처리)을 관리한다.
 *
 * @requirements 10.4, 10.5, 10.6, 10.7
 */

import { PluginRegistry } from '../../common/plugin-registry.js';
import { CircuitBreaker, CircuitBreakerConfig } from '../../common/utils/circuit-breaker.js';
import { ModuleConfig } from '../../common/interfaces/service-module.js';
import { TaxNLPModule } from './tax-nlp/index.js';
import { TaxSearchModule } from './tax-search/index.js';
import { TaxCalculatorModule } from './tax-calculator/index.js';
import { TaxResponseGeneratorModule } from './tax-response-generator/index.js';
import { TaxCitationModule } from './tax-citation/index.js';
import { TaxQueryHandlerModule } from './query-handler/index.js';
import { TaxOrchestrator, TaxOrchestratorConfig } from './query-handler/tax-orchestrator.js';
import { TaxInputValidator } from './query-handler/tax-input-validator.js';
import { TaxSessionManager } from './query-handler/tax-session-manager.js';
import { TaxScopeChecker } from './tax-response-generator/tax-scope-checker.js';
import { TaxQueryProcessor } from './tax-search/tax-query-processor.js';

/**
 * 세무 시스템 전체 구성 인터페이스
 */
export interface TaxSystemConfig {
  /** AWS 리전 (기본값: 'ap-northeast-2') */
  region?: string;
  /** DynamoDB 세션 테이블 이름 */
  sessionsTableName?: string;
  /** DynamoDB DataManagement 테이블 이름 */
  dataManagementTableName?: string;
  /** DynamoDB 동의어 테이블 이름 */
  synonymTableName?: string;
  /** OpenSearch Serverless 엔드포인트 */
  openSearchEndpoint?: string;
  /** Bedrock 모델 리전 */
  bedrockRegion?: string;
  /** Bedrock 모델 ID */
  bedrockModelId?: string;
  /** 검색 관련도 임계값 */
  relevanceThreshold?: number;
  /** 오케스트레이터 타임아웃 (밀리초) */
  orchestratorTimeoutMs?: number;
  /** 세법 수집 API 키 */
  taxLawApiKey?: string;
}

/**
 * 세무 모듈별 Circuit Breaker 인스턴스
 */
export interface TaxCircuitBreakers {
  /** 검색 모듈 (OpenSearch + Bedrock Embeddings) */
  search: CircuitBreaker;
  /** 응답 생성 모듈 (Bedrock LLM) */
  responseGenerator: CircuitBreaker;
  /** 세율 계산 모듈 */
  calculator: CircuitBreaker;
}

/**
 * 초기화된 세무 시스템 컨텍스트
 */
export interface InitializedTaxSystem {
  /** 완전히 연동된 TaxOrchestrator */
  orchestrator: TaxOrchestrator;
  /** 플러그인 레지스트리 */
  registry: PluginRegistry;
  /** 모듈별 Circuit Breaker 인스턴스 */
  circuitBreakers: TaxCircuitBreakers;
  /** 개별 모듈 인스턴스 (직접 접근 필요 시) */
  modules: {
    nlp: TaxNLPModule;
    search: TaxSearchModule;
    calculator: TaxCalculatorModule;
    responseGenerator: TaxResponseGeneratorModule;
    citation: TaxCitationModule;
    queryHandler: TaxQueryHandlerModule;
  };
}

/**
 * 검색 모듈 Circuit Breaker 설정
 */
const TAX_SEARCH_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000,
  monitoringWindow: 60000,
};

/**
 * 응답 생성 모듈 Circuit Breaker 설정
 */
const TAX_RESPONSE_GEN_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 60000,
  monitoringWindow: 120000,
};

/**
 * 세율 계산 모듈 Circuit Breaker 설정
 */
const TAX_CALCULATOR_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 15000,
  monitoringWindow: 60000,
};

/**
 * 환경 변수에서 세무 시스템 구성을 로드한다.
 */
export function loadTaxConfigFromEnvironment(): TaxSystemConfig {
  return {
    region: process.env['AWS_REGION'] || 'ap-northeast-2',
    sessionsTableName: process.env['SESSIONS_TABLE'] || 'Sessions',
    dataManagementTableName: process.env['DATA_MANAGEMENT_TABLE'] || 'DataManagement',
    synonymTableName: process.env['SYNONYM_DICTIONARY_TABLE'] || 'SynonymDictionary',
    openSearchEndpoint: process.env['OPENSEARCH_ENDPOINT'] || '',
    bedrockRegion: process.env['BEDROCK_REGION'] || 'us-east-1',
    bedrockModelId: process.env['BEDROCK_MODEL_ID'] || undefined,
    relevanceThreshold: process.env['RELEVANCE_THRESHOLD']
      ? parseFloat(process.env['RELEVANCE_THRESHOLD'])
      : 0.5,
    orchestratorTimeoutMs: process.env['ORCHESTRATOR_TIMEOUT_MS']
      ? parseInt(process.env['ORCHESTRATOR_TIMEOUT_MS'], 10)
      : 30000,
    taxLawApiKey: process.env['TAX_LAW_API_KEY'] || '',
  };
}

/**
 * 세무 모듈별 Circuit Breaker 인스턴스를 생성한다.
 */
export function createTaxCircuitBreakers(): TaxCircuitBreakers {
  return {
    search: new CircuitBreaker(TAX_SEARCH_CB_CONFIG),
    responseGenerator: new CircuitBreaker(TAX_RESPONSE_GEN_CB_CONFIG),
    calculator: new CircuitBreaker(TAX_CALCULATOR_CB_CONFIG),
  };
}

/**
 * 세무 모듈 설정을 생성한다.
 */
function buildTaxModuleConfigs(config: TaxSystemConfig): Record<string, ModuleConfig> {
  const region = config.region || 'ap-northeast-2';

  return {
    search: {
      name: 'tax-search',
      version: '1.0.0',
      enabled: true,
      config: {
        region,
        openSearchEndpoint: config.openSearchEndpoint || '',
        synonymTableName: config.synonymTableName || '',
        relevanceThreshold: config.relevanceThreshold || 0.5,
        maxResultsPerType: 5,
        taxLawIndex: 'tax-laws',
        taxRulingIndex: 'tax-rulings',
      },
    },
    responseGenerator: {
      name: 'tax-response-generator',
      version: '1.0.0',
      enabled: true,
      config: {
        region: config.bedrockRegion || 'us-east-1',
        modelId: config.bedrockModelId,
        timeoutMs: 60000,
        maxTokens: 4096,
        temperature: 0.3,
        minLength: 200,
        maxLength: 5000,
      },
    },
    calculator: {
      name: 'tax-calculator',
      version: '1.0.0',
      enabled: true,
      config: {
        region,
        dataManagementTable: config.dataManagementTableName || 'DataManagement',
      },
    },
    citation: {
      name: 'tax-citation',
      version: '1.0.0',
      enabled: true,
      config: {},
    },
    queryHandler: {
      name: 'tax-query-handler',
      version: '1.0.0',
      enabled: true,
      config: {
        region,
        sessionsTableName: config.sessionsTableName || 'Sessions',
        timeoutMs: config.orchestratorTimeoutMs || 30000,
      },
    },
  };
}

/**
 * ServiceModule의 execute 메서드를 Circuit Breaker로 감싸는 프록시를 생성한다.
 */
function wrapWithCircuitBreaker<T extends { execute: (...args: any[]) => Promise<any> }>(
  module: T,
  circuitBreaker: CircuitBreaker,
): T {
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
 * 완전히 초기화된 세무 자문 시스템을 생성하는 팩토리 함수.
 *
 * 처리 흐름:
 * 1. Circuit Breaker 인스턴스 생성
 * 2. 각 세무 모듈 인스턴스 생성
 * 3. 모듈별 설정으로 초기화
 * 4. 플러그인 레지스트리에 TAX# 접두사로 등록
 * 5. Circuit Breaker로 외부 서비스 호출 보호
 * 6. TaxOrchestrator에 의존 모듈 주입
 *
 * @param systemConfig - 세무 시스템 구성 (선택, 미지정 시 환경 변수에서 로드)
 * @returns 초기화된 세무 시스템 컨텍스트
 */
export async function createInitializedTaxSystem(
  systemConfig?: TaxSystemConfig,
): Promise<InitializedTaxSystem> {
  const config = systemConfig || loadTaxConfigFromEnvironment();

  // 1. Circuit Breaker 생성
  const circuitBreakers = createTaxCircuitBreakers();

  // 2. 모듈 인스턴스 생성
  const nlpModule = new TaxNLPModule();
  const searchModule = new TaxSearchModule();
  const calculatorModule = new TaxCalculatorModule();
  const responseGeneratorModule = new TaxResponseGeneratorModule();
  const citationModule = new TaxCitationModule();
  const queryHandlerModule = new TaxQueryHandlerModule();

  // 3. 모듈 설정 생성 및 초기화
  const moduleConfigs = buildTaxModuleConfigs(config);

  await searchModule.initialize(moduleConfigs['search']);
  await responseGeneratorModule.initialize(moduleConfigs['responseGenerator']);
  await calculatorModule.initialize(moduleConfigs['calculator']);
  await citationModule.initialize(moduleConfigs['citation']);
  await queryHandlerModule.initialize(moduleConfigs['queryHandler']);

  // NLP 모듈 초기화 (별도 메서드)
  await nlpModule.initialize();

  // 4. 플러그인 레지스트리에 등록 (TAX# 접두사로 네임스페이스 분리)
  const registry = PluginRegistry.getInstance();

  const taxModuleNames = [
    'tax-search', 'tax-response-generator', 'tax-calculator',
    'tax-citation', 'tax-query-handler',
  ];
  for (const name of taxModuleNames) {
    registry.deregister(name);
  }

  await registry.register(searchModule, moduleConfigs['search']);
  await registry.register(responseGeneratorModule, moduleConfigs['responseGenerator']);
  await registry.register(calculatorModule, moduleConfigs['calculator']);
  await registry.register(citationModule, moduleConfigs['citation']);
  await registry.register(queryHandlerModule, moduleConfigs['queryHandler']);

  // 5. Circuit Breaker로 보호된 모듈 생성
  const wrappedSearch = wrapWithCircuitBreaker(searchModule, circuitBreakers.search);
  const wrappedResponseGen = wrapWithCircuitBreaker(responseGeneratorModule, circuitBreakers.responseGenerator);
  const wrappedCalculator = wrapWithCircuitBreaker(calculatorModule, circuitBreakers.calculator);

  // 6. TaxOrchestrator 생성 (의존 모듈 주입)
  const orchestratorConfig: TaxOrchestratorConfig = {
    timeoutMs: config.orchestratorTimeoutMs || 30000,
    region: config.region || 'ap-northeast-2',
    sessionsTableName: config.sessionsTableName || 'Sessions',
  };

  const queryProcessor = new TaxQueryProcessor();
  const scopeChecker = new TaxScopeChecker();
  const inputValidator = new TaxInputValidator();
  const sessionManager = new TaxSessionManager(
    config.region || 'ap-northeast-2',
    config.sessionsTableName,
  );

  const orchestrator = new TaxOrchestrator(orchestratorConfig, {
    inputValidator,
    sessionManager,
    scopeChecker,
    queryProcessor,
    searchModule: wrappedSearch as unknown as TaxSearchModule,
    calculatorModule: wrappedCalculator as unknown as TaxCalculatorModule,
    responseGenerator: wrappedResponseGen as unknown as TaxResponseGeneratorModule,
    citationModule,
  });

  return {
    orchestrator,
    registry,
    circuitBreakers,
    modules: {
      nlp: nlpModule,
      search: searchModule,
      calculator: calculatorModule,
      responseGenerator: responseGeneratorModule,
      citation: citationModule,
      queryHandler: queryHandlerModule,
    },
  };
}

/**
 * 완전히 연동된 TaxOrchestrator만 생성하는 간편 팩토리 함수.
 *
 * Lambda 핸들러에서 TaxOrchestrator만 필요할 때 사용한다.
 *
 * @param systemConfig - 세무 시스템 구성 (선택)
 * @returns 초기화된 TaxOrchestrator 인스턴스
 */
export async function createInitializedTaxOrchestrator(
  systemConfig?: TaxSystemConfig,
): Promise<TaxOrchestrator> {
  const system = await createInitializedTaxSystem(systemConfig);
  return system.orchestrator;
}

// Re-exports for convenience
export { TaxOrchestrator } from './query-handler/tax-orchestrator.js';
export { TaxQueryHandlerModule } from './query-handler/index.js';
export { TaxSearchModule } from './tax-search/index.js';
export { TaxCalculatorModule } from './tax-calculator/index.js';
export { TaxResponseGeneratorModule } from './tax-response-generator/index.js';
export { TaxCitationModule } from './tax-citation/index.js';
export { TaxNLPModule } from './tax-nlp/index.js';
