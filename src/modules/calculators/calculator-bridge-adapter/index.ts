/**
 * 계산기 연동 어댑터 모듈 (CalculatorBridgeModule)
 *
 * 표준 `ServiceModule` 인터페이스를 구현하여 계약서 분석 서비스(real-estate-contract-analysis)
 * 연동 경로를 노출하는 모듈이다. 실제 매핑·산출은 결정론적 순수 어댑터
 * `CalculatorBridgeAdapter`에 위임하며, 모듈은 요청 기준연도(baseYear)에 해당하는
 * 취득세·중개수수료 기준표를 기준표 레지스트리에서 조회하여 어댑터에 주입한다.
 *
 * 입력 페이로드는 계약서 표준 입력 스키마(`CalculatorInputSchema`)와 선택 옵션이며,
 * 산출 결과(BridgeAdapterResult)를 `ModuleOutput.data`에 담아 반환한다. 다음의 경우
 * 표준 `ErrorResponse`를 담은 실패 출력을 반환한다.
 *   - 입력 페이로드 스키마 불일치
 *   - 요청 기준연도 기준표 미존재 (사용 가능 기준연도 안내 포함)
 *
 * 계약서 서비스 장애는 이 모듈 경로에 국한되며, 각 계산기 모듈의 사용자 직접 입력 계산
 * 경로에는 영향을 주지 않는다(요구사항 7.5).
 *
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

import {
  ErrorSeverity,
  HealthStatusEnum,
  type ErrorResponse,
  type HealthStatus,
  type ModuleConfig,
  type ModuleInput,
  type ModuleOutput,
  type ServiceModule,
} from '../../../common/interfaces/service-module.js';
import type { CalculatorInputSchema } from '../interfaces/calculator-bridge.js';
import type {
  AcquisitionRateData,
  BrokerageRateData,
  RateTable,
} from '../interfaces/rate-tables.js';
import { RateTableRegistryImpl } from '../rate-tables/rate-table-registry.js';
import {
  CalculatorBridgeAdapter,
  DEFAULT_BASE_YEAR,
  type BridgeMappingOptions,
  type BridgeRateTables,
} from './bridge-adapter.js';

/** 계산기 연동 어댑터 입력 판별자 */
export const BRIDGE_INPUT_TYPE = 'bridge.calculate';

/** 계산기 연동 어댑터 모듈 서비스 이름 */
const MODULE_NAME = 'CALC_BRIDGE_ADAPTER_MODULE';
/** 계산기 연동 어댑터 모듈 버전 */
const MODULE_VERSION = '1.0.0';

/** 입력 스키마 불일치 오류 코드 */
export const BRIDGE_INVALID_INPUT_CODE = 'BRIDGE_INVALID_INPUT';
/** 기준연도 기준표 미존재 오류 코드 */
export const BRIDGE_RATE_TABLE_NOT_FOUND_CODE = 'BRIDGE_RATE_TABLE_NOT_FOUND';

/** 유효 계약 유형 집합 */
const CONTRACT_TYPES: readonly CalculatorInputSchema['contractType'][] = [
  'sale',
  'jeonse',
  'wolse',
  'commercial_lease',
];

/**
 * 계산기 연동 어댑터 모듈 실행 페이로드.
 *
 * 계약서 표준 입력 스키마와 계산 조건 보조 옵션(주택 수·조정지역·기준연도 등)을 담는다.
 */
export interface BridgeModulePayload {
  /** 계약서 표준 입력 스키마 */
  schema: CalculatorInputSchema;
  /** 계산 조건 보조 옵션 (선택) */
  options?: BridgeMappingOptions;
}

/**
 * 계산기 연동 어댑터 모듈 설정.
 */
export interface CalculatorBridgeModuleConfig {
  /** 기준표 레지스트리 (미지정 시 기본 구현 사용) */
  registry?: RateTableRegistryImpl;
}

/**
 * 계산기 연동 어댑터 모듈 클래스.
 *
 * 요청 기준연도의 취득세·중개수수료 기준표를 조회하여 순수 어댑터에 주입하고,
 * 계약서 표준 입력 스키마에 대한 매핑·산출 결과를 표준 모듈 출력으로 반환한다.
 * 상태 비저장 결정론적 처리만 수행한다.
 */
export class CalculatorBridgeModule implements ServiceModule {
  private readonly registry: RateTableRegistryImpl;
  private readonly adapter: CalculatorBridgeAdapter;
  private initialized = false;

  /**
   * @param config - 모듈 설정 (기준표 레지스트리 주입 가능)
   */
  constructor(config: CalculatorBridgeModuleConfig = {}) {
    this.registry = config.registry ?? new RateTableRegistryImpl();
    this.adapter = new CalculatorBridgeAdapter();
  }

