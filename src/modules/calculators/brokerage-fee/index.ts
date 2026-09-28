/**
 * 중개수수료 계산기 모듈 (BrokerageFeeModule)
 *
 * 표준 `ServiceModule` 인터페이스를 구현하여 중개수수료 계산을 노출하는 모듈이다.
 * 실제 산출은 결정론적 순수 함수 `calculateBrokerageFee`에 위임하며, 모듈은 요청
 * 기준연도(baseYear)에 해당하는 중개수수료 기준표를 기준표 레지스트리에서 조회하여
 * 계산 함수에 주입한다. 이로써 계산 로직은 상수 기준표와 분리된 순수 함수로 유지된다.
 *
 * 입력 페이로드는 `BrokerageFeeInput`이며, 계산 결과(BrokerageFeeResult)를
 * `ModuleOutput.data`에 담아 반환한다. 다음의 경우 표준 `ErrorResponse`를 담은
 * 실패 출력을 반환한다.
 *   - 입력 페이로드 스키마 불일치
 *   - 요청 기준연도 기준표 미존재 (사용 가능 기준연도 안내 포함)
 *   - 조건 요율 미존재 (산출 불가, 입력 보존, 요구사항 3.8)
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
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
import type { BrokerageFeeInput } from '../interfaces/brokerage-fee.js';
import type { BrokerageRateData, RateTable } from '../interfaces/rate-tables.js';
import type { BrokeragePropertyType, TransactionType } from '../interfaces/types.js';
import { RateTableRegistryImpl } from '../rate-tables/rate-table-registry.js';
import {
  BROKERAGE_RATE_NOT_FOUND_CODE,
  calculateBrokerageFee,
} from './brokerage-calculator.js';

/** 중개수수료 계산기 입력 판별자 */
export const BROKERAGE_INPUT_TYPE = 'brokerage.calculate';

/** 중개수수료 계산기 모듈 서비스 이름 */
const MODULE_NAME = 'CALC_BROKERAGE_FEE_MODULE';
/** 중개수수료 계산기 모듈 버전 */
const MODULE_VERSION = '1.0.0';

/** 입력 스키마 불일치 오류 코드 */
export const BROKERAGE_INVALID_INPUT_CODE = 'BROKERAGE_INVALID_INPUT';
/** 기준연도 기준표 미존재 오류 코드 */
export const BROKERAGE_RATE_TABLE_NOT_FOUND_CODE = 'BROKERAGE_RATE_TABLE_NOT_FOUND';

/** 유효 거래 유형 집합 */
const TRANSACTION_TYPES: readonly TransactionType[] = ['sale_exchange', 'lease'];
/** 유효 물건 유형 집합 */
const BROKERAGE_PROPERTY_TYPES: readonly BrokeragePropertyType[] = [
  'house',
  'officetel',
  'other',
];

/**
 * 중개수수료 계산기 모듈 설정.
 */
export interface BrokerageFeeModuleConfig {
  /** 기준표 레지스트리 (미지정 시 기본 구현 사용) */
  registry?: RateTableRegistryImpl;
}

/**
 * 중개수수료 계산기 모듈 클래스.
 *
 * 요청 기준연도의 중개수수료 기준표를 조회하여 순수 계산 함수에 주입하고, 산출 결과를
 * 표준 모듈 출력으로 반환한다. 상태 비저장 결정론적 계산만 수행한다.
 */
export class BrokerageFeeModule implements ServiceModule {
  private readonly registry: RateTableRegistryImpl;
  private initialized = false;

  /**
   * @param config - 모듈 설정 (기준표 레지스트리 주입 가능)
   */
  constructor(config: BrokerageFeeModuleConfig = {}) {
    this.registry = config.registry ?? new RateTableRegistryImpl();
  }

