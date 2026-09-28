/**
 * @fileoverview 부동산 계산기 통합 모듈 진입점 및 모듈 팩토리
 * @description 취득비용·양도소득세·중개수수료 계산기의 공통 타입/인터페이스를 외부로
 * 노출하고, 전체 서브모듈(기준표 관리기·입력 검증기·3개 계산기·계약서 연동 어댑터·
 * AI 자문 보조)을 초기화·의존성 주입하여 표준 `ServiceModule` 인터페이스를 구현하는
 * 팩토리(`CalculatorsModuleFactory`)를 제공한다.
 *
 * 설계 기준은 기존 계약서 분석 모듈 팩토리(`src/modules/contract-analysis/index.ts`)의
 * `ContractAnalysisModuleFactory`와 동일한 패턴을 따른다:
 *   - `ServiceModule`을 구현하여 플러그인 레지스트리(`servicePrefix: 'CALC'`)에 등록한다.
 *   - 계산 경로(취득/양도/중개/검증/기준표/연동)는 외부 의존 없는 결정론적 순수 함수로
 *     동작하므로 별도 격리가 필요 없다.
 *   - AI 자문 보조 채널(`ai-advisor.assist`)만 Circuit Breaker로 감싸, AI 채널 장애가
 *     계산 기능이나 기존 AI 자문 서비스로 전파되지 않도록 격리한다(요구사항 10.5/10.8).
 *   - `healthCheck`에서 각 서브모듈 상태와 AI Circuit Breaker 상태를 함께 점검한다.
 *
 * @module CalculatorsModuleFactory
 * @requirements 9.3 - src/modules/calculators/ 하위 모듈 구성 및 조립
 * @requirements 9.5 - 각 모듈 입력/출력/오류 표준 스키마 준수
 * @requirements 9.6 - 독립 배포/등록 (모듈 등록/발견 메커니즘)
 * @requirements 9.7 - 서비스 등록/발견에 계산기 모듈 등록 (servicePrefix 'CALC')
 */