  /**
   * 모듈을 초기화한다. 순수 어댑터는 별도 준비가 필요 없어 즉시 완료된다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    this.initialized = true;
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * 입력 스키마를 검증한 뒤 요청 기준연도의 취득세·중개수수료 기준표를 조회하고,
   * 순수 어댑터로 계약서 표준 입력 스키마를 매핑·산출한다. 스키마 불일치·기준표
   * 미존재 시 각각 표준 `ErrorResponse`를 담은 실패 출력을 반환한다. 필수 항목
   * 누락은 어댑터가 `missingFields`로 반환하며, 이는 성공 출력(계산 미수행)으로
   * 전달된다(요구사항 7.4).
   *
   * @param input - 모듈 입력 (payload: BridgeModulePayload)
   * @returns 모듈 출력 (data: BridgeAdapterResult)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return this.failure(
        'NOT_INITIALIZED',
        '계산기 연동 어댑터 모듈이 초기화되지 않았습니다.',
        ErrorSeverity.CRITICAL,
      );
    }

    const schemaCheck = this.validateSchema(input);
    if (!schemaCheck.valid) {
      return { success: false, errors: [schemaCheck.error] };
    }

    const { schema, options } = schemaCheck.payload;
    const baseYear = options?.baseYear ?? DEFAULT_BASE_YEAR;

    // 요청 기준연도의 취득세·중개수수료 기준표 조회
    const acquisitionTable = this.registry.getRateTable('acquisition', baseYear);
    const brokerageTable = this.registry.getRateTable('brokerage', baseYear);
    if (!acquisitionTable || !brokerageTable) {
      const acqYears = this.registry.getAvailableBaseYears('acquisition');
      const brkYears = this.registry.getAvailableBaseYears('brokerage');
      // 취득세·중개수수료 모두 사용 가능한 공통 기준연도 안내
      const commonYears = acqYears.filter((y) => brkYears.includes(y));
      return this.failure(
        BRIDGE_RATE_TABLE_NOT_FOUND_CODE,
        `요청하신 기준연도(${baseYear})의 계산 기준표가 존재하지 않습니다. 사용 가능한 기준연도: ${commonYears.join(', ') || '없음'}`,
        ErrorSeverity.LOW,
        {
          requestedBaseYear: baseYear,
          availableBaseYears: commonYears,
          preservedInput: schema as unknown as Record<string, unknown>,
        },
      );
    }

    const rateTables: BridgeRateTables = {
      acquisition: acquisitionTable.data as AcquisitionRateData,
      acquisitionVersion: acquisitionTable.version,
      brokerage: brokerageTable.data as BrokerageRateData,
      brokerageVersion: brokerageTable.version,
    };

    // 순수 어댑터로 매핑·산출 (계약서 장애는 이 경로에 국한, 요구사항 7.5)
    const result = this.adapter.process(schema, rateTables, {
      ...options,
      baseYear,
    });

    return { success: true, data: result };
  }

  /**
   * 실행 입력의 스키마를 검증한다.
   *
   * 입력 유형 판별자와 계약서 표준 입력 스키마의 필수 형식(계약 유형 열거형, 금액/면적/
   * 기간 항목의 {value, unit} 구조)이 기대 형식과 일치하는지 확인한다. 위반 시 표준
   * 오류를 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 검증 페이로드 포함)
   */
  private validateSchema(
    input: ModuleInput,
  ):
    | { valid: true; payload: BridgeModulePayload }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: BRIDGE_INVALID_INPUT_CODE,
        message: '계약서 연동 계산 요청 형식이 올바르지 않습니다. 입력 항목을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== BRIDGE_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }

    const p = input.payload as Partial<BridgeModulePayload> | undefined;
    if (!p || typeof p !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }

    const schema = p.schema as Partial<CalculatorInputSchema> | undefined;
    if (!schema || typeof schema !== 'object') {
      return invalid('schema(계약서 표준 입력 스키마)가 비어있습니다.');
    }

    if (
      !CONTRACT_TYPES.includes(schema.contractType as CalculatorInputSchema['contractType'])
    ) {
      return invalid('contractType(계약 유형)이 올바르지 않습니다.');
    }

    // 금액/면적/기간 항목은 선택이지만, 존재하면 {value:number} 형식을 만족해야 한다.
    const amountFields: {
      key: keyof CalculatorInputSchema;
      unit: string;
    }[] = [
      { key: 'deposit', unit: 'KRW' },
      { key: 'monthlyRent', unit: 'KRW' },
      { key: 'salePrice', unit: 'KRW' },
      { key: 'managementFee', unit: 'KRW' },
      { key: 'contractPeriod', unit: 'month' },
      { key: 'area', unit: 'sqm' },
    ];
    for (const { key } of amountFields) {
      const field = (schema as Record<string, unknown>)[key];
      if (field === undefined) {
        continue;
      }
      if (
        typeof field !== 'object' ||
        field === null ||
        typeof (field as { value?: unknown }).value !== 'number' ||
        Number.isNaN((field as { value: number }).value)
      ) {
        return invalid(`${key} 항목은 { value: number, unit } 형식이어야 합니다.`);
      }
    }

    return {
      valid: true,
      payload: {
        schema: schema as CalculatorInputSchema,
        ...(p.options ? { options: p.options } : {}),
      },
    };
  }

  /**
   * 표준 오류 응답을 담은 실패 모듈 출력을 생성한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 안내 메시지
   * @param severity - 오류 심각도
   * @param context - 오류 컨텍스트 (보존 입력 등)
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
   * 모듈 헬스 상태를 반환한다.
   *
   * 취득세·중개수수료 기준표가 모두 하나 이상 사용 가능하면 HEALTHY, 하나라도 전무하면
   * UNHEALTHY로 판정한다.
   *
   * @returns 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    const acqYears = this.registry.getAvailableBaseYears('acquisition');
    const brkYears = this.registry.getAvailableBaseYears('brokerage');
    const status =
      acqYears.length > 0 && brkYears.length > 0
        ? HealthStatusEnum.HEALTHY
        : HealthStatusEnum.UNHEALTHY;

    return {
      status,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: this.initialized,
        availableAcquisitionBaseYears: acqYears,
        availableBrokerageBaseYears: brkYears,
      },
    };
  }

  /**
   * 모듈 이름을 반환한다.
   */
  getName(): string {
    return MODULE_NAME;
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return MODULE_VERSION;
  }
}

// 순수 어댑터 및 관련 심볼 re-export
export {
  CalculatorBridgeAdapter,
  DEFAULT_BASE_YEAR,
} from './bridge-adapter.js';
export type {
  BridgeMappingOptions,
  BridgeRateTables,
} from './bridge-adapter.js';