  /**
   * 모듈을 초기화한다. 순수 계산기는 별도 준비가 필요 없어 즉시 완료된다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    this.initialized = true;
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * 입력 스키마를 검증한 뒤 요청 기준연도의 중개수수료 기준표를 조회하고, 결정론적 순수
   * 함수로 중개수수료를 산출한다. 스키마 불일치·기준표 미존재·조건 요율 미존재 시 각각
   * 표준 `ErrorResponse`를 담은 실패 출력을 반환하며 입력값을 보존한다.
   *
   * @param input - 모듈 입력 (payload: BrokerageFeeInput)
   * @returns 모듈 출력 (data: BrokerageFeeResult)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return this.failure(
        'NOT_INITIALIZED',
        '중개수수료 계산기 모듈이 초기화되지 않았습니다.',
        ErrorSeverity.CRITICAL,
      );
    }

    const schema = this.validateSchema(input);
    if (!schema.valid) {
      return { success: false, errors: [schema.error] };
    }

    const payload = schema.payload;

    // 요청 기준연도 중개수수료 기준표 조회
    const rateTable = this.registry.getRateTable('brokerage', payload.baseYear);
    if (!rateTable) {
      const availableYears = this.registry.getAvailableBaseYears('brokerage');
      return this.failure(
        BROKERAGE_RATE_TABLE_NOT_FOUND_CODE,
        `요청하신 기준연도(${payload.baseYear})의 중개수수료 기준표가 존재하지 않습니다. 사용 가능한 기준연도: ${availableYears.join(', ') || '없음'}`,
        ErrorSeverity.LOW,
        {
          requestedBaseYear: payload.baseYear,
          availableBaseYears: availableYears,
          preservedInput: payload as unknown as Record<string, unknown>,
        },
      );
    }

    const rateData = this.extractBrokerageRateData(rateTable);

    // 결정론적 순수 함수로 중개수수료 산출
    const outcome = calculateBrokerageFee(
      payload,
      rateData,
      rateTable.baseYear,
      rateTable.version,
    );

    if (!outcome.ok) {
      // 조건 요율 미존재 등 산출 불가 (요구사항 3.8) — 입력 보존
      return this.failure(
        outcome.code === BROKERAGE_RATE_NOT_FOUND_CODE
          ? BROKERAGE_RATE_NOT_FOUND_CODE
          : outcome.code,
        outcome.message,
        ErrorSeverity.LOW,
        { preservedInput: outcome.preservedInput as unknown as Record<string, unknown> },
      );
    }

    return { success: true, data: outcome.result };
  }

  /**
   * 실행 입력의 스키마를 검증한다.
   *
   * 입력 유형 판별자와 중개수수료 계산 입력의 필수 항목(수치·열거형·불리언)이 기대
   * 형식과 일치하는지 확인한다. 거래 유형별 필수 금액(임대차: 보증금·월세, 매매/교환:
   * 매매가액)의 타입 일치를 함께 확인한다. 위반 시 표준 오류를 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 검증 입력 포함)
   */
  private validateSchema(
    input: ModuleInput,
  ):
    | { valid: true; payload: BrokerageFeeInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: BROKERAGE_INVALID_INPUT_CODE,
        message: '중개수수료 계산 요청 형식이 올바르지 않습니다. 입력 항목을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== BROKERAGE_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }

    const p = input.payload as Partial<BrokerageFeeInput> | undefined;
    if (!p || typeof p !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }

    if (!TRANSACTION_TYPES.includes(p.transactionType as TransactionType)) {
      return invalid('transactionType(거래 유형)이 올바르지 않습니다.');
    }
    if (!BROKERAGE_PROPERTY_TYPES.includes(p.propertyType as BrokeragePropertyType)) {
      return invalid('propertyType(물건 유형)이 올바르지 않습니다.');
    }
    if (typeof p.baseYear !== 'number' || !Number.isInteger(p.baseYear)) {
      return invalid('baseYear(기준연도)는 정수여야 합니다.');
    }

    if (p.transactionType === 'lease') {
      if (typeof p.deposit !== 'number' || Number.isNaN(p.deposit)) {
        return invalid('임대차 거래의 deposit(보증금)은 수치여야 합니다.');
      }
      if (typeof p.monthlyRent !== 'number' || Number.isNaN(p.monthlyRent)) {
        return invalid('임대차 거래의 monthlyRent(월세)는 수치여야 합니다.');
      }
    } else if (p.transactionType === 'sale_exchange') {
      if (typeof p.salePrice !== 'number' || Number.isNaN(p.salePrice)) {
        return invalid('매매/교환 거래의 salePrice(매매가액)는 수치여야 합니다.');
      }
    }

    if (
      p.officetelQualified !== undefined &&
      typeof p.officetelQualified !== 'boolean'
    ) {
      return invalid('officetelQualified(오피스텔 전용 요율 요건)은 불리언이어야 합니다.');
    }

    return { valid: true, payload: p as BrokerageFeeInput };
  }

  /**
   * 기준표에서 중개수수료 기준표 데이터를 추출한다.
   *
   * 레지스트리는 계산기 유형 `brokerage`에 대해 항상 `BrokerageRateData`를
   * 반환하므로 타입 단언으로 좁힌다.
   *
   * @param rateTable - 조회된 기준표
   * @returns 중개수수료 기준표 데이터
   */
  private extractBrokerageRateData(rateTable: RateTable): BrokerageRateData {
    return rateTable.data as BrokerageRateData;
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
   * 중개수수료 기준표가 하나 이상 사용 가능하면 HEALTHY, 전무하면 UNHEALTHY로 판정한다.
   *
   * @returns 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    const availableBaseYears = this.registry.getAvailableBaseYears('brokerage');
    const status =
      availableBaseYears.length > 0
        ? HealthStatusEnum.HEALTHY
        : HealthStatusEnum.UNHEALTHY;

    return {
      status,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: this.initialized,
        availableBaseYears,
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

// 순수 계산 함수 및 관련 심볼 re-export
export {
  BROKERAGE_DISCLAIMER,
  BROKERAGE_NEGOTIABLE_NOTICE,
  BROKERAGE_VAT_NOTICE,
  BROKERAGE_LOCAL_ORDINANCE_NOTICE,
  BROKERAGE_RATE_NOT_FOUND_CODE,
  calculateBrokerageFee,
} from './brokerage-calculator.js';
export type {
  BrokerageCalculationOutcome,
  BrokerageCalculationSuccess,
  BrokerageCalculationFailure,
} from './brokerage-calculator.js';