import {
  HealthStatusEnum,
  ErrorSeverity,
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

import { RateTableModule } from './rate-tables/index.js';
import { RateTableRegistryImpl } from './rate-tables/rate-table-registry.js';
import { InputValidatorModule } from './input-validator/index.js';
import { AcquisitionCostModule, ACQUISITION_INPUT_TYPE } from './acquisition-cost/index.js';
import { TransferTaxModule, TRANSFER_TAX_INPUT_TYPE } from './transfer-tax/index.js';
import { BrokerageFeeModule, BROKERAGE_INPUT_TYPE } from './brokerage-fee/index.js';
import { CalculatorBridgeModule, BRIDGE_INPUT_TYPE } from './calculator-bridge-adapter/index.js';
import {
  AiAdvisorAssistModule,
  AI_ASSIST_INPUT_TYPE,
  AI_ADVISOR_CIRCUIT_BREAKER_CONFIG,
  type AiAdvisorAssistOptions,
} from './ai-advisor-assist/index.js';
import { CalculatorOrchestrator } from './orchestrator/calculator-orchestrator.js';
import { INPUT_VALIDATOR_INPUT_TYPE } from './input-validator/index.js';

/** 계산기 모듈 서비스 접두사 (요구사항 9.7) */
export const CALC_SERVICE_PREFIX = 'CALC';

/**
 * 기준표 조회 입력 판별자.
 *
 * 기준표 관리기 모듈(`RateTableModule`)은 자체 입력 판별자를 노출하지 않고 페이로드를
 * `RateTableRequest`로 처리하므로, 팩토리 라우팅용 판별자를 여기서 정의한다.
 */
export const RATE_TABLE_INPUT_TYPE = 'rate-tables.get';

/**
 * 계산기 모듈 팩토리가 지원하는 실행 작업 유형.
 *
 * `execute` 진입점에서 `ModuleInput.type`으로 사용되며, 각 유형은 대응하는 서브모듈로
 * 위임된다. AI 보조(`ai-advisor.assist`)만 Circuit Breaker로 감싸 격리한다.
 */
export type CalculatorsOperation =
  | typeof ACQUISITION_INPUT_TYPE
  | typeof TRANSFER_TAX_INPUT_TYPE
  | typeof BROKERAGE_INPUT_TYPE
  | typeof INPUT_VALIDATOR_INPUT_TYPE
  | typeof BRIDGE_INPUT_TYPE
  | typeof AI_ASSIST_INPUT_TYPE
  | typeof RATE_TABLE_INPUT_TYPE;

/**
 * 계산기 모듈 팩토리 주입 옵션.
 *
 * 모든 계산 경로가 공유할 기준표 레지스트리와 AI 자문 보조 옵션(제공자·타임아웃 등),
 * AI 채널 격리용 Circuit Breaker 설정을 선택적으로 주입할 수 있다. 미지정 시 기본
 * 구현/기본 설정을 사용한다.
 */
export interface CalculatorsModuleFactoryOptions {
  /** 기준표 레지스트리 (미지정 시 기본 구현, 모든 계산기·어댑터가 공유) */
  registry?: RateTableRegistryImpl;
  /** AI 자문 보조 옵션 (제공자·타임아웃·Circuit Breaker 등) */
  aiAdvisorOptions?: AiAdvisorAssistOptions;
  /** AI 채널 격리용 Circuit Breaker 설정 (미지정 시 AI 보조 기본 설정 사용) */
  aiCircuitBreakerConfig?: CircuitBreakerConfig;
}

/**
 * 부동산 계산기 통합 모듈 팩토리.
 *
 * 전체 서브모듈을 초기화하고 공유 기준표 레지스트리를 주입하며, `ServiceModule`
 * 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다. 계산 경로는 결정론적
 * 순수 함수로 동작하므로 격리가 필요 없고, AI 자문 보조 채널만 Circuit Breaker로 감싸
 * 계산 기능/기존 AI 자문 서비스로 장애가 전파되지 않도록 격리한다.
 *
 * @requirements 9.3, 9.5, 9.6, 9.7
 */
export class CalculatorsModuleFactory implements ServiceModule {
  /** 공유 기준표 레지스트리 (모든 계산기·어댑터에 주입) */
  private readonly registry: RateTableRegistryImpl;

  /** 기준표 관리기 모듈 */
  private readonly rateTable: RateTableModule;
  /** 입력 검증기 모듈 */
  private readonly inputValidator: InputValidatorModule;
  /** 취득비용 계산기 모듈 */
  private readonly acquisitionCost: AcquisitionCostModule;
  /** 양도소득세 계산기 모듈 */
  private readonly transferTax: TransferTaxModule;
  /** 중개수수료 계산기 모듈 */
  private readonly brokerageFee: BrokerageFeeModule;
  /** 계약서 연동 어댑터 모듈 */
  private readonly bridgeAdapter: CalculatorBridgeModule;
  /** AI 자문 보조 모듈 (계산과 분리된 별도 채널) */
  private readonly aiAdvisor: AiAdvisorAssistModule;

  /** 계산·연동·AI 보조 경로를 조율하는 오케스트레이터 (외부 재사용) */
  private readonly orchestrator: CalculatorOrchestrator;

  /** AI 채널 격리용 Circuit Breaker (AI 보조 실행만 감쌈) */
  private readonly aiCircuitBreaker: CircuitBreaker;

  private initialized = false;

  /**
   * 팩토리를 생성하고 전체 서브모듈을 초기화한다.
   *
   * 공유 기준표 레지스트리를 생성/주입하여 모든 계산기·어댑터·오케스트레이터가 동일한
   * 기준표를 사용하도록 하고(중복 로드 방지), AI 자문 보조 채널 격리용 Circuit Breaker를
   * 생성한다.
   *
   * @param options - 팩토리 옵션 (기준표 레지스트리·AI 옵션·AI Circuit Breaker 설정)
   */
  constructor(options: CalculatorsModuleFactoryOptions = {}) {
    this.registry = options.registry ?? new RateTableRegistryImpl();

    // 서브모듈 초기화 및 의존성 주입 (공유 기준표 레지스트리)
    this.rateTable = new RateTableModule(this.registry);
    this.inputValidator = new InputValidatorModule();
    this.acquisitionCost = new AcquisitionCostModule({ registry: this.registry });
    this.transferTax = new TransferTaxModule({ registry: this.registry });
    this.brokerageFee = new BrokerageFeeModule({ registry: this.registry });
    this.bridgeAdapter = new CalculatorBridgeModule({ registry: this.registry });
    this.aiAdvisor = new AiAdvisorAssistModule(options.aiAdvisorOptions ?? {});

    // 오케스트레이터: 계산·연동·AI 보조 경로 조율 (공유 레지스트리 주입)
    this.orchestrator = new CalculatorOrchestrator({
      registry: this.registry,
      ...(options.aiAdvisorOptions
        ? { aiAdvisorOptions: options.aiAdvisorOptions }
        : {}),
    });

    // AI 채널 격리용 Circuit Breaker (AI 보조 실행만 감쌈)
    this.aiCircuitBreaker = new CircuitBreaker(
      options.aiCircuitBreakerConfig ?? AI_ADVISOR_CIRCUIT_BREAKER_CONFIG,
    );
  }

  /**
   * 모듈을 초기화한다.
   *
   * 각 서브모듈의 `initialize`를 호출하여 준비 상태로 전환한다. 서브모듈은 상태 비저장
   * 순수 함수 기반이므로 즉시 완료된다.
   *
   * @param config - 모듈 설정 (각 서브모듈에 전달)
   */
  async initialize(config: ModuleConfig): Promise<void> {
    await Promise.all([
      this.rateTable.initialize(config),
      this.inputValidator.initialize(config),
      this.acquisitionCost.initialize(config),
      this.transferTax.initialize(config),
      this.brokerageFee.initialize(config),
      this.bridgeAdapter.initialize(config),
      this.aiAdvisor.initialize(config),
    ]);
    this.initialized = true;
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * `input.type`으로 작업을 판별하여 대응 서브모듈로 위임한다. 계산 경로(취득/양도/중개/
   * 검증/연동/기준표)는 결정론적 순수 함수이므로 직접 위임하고, AI 자문 보조(`ai-advisor.assist`)
   * 경로만 Circuit Breaker로 감싸 장애를 격리한다. AI 채널이 반복 실패하면 회로가 개방되어
   * 이후 AI 요청을 즉시 거부하지만, 계산 경로에는 영향을 주지 않는다(요구사항 10.5/10.8).
   *
   * @param input - 모듈 입력 (type: CalculatorsOperation)
   * @returns 모듈 출력
   *
   * @requirements 9.5, 10.5
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return this.failure(
        'NOT_INITIALIZED',
        '계산기 모듈이 초기화되지 않았어요.',
        ErrorSeverity.CRITICAL,
      );
    }

    switch (input.type as CalculatorsOperation) {
      case ACQUISITION_INPUT_TYPE:
        return this.acquisitionCost.execute(input);
      case TRANSFER_TAX_INPUT_TYPE:
        return this.transferTax.execute(input);
      case BROKERAGE_INPUT_TYPE:
        return this.brokerageFee.execute(input);
      case INPUT_VALIDATOR_INPUT_TYPE:
        return this.inputValidator.execute(input);
      case BRIDGE_INPUT_TYPE:
        return this.bridgeAdapter.execute(input);
      case RATE_TABLE_INPUT_TYPE:
        return this.rateTable.execute(input);
      case AI_ASSIST_INPUT_TYPE:
        return this.executeAiAssist(input);
      default:
        return this.failure(
          'UNSUPPORTED_OPERATION',
          `지원하지 않는 작업 유형이에요: ${input.type}`,
          ErrorSeverity.MEDIUM,
        );
    }
  }

  /**
   * AI 자문 보조를 Circuit Breaker로 감싸 실행한다.
   *
   * AI 채널의 반복 실패로 회로가 개방된 경우, 계산 결과를 유지하는 표준 안내 응답을
   * 반환하여 장애가 계산 기능이나 기존 AI 자문 서비스로 전파되지 않게 한다. AI 보조기
   * 자체의 실패/타임아웃은 이미 `AiAssistOutput.isAvailable=false`로 표현되므로, 모듈
   * 실행은 성공(success=true)으로 반환된다.
   *
   * @param input - AI 자문 보조 입력
   * @returns 모듈 출력 (AI 응답 또는 일시 불가 안내)
   *
   * @requirements 10.5, 10.8
   */
  private async executeAiAssist(input: ModuleInput): Promise<ModuleOutput> {
    try {
      return await this.aiCircuitBreaker.execute(() => this.aiAdvisor.execute(input));
    } catch {
      // Circuit Breaker 개방 등 AI 채널 장애 — 계산 결과는 이 채널과 무관하게 유지된다.
      return this.failure(
        'AI_ASSIST_UNAVAILABLE',
        'AI 자문 보조를 일시적으로 제공할 수 없어요. 잠시 후 다시 시도해 주세요. 계산 결과는 그대로 유지됩니다.',
        ErrorSeverity.LOW,
        { calculationPreserved: true },
      );
    }
  }

  /**
   * 표준 실패 `ModuleOutput`을 생성한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 대면 메시지 (존댓말 한국어)
   * @param severity - 오류 심각도
   * @param context - 오류 컨텍스트 (선택)
   * @returns 실패 모듈 출력
   */
  private failure(
    code: string,
    message: string,
    severity: ErrorSeverity,
    context?: Record<string, unknown>,
  ): ModuleOutput {
    return {
      success: false,
      errors: [
        {
          code,
          message,
          severity,
          timestamp: new Date().toISOString(),
          ...(context ? { context } : {}),
        },
      ],
    };
  }

  /**
   * 모듈 헬스체크를 수행한다.
   *
   * AI 채널 Circuit Breaker 상태를 반영하되(개방=DEGRADED, AI는 선택 채널이므로 전체를
   * UNHEALTHY로 낮추지 않음), 각 서브모듈의 헬스 상태를 함께 점검한다. 계산 관련 필수
   * 서브모듈(기준표/검증/3개 계산기/어댑터)이 하나라도 UNHEALTHY면 전체 UNHEALTHY로
   * 판정한다.
   *
   * @returns 헬스 상태
   *
   * @requirements 9.6, 9.7
   */
  async healthCheck(): Promise<HealthStatus> {
    const now = new Date().toISOString();
    const aiCircuitState = this.aiCircuitBreaker.getState();

    const submodules = await this.checkSubmodules();

    // AI 보조를 제외한 필수 계산 서브모듈 상태로 전체 판정
    const requiredKeys = [
      'rate-tables',
      'input-validator',
      'acquisition-cost',
      'transfer-tax',
      'brokerage-fee',
      'calculator-bridge-adapter',
    ];
    const anyRequiredUnhealthy = requiredKeys.some(
      (key) => submodules[key] === HealthStatusEnum.UNHEALTHY,
    );

    let status: HealthStatusEnum;
    if (anyRequiredUnhealthy) {
      status = HealthStatusEnum.UNHEALTHY;
    } else if (
      aiCircuitState !== CircuitBreakerState.Closed ||
      submodules['ai-advisor-assist'] === HealthStatusEnum.UNHEALTHY
    ) {
      // AI 채널은 선택이므로 장애 시 전체를 DEGRADED로만 표기한다.
      status = HealthStatusEnum.DEGRADED;
    } else {
      status = HealthStatusEnum.HEALTHY;
    }

    return {
      status,
      lastCheck: now,
      details: {
        initialized: this.initialized,
        servicePrefix: CALC_SERVICE_PREFIX,
        aiCircuitBreaker: aiCircuitState,
        submodules,
      },
    };
  }

  /**
   * 각 서브모듈의 헬스 상태를 병렬로 점검한다.
   *
   * 개별 헬스체크 실패는 UNHEALTHY로 간주하며, 다른 서브모듈 점검에 영향을 주지 않는다.
   *
   * @returns 서브모듈 이름 → 헬스 상태 매핑
   */
  private async checkSubmodules(): Promise<Record<string, HealthStatusEnum>> {
    const entries: Array<[string, ServiceModule]> = [
      ['rate-tables', this.rateTable],
      ['input-validator', this.inputValidator],
      ['acquisition-cost', this.acquisitionCost],
      ['transfer-tax', this.transferTax],
      ['brokerage-fee', this.brokerageFee],
      ['calculator-bridge-adapter', this.bridgeAdapter],
      ['ai-advisor-assist', this.aiAdvisor],
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
   * 모듈 이름을 반환한다.
   *
   * 플러그인 레지스트리 등록 시 사용되며, 서비스 접두사를 포함한다(요구사항 9.7).
   */
  getName(): string {
    return `${CALC_SERVICE_PREFIX}_MODULE`;
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 서비스 접두사를 반환한다(요구사항 9.7: 'CALC').
   */
  getServicePrefix(): string {
    return CALC_SERVICE_PREFIX;
  }

  /**
   * 계산기 오케스트레이터를 반환한다(핸들러/로컬 서버 등 외부 재사용).
   */
  getOrchestrator(): CalculatorOrchestrator {
    return this.orchestrator;
  }
}

// 공통 타입 및 인터페이스 (기존 re-export 보존)
export * from './interfaces/index.js';

// 서브모듈 re-export
export { RateTableModule } from './rate-tables/index.js';
export { RateTableRegistryImpl } from './rate-tables/rate-table-registry.js';
export { InputValidatorModule } from './input-validator/index.js';
export { AcquisitionCostModule } from './acquisition-cost/index.js';
export { TransferTaxModule } from './transfer-tax/index.js';
export { BrokerageFeeModule } from './brokerage-fee/index.js';
export { CalculatorBridgeModule } from './calculator-bridge-adapter/index.js';
export { AiAdvisorAssistModule } from './ai-advisor-assist/index.js';
export { CalculatorOrchestrator } from './orchestrator/calculator-orchestrator.js';
