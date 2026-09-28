/**
 * 양도소득세 계산기 모듈 (TransferTaxModule)
 *
 * 표준 `ServiceModule` 인터페이스를 구현하여 양도소득세 계산을 노출하는 모듈이다.
 * 실제 산출은 결정론적 순수 함수 `calculateTransferTax`에 위임하며, 모듈은 요청
 * 기준연도(baseYear)에 해당하는 양도세 기준표를 기준표 레지스트리에서 조회하여 계산
 * 함수에 주입한다. 이로써 계산 로직은 상수 기준표와 분리된 순수 함수로 유지된다.
 *
 * 입력 페이로드는 `TransferTaxInput`이며, 계산 결과(TransferTaxResult)를
 * `ModuleOutput.data`에 담아 반환한다. 다음의 경우 표준 `ErrorResponse`를 담은
 * 실패 출력을 반환한다.
 *   - 입력 페이로드 스키마 불일치
 *   - 요청 기준연도 기준표 미존재 (사용 가능 기준연도 안내 포함)
 *   - 조건 세율 미존재 (산출 불가, 입력 보존, 요구사항 2.11)
 *
 * @requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11
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
import type { TransferTaxInput } from '../interfaces/transfer-tax.js';
import type { RateTable, TransferRateData } from '../interfaces/rate-tables.js';
import type { HousingCount } from '../interfaces/types.js';
import { RateTableRegistryImpl } from '../rate-tables/rate-table-registry.js';
import {
  TRANSFER_TAX_RATE_NOT_FOUND_CODE,
  calculateTransferTax,
} from './transfer-tax-calculator.js';

/** 양도세 계산기 입력 판별자 */
export const TRANSFER_TAX_INPUT_TYPE = 'transferTax.calculate';

/** 양도세 계산기 모듈 서비스 이름 */
const MODULE_NAME = 'CALC_TRANSFER_TAX_MODULE';
/** 양도세 계산기 모듈 버전 */
const MODULE_VERSION = '1.0.0';

/** 입력 스키마 불일치 오류 코드 */
export const TRANSFER_TAX_INVALID_INPUT_CODE = 'TRANSFER_TAX_INVALID_INPUT';
/** 기준연도 기준표 미존재 오류 코드 */
export const TRANSFER_TAX_RATE_TABLE_NOT_FOUND_CODE =
  'TRANSFER_TAX_RATE_TABLE_NOT_FOUND';

/** 유효 주택 수 집합 */
const HOUSING_COUNTS: readonly HousingCount[] = ['one', 'two', 'three_or_more'];

/**
 * 양도세 계산기 모듈 설정.
 */
export interface TransferTaxModuleConfig {
  /** 기준표 레지스트리 (미지정 시 기본 구현 사용) */
  registry?: RateTableRegistryImpl;
}

/**
 * 양도세 계산기 모듈 클래스.
 *
 * 요청 기준연도의 양도세 기준표를 조회하여 순수 계산 함수에 주입하고, 산출 결과를 표준
 * 모듈 출력으로 반환한다. 상태 비저장 결정론적 계산만 수행한다.
 */
export class TransferTaxModule implements ServiceModule {
  private readonly registry: RateTableRegistryImpl;
  private initialized = false;

  /**
   * @param config - 모듈 설정 (기준표 레지스트리 주입 가능)
   */
  constructor(config: TransferTaxModuleConfig = {}) {
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
   * 입력 스키마를 검증한 뒤 요청 기준연도의 양도세 기준표를 조회하고, 결정론적 순수
   * 함수로 양도소득세를 산출한다. 스키마 불일치·기준표 미존재·조건 세율 미존재 시 각각
   * 표준 `ErrorResponse`를 담은 실패 출력을 반환하며 입력값을 보존한다.
   *
   * @param input - 모듈 입력 (payload: TransferTaxInput)
   * @returns 모듈 출력 (data: TransferTaxResult)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return this.failure(
        'NOT_INITIALIZED',
        '양도세 계산기 모듈이 초기화되지 않았습니다.',
        ErrorSeverity.CRITICAL,
      );
    }

    const schema = this.validateSchema(input);
    if (!schema.valid) {
      return { success: false, errors: [schema.error] };
    }

    const payload = schema.payload;

    // 요청 기준연도 양도세 기준표 조회
    const rateTable = this.registry.getRateTable('transfer_tax', payload.baseYear);
    if (!rateTable) {
      const availableYears = this.registry.getAvailableBaseYears('transfer_tax');
      return this.failure(
        TRANSFER_TAX_RATE_TABLE_NOT_FOUND_CODE,
        `요청하신 기준연도(${payload.baseYear})의 양도세 기준표가 존재하지 않습니다. 사용 가능한 기준연도: ${availableYears.join(', ') || '없음'}`,
        ErrorSeverity.LOW,
        {
          requestedBaseYear: payload.baseYear,
          availableBaseYears: availableYears,
          preservedInput: payload as unknown as Record<string, unknown>,
        },
      );
    }

    const rateData = this.extractTransferRateData(rateTable);

    // 결정론적 순수 함수로 양도세 산출
    const outcome = calculateTransferTax(
      payload,
      rateData,
      rateTable.baseYear,
      rateTable.version,
    );

    if (!outcome.ok) {
      // 조건 세율 미존재 등 산출 불가 (요구사항 2.11) — 입력 보존
      return this.failure(
        outcome.code === TRANSFER_TAX_RATE_NOT_FOUND_CODE
          ? TRANSFER_TAX_RATE_NOT_FOUND_CODE
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
   * 입력 유형 판별자와 양도세 계산 입력의 필수 항목(수치·열거형·불리언)이 기대 형식과
   * 일치하는지 확인한다. 위반 시 표준 오류를 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 검증 입력 포함)
   */
  private validateSchema(
    input: ModuleInput,
  ):
    | { valid: true; payload: TransferTaxInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: TRANSFER_TAX_INVALID_INPUT_CODE,
        message: '양도세 계산 요청 형식이 올바르지 않습니다. 입력 항목을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== TRANSFER_TAX_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }

    const p = input.payload as Partial<TransferTaxInput> | undefined;
    if (!p || typeof p !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }

    if (typeof p.transferPrice !== 'number' || Number.isNaN(p.transferPrice)) {
      return invalid('transferPrice(양도가액)는 수치여야 합니다.');
    }
    if (typeof p.acquisitionPrice !== 'number' || Number.isNaN(p.acquisitionPrice)) {
      return invalid('acquisitionPrice(취득가액)는 수치여야 합니다.');
    }
    if (typeof p.necessaryExpense !== 'number' || Number.isNaN(p.necessaryExpense)) {
      return invalid('necessaryExpense(필요경비)는 수치여야 합니다.');
    }
    if (typeof p.holdingPeriod !== 'number' || Number.isNaN(p.holdingPeriod)) {
      return invalid('holdingPeriod(보유기간)는 수치여야 합니다.');
    }
    if (typeof p.residencePeriod !== 'number' || Number.isNaN(p.residencePeriod)) {
      return invalid('residencePeriod(거주기간)는 수치여야 합니다.');
    }
    if (typeof p.isSingleHouseholdOneHouse !== 'boolean') {
      return invalid('isSingleHouseholdOneHouse(1세대1주택 여부)는 불리언이어야 합니다.');
    }
    if (!HOUSING_COUNTS.includes(p.housingCount as HousingCount)) {
      return invalid('housingCount(주택 수)가 올바르지 않습니다.');
    }
    if (typeof p.isAdjustmentArea !== 'boolean') {
      return invalid('isAdjustmentArea(조정대상지역 여부)는 불리언이어야 합니다.');
    }
    if (typeof p.baseYear !== 'number' || !Number.isInteger(p.baseYear)) {
      return invalid('baseYear(기준연도)는 정수여야 합니다.');
    }

    return { valid: true, payload: p as TransferTaxInput };
  }

  /**
   * 기준표에서 양도세 기준표 데이터를 추출한다.
   *
   * 레지스트리는 계산기 유형 `transfer_tax`에 대해 항상 `TransferRateData`를
   * 반환하므로 타입 단언으로 좁힌다.
   *
   * @param rateTable - 조회된 기준표
   * @returns 양도세 기준표 데이터
   */
  private extractTransferRateData(rateTable: RateTable): TransferRateData {
    return rateTable.data as TransferRateData;
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
   * 양도세 기준표가 하나 이상 사용 가능하면 HEALTHY, 전무하면 UNHEALTHY로 판정한다.
   *
   * @returns 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    const availableBaseYears = this.registry.getAvailableBaseYears('transfer_tax');
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
  TRANSFER_TAX_DISCLAIMER,
  TRANSFER_TAX_RATE_NOT_FOUND_CODE,
  calculateTransferTax,
} from './transfer-tax-calculator.js';
export type {
  TransferTaxCalculationOutcome,
  TransferTaxCalculationSuccess,
  TransferTaxCalculationFailure,
} from './transfer-tax-calculator.js';
