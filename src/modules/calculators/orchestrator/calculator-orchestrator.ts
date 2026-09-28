/**
 * 계산기 오케스트레이터 (CalculatorOrchestrator)
 *
 * 부동산 계산기 통합 시스템의 계산 흐름을 조율하는 상태 비저장 결정론적 오케스트레이터이다.
 * 이미 구현된 하위 구성요소(입력 검증기·기준표 관리기·3개 순수 계산기·계약서 연동 어댑터·
 * AI 자문 보조기)를 조립하여 다음 경로를 제공한다.
 *
 *  1. 계산 경로: 입력 검증 → 기준표 로드 → 계산기(취득/양도/중개) 실행 → 결과 구조화
 *     (요구사항 5.1/5.2/5.3)
 *  2. 계약서 연동 경로: 어댑터 → 계산기 → 출력 스키마 (요구사항 7.1)
 *  3. AI 보조 경로: 계산 경로와 완전히 분리된 별도 호출 채널, AI 장애 격리 (요구사항 10.5)
 *
 * 새 계산 로직을 만들지 않고 기존 순수 함수/모듈을 조립한다. 계산 경로는 결정론적 순수
 * 함수만 사용하며, AI 보조 채널의 장애(실패/타임아웃/Circuit Breaker 개방)는 계산 결과에
 * 절대 전파되지 않는다(별도 진입점 `assist`로 격리, 계산과 상태 공유 없음).
 *
 * 검증 실패·조건(세율/요율) 미존재·기준연도 미존재 시 표준 `ErrorResponse`를 반환하고
 * 원본 입력을 보존한다(요구사항 4.2~4.6, 1.12/2.11/3.8, 6.6).
 *
 * @requirements 5.1 - 계산 결과를 총액·항목별 내역·근거로 구조화하여 반환
 * @requirements 5.2 - 계산 흐름 조율(검증 → 기준표 로드 → 계산 → 결과 구조화)
 * @requirements 5.3 - 결정론적 계산 경로 유지(동일 입력 동일 출력)
 * @requirements 7.1 - 계약서 연동 경로(어댑터 → 계산기 → 출력 스키마) 제공
 * @requirements 10.5 - AI 보조 경로를 계산 경로와 분리 호출하여 장애 격리
 */

import {
  ErrorSeverity,
  type ErrorResponse,
} from '../../../common/interfaces/service-module.js';
import type { CalculatorType } from '../interfaces/types.js';
import type { RateTable } from '../interfaces/rate-tables.js';
import type {
  RateTableConstraints,
  ValidationError,
} from '../interfaces/input-validator.js';
import type { AcquisitionCostInput, AcquisitionCostResult } from '../interfaces/acquisition-cost.js';
import type { TransferTaxInput, TransferTaxResult } from '../interfaces/transfer-tax.js';
import type { BrokerageFeeInput, BrokerageFeeResult } from '../interfaces/brokerage-fee.js';
import type {
  AcquisitionRateData,
  TransferRateData,
  BrokerageRateData,
} from '../interfaces/rate-tables.js';
import type {
  BridgeAdapterResult,
  CalculatorInputSchema,
} from '../interfaces/calculator-bridge.js';
import type { AiAssistInput, AiAssistOutput } from '../interfaces/ai-advisor.js';

import { RateTableRegistryImpl } from '../rate-tables/rate-table-registry.js';
import { InputValidator } from '../input-validator/input-validator.js';
import { calculateAcquisitionCost } from '../acquisition-cost/acquisition-calculator.js';
import { calculateTransferTax } from '../transfer-tax/transfer-tax-calculator.js';
import { calculateBrokerageFee } from '../brokerage-fee/brokerage-calculator.js';
import {
  CalculatorBridgeAdapter,
  type BridgeMappingOptions,
  type BridgeRateTables,
  DEFAULT_BASE_YEAR,
} from '../calculator-bridge-adapter/bridge-adapter.js';
import { AiAdvisorAssist, type AiAdvisorAssistOptions } from '../ai-advisor-assist/ai-advisor.js';

/* ------------------------------------------------------------------ */
/* 오류 코드                                                            */
/* ------------------------------------------------------------------ */

/** 입력 검증 실패 오류 코드 (요구사항 4.2~4.6) */
export const ORCHESTRATOR_VALIDATION_FAILED_CODE = 'CALC_VALIDATION_FAILED';
/** 요청 기준연도 기준표 미존재 오류 코드 (요구사항 6.6) */
export const ORCHESTRATOR_RATE_TABLE_NOT_FOUND_CODE = 'CALC_RATE_TABLE_NOT_FOUND';
/** 조건 세율/요율 미존재 등 산출 불가 오류 코드 (요구사항 1.12/2.11/3.8) */
export const ORCHESTRATOR_CALCULATION_FAILED_CODE = 'CALC_CALCULATION_FAILED';
/** 계약서 연동 필수 항목 누락 오류 코드 (요구사항 7.4) */
export const ORCHESTRATOR_BRIDGE_MISSING_FIELDS_CODE = 'CALC_BRIDGE_MISSING_FIELDS';

/* ------------------------------------------------------------------ */
/* 결과 타입                                                            */
/* ------------------------------------------------------------------ */

/**
 * 오케스트레이션 성공 결과.
 *
 * 계산 결과 봉투(`CalculationResult`)를 담는다.
 */
export interface OrchestrationSuccess<TResult> {
  ok: true;
  /** 구조화된 계산 결과 */
  result: TResult;
}

/**
 * 오케스트레이션 실패 결과.
 *
 * 표준 `ErrorResponse`를 담으며, 검증 실패/조건 미존재/기준연도 미존재 시 원본 입력을
 * 오류 컨텍스트(`preservedInput`)에 보존한다.
 */
export interface OrchestrationFailure {
  ok: false;
  /** 표준 오류 응답 */
  error: ErrorResponse;
}

/**
 * 오케스트레이션 결과(성공 | 실패).
 */
export type OrchestrationResult<TResult> =
  | OrchestrationSuccess<TResult>
  | OrchestrationFailure;

/**
 * 오케스트레이터 옵션.
 */
export interface CalculatorOrchestratorOptions {
  /** 기준표 레지스트리 (미지정 시 기본 구현 사용, 모든 계산 경로가 공유) */
  registry?: RateTableRegistryImpl;
  /** 입력 검증기 (미지정 시 기본 구현 사용) */
  validator?: InputValidator;
  /** 계약서 연동 어댑터 (미지정 시 기본 구현 사용) */
  bridgeAdapter?: CalculatorBridgeAdapter;
  /** AI 자문 보조기 (미지정 시 옵션으로 생성) */
  aiAdvisor?: AiAdvisorAssist;
  /** AI 자문 보조 옵션 (aiAdvisor 미지정 시 사용) */
  aiAdvisorOptions?: AiAdvisorAssistOptions;
}

/**
 * 계산기 오케스트레이터.
 *
 * 하위 구성요소를 조립하여 계산·연동·AI 보조 경로를 제공한다. 계산 경로는 결정론적
 * 순수 함수만 사용하며 상태를 저장하지 않는다. AI 보조 경로는 계산 경로와 분리된 별도
 * 진입점으로만 노출되어 장애가 계산에 전파되지 않는다.
 */
export class CalculatorOrchestrator {
  private readonly registry: RateTableRegistryImpl;
  private readonly validator: InputValidator;
  private readonly bridgeAdapter: CalculatorBridgeAdapter;
  private readonly aiAdvisor: AiAdvisorAssist;

  /**
   * @param options - 오케스트레이터 옵션 (하위 구성요소 주입 가능)
   */
  constructor(options: CalculatorOrchestratorOptions = {}) {
    this.registry = options.registry ?? new RateTableRegistryImpl();
    this.validator = options.validator ?? new InputValidator();
    this.bridgeAdapter = options.bridgeAdapter ?? new CalculatorBridgeAdapter();
    this.aiAdvisor =
      options.aiAdvisor ?? new AiAdvisorAssist(options.aiAdvisorOptions ?? {});
  }

  /* ---------------------------------------------------------------- */
  /* 계산 경로: 검증 → 기준표 로드 → 계산 → 결과 구조화 (요구사항 5.1/5.2/5.3) */
  /* ---------------------------------------------------------------- */

  /**
   * 취득비용을 산출한다(계산 흐름 조율).
   *
   * 입력 검증 → 기준연도 취득세 기준표 로드 → 순수 계산 함수 실행 → 결과 구조화 순으로
   * 처리한다. 검증 실패·기준표 미존재·조건 세율 미존재 시 표준 오류를 반환하며 입력을
   * 보존한다.
   *
   * @param input - 취득비용 계산 입력
   * @returns 성공 시 구조화된 계산 결과, 실패 시 표준 오류
   */
  calculateAcquisition(
    input: AcquisitionCostInput,
  ): OrchestrationResult<AcquisitionCostResult> {
    // 1. 입력 검증 (요구사항 4.x)
    const rateTable = this.loadRateTable('acquisition', input.baseYear);
    const constraints = rateTable?.constraints ?? this.fallbackConstraints();
    const validationError = this.validate('acquisition', input, constraints);
    if (validationError) {
      return validationError;
    }

    // 2. 기준표 로드 (요구사항 6.6)
    if (!rateTable) {
      return this.rateTableNotFound('acquisition', input.baseYear, input);
    }

    // 3. 순수 계산 함수 실행 (요구사항 5.3)
    const outcome = calculateAcquisitionCost(
      input,
      rateTable.data as AcquisitionRateData,
      rateTable.baseYear,
      rateTable.version,
    );

    // 4. 결과 구조화 / 산출 불가 처리 (요구사항 1.12/5.1)
    if (!outcome.ok) {
      return this.calculationFailed(outcome.code, outcome.message, outcome.preservedInput);
    }
    return { ok: true, result: outcome.result };
  }

  /**
   * 양도소득세를 산출한다(계산 흐름 조율).
   *
   * 입력 검증 → 기준연도 양도세 기준표 로드 → 순수 계산 함수 실행 → 결과 구조화 순으로
   * 처리한다. 검증 실패·기준표 미존재·조건 세율 미존재 시 표준 오류를 반환하며 입력을
   * 보존한다.
   *
   * @param input - 양도세 계산 입력
   * @returns 성공 시 구조화된 계산 결과, 실패 시 표준 오류
   */
  calculateTransferTax(
    input: TransferTaxInput,
  ): OrchestrationResult<TransferTaxResult> {
    const rateTable = this.loadRateTable('transfer_tax', input.baseYear);
    const constraints = rateTable?.constraints ?? this.fallbackConstraints();
    const validationError = this.validate('transfer_tax', input, constraints);
    if (validationError) {
      return validationError;
    }

    if (!rateTable) {
      return this.rateTableNotFound('transfer_tax', input.baseYear, input);
    }

    const outcome = calculateTransferTax(
      input,
      rateTable.data as TransferRateData,
      rateTable.baseYear,
      rateTable.version,
    );

    if (!outcome.ok) {
      return this.calculationFailed(outcome.code, outcome.message, outcome.preservedInput);
    }
    return { ok: true, result: outcome.result };
  }

  /**
   * 중개수수료를 산출한다(계산 흐름 조율).
   *
   * 입력 검증 → 기준연도 중개수수료 기준표 로드 → 순수 계산 함수 실행 → 결과 구조화
   * 순으로 처리한다. 검증 실패·기준표 미존재·조건 요율 미존재 시 표준 오류를 반환하며
   * 입력을 보존한다.
   *
   * @param input - 중개수수료 계산 입력
   * @returns 성공 시 구조화된 계산 결과, 실패 시 표준 오류
   */
  calculateBrokerage(
    input: BrokerageFeeInput,
  ): OrchestrationResult<BrokerageFeeResult> {
    const rateTable = this.loadRateTable('brokerage', input.baseYear);
    const constraints = rateTable?.constraints ?? this.fallbackConstraints();
    const validationError = this.validate('brokerage', input, constraints);
    if (validationError) {
      return validationError;
    }

    if (!rateTable) {
      return this.rateTableNotFound('brokerage', input.baseYear, input);
    }

    const outcome = calculateBrokerageFee(
      input,
      rateTable.data as BrokerageRateData,
      rateTable.baseYear,
      rateTable.version,
    );

    if (!outcome.ok) {
      return this.calculationFailed(outcome.code, outcome.message, outcome.preservedInput);
    }
    return { ok: true, result: outcome.result };
  }

  /* ---------------------------------------------------------------- */
  /* 계약서 연동 경로: 어댑터 → 계산기 → 출력 스키마 (요구사항 7.1)         */
  /* ---------------------------------------------------------------- */

  /**
   * 계약서 분석 서비스의 표준 입력 스키마를 소비하여 취득세·중개수수료를 산출한다.
   *
   * 계약서 연동 어댑터에 기준연도 취득세·중개수수료 기준표를 주입하여 매핑·계산을 위임한다
   * (어댑터 → 계산기 → 출력 스키마). 어댑터가 필수 항목 누락을 보고하면 표준 오류로 감싸
   * 반환한다(요구사항 7.4). 계약서 연동 경로는 별도 진입점으로, 사용자 직접 입력 계산
   * 경로와 격리되어 있다(요구사항 7.5).
   *
   * @param schema - 계약서 표준 입력 스키마
   * @param options - 계산 조건 보조 옵션 (기준연도·취득세/중개 조건)
   * @returns 성공 시 어댑터 결과(매핑 입력·출력 스키마), 필수 항목 누락 시 표준 오류
   */
  processFromContract(
    schema: CalculatorInputSchema,
    options: BridgeMappingOptions = {},
  ): OrchestrationResult<BridgeAdapterResult> {
    const baseYear = options.baseYear ?? DEFAULT_BASE_YEAR;

    // 어댑터가 필요로 하는 취득세·중개수수료 기준표를 로드하여 주입한다.
    const acquisitionTable = this.loadRateTable('acquisition', baseYear);
    const brokerageTable = this.loadRateTable('brokerage', baseYear);

    if (!acquisitionTable || !brokerageTable) {
      // 어댑터 계산에 필요한 기준표가 없으면 기준연도 미존재로 안내한다(요구사항 6.6).
      const missingType: CalculatorType = acquisitionTable ? 'brokerage' : 'acquisition';
      return this.rateTableNotFound(missingType, baseYear, schema);
    }

    const rateTables: BridgeRateTables = {
      acquisition: acquisitionTable.data as AcquisitionRateData,
      acquisitionVersion: acquisitionTable.version,
      brokerage: brokerageTable.data as BrokerageRateData,
      brokerageVersion: brokerageTable.version,
    };

    const adapterResult = this.bridgeAdapter.process(schema, rateTables, options);

    // 필수 항목 누락 시 계산 미수행 → 표준 오류로 감싸 반환 (요구사항 7.4)
    if (adapterResult.missingFields.length > 0) {
      return {
        ok: false,
        error: this.buildError(
          ORCHESTRATOR_BRIDGE_MISSING_FIELDS_CODE,
          `계약서 연동 계산에 필요한 필수 항목이 누락되었습니다: ${adapterResult.missingFields.join(', ')}`,
          ErrorSeverity.MEDIUM,
          {
            missingFields: adapterResult.missingFields,
            preservedInput: schema as unknown as Record<string, unknown>,
          },
        ),
      };
    }

    return { ok: true, result: adapterResult };
  }

  /* ---------------------------------------------------------------- */
  /* AI 보조 경로: 계산과 분리된 별도 호출, 장애 격리 (요구사항 10.5)       */
  /* ---------------------------------------------------------------- */

  /**
   * AI 자문 보조 응답을 생성한다(계산 경로와 분리된 별도 호출).
   *
   * 이 메서드는 계산 경로(calculate*)와 상태를 공유하지 않는 독립 채널로, 질문과 계산
   * 컨텍스트를 AI 자문 보조기에 위임한다. AI 호출 실패/타임아웃/Circuit Breaker 개방은
   * `AiAssistOutput.isAvailable=false`로 표현되며 예외를 던지지 않으므로, AI 장애가
   * 이미 확정된 계산 결과에 전파되지 않는다(요구사항 10.5/10.8). 세율·세액을 재계산하지
   * 않고 설명·보완만 수행하며, 계산 결과를 응답에 포함하거나 변경하지 않는다.
   *
   * @param input - AI 자문 보조 입력 (질문 + 계산 컨텍스트)
   * @returns AI 자문 보조 출력 (계산 결과 미포함·불변)
   */
  async assist(input: AiAssistInput): Promise<AiAssistOutput> {
    return this.aiAdvisor.assist(input);
  }

  /* ---------------------------------------------------------------- */
  /* 조회 보조                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 지정 계산기 유형에 사용 가능한 기준연도 목록을 반환한다(요구사항 6.6 안내용).
   *
   * @param type - 계산기 유형
   * @returns 사용 가능 기준연도 목록
   */
  getAvailableBaseYears(type: CalculatorType): number[] {
    return this.registry.getAvailableBaseYears(type);
  }

  /**
   * 지정 계산기 유형·기준연도의 기준표(RateTable)를 조회한다(세율 확인 UI용 조회 전용).
   *
   * 계산 경로와 무관한 읽기 전용 조회이며, 존재하지 않으면 null을 반환한다.
   * 반환값에는 계산기 유형·기준연도·버전과 상수 세율표(data)가 포함된다.
   *
   * @param type - 계산기 유형
   * @param baseYear - 요청 기준연도
   * @returns 기준표, 미존재 시 null
   */
  getRateTable(type: CalculatorType, baseYear: number): RateTable | null {
    return this.registry.getRateTable(type, baseYear);
  }

  /* ---------------------------------------------------------------- */
  /* 내부 보조 함수                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * 지정 계산기 유형·기준연도의 기준표를 로드한다.
   *
   * @param type - 계산기 유형
   * @param baseYear - 요청 기준연도
   * @returns 기준표, 미존재 시 null
   */
  private loadRateTable(type: CalculatorType, baseYear: number): RateTable | null {
    return this.registry.getRateTable(type, baseYear);
  }

  /**
   * 입력 검증을 수행하고, 위반이 있으면 표준 오류를 반환한다(요구사항 4.2~4.6).
   *
   * 검증기는 기준표 제약(상한)을 필요로 하므로, 기준표가 로드되면 그 제약을, 없으면
   * 안전한 기본 상한을 사용한다(기준표 자체 미존재는 이후 단계에서 별도 오류로 안내).
   *
   * @param type - 계산기 유형
   * @param payload - 계산 입력
   * @param constraints - 기준표 제약(상한)
   * @returns 위반 시 표준 오류를 담은 실패 결과, 통과 시 null
   */
  private validate(
    type: CalculatorType,
    payload: object,
    constraints: RateTableConstraints,
  ): OrchestrationFailure | null {
    const validation = this.validator.validate({
      calculatorType: type,
      payload: payload as Record<string, unknown>,
      rateTableConstraints: constraints,
    });

    if (validation.isValid) {
      return null;
    }

    // 위반 시 계산 미수행 + 입력 보존 (요구사항 4.2~4.6)
    return {
      ok: false,
      error: this.buildError(
        ORCHESTRATOR_VALIDATION_FAILED_CODE,
        this.summarizeValidationErrors(validation.errors),
        ErrorSeverity.MEDIUM,
        {
          validationErrors: validation.errors,
          preservedInput: validation.preservedInput,
        },
      ),
    };
  }

  /**
   * 기준연도 기준표 미존재 실패 결과를 생성한다(요구사항 6.6).
   *
   * 사용 가능한 기준연도 목록을 안내하고 원본 입력을 보존한다.
   *
   * @param type - 계산기 유형
   * @param baseYear - 요청 기준연도
   * @param preservedInput - 보존할 원본 입력
   * @returns 표준 오류를 담은 실패 결과
   */
  private rateTableNotFound(
    type: CalculatorType,
    baseYear: number,
    preservedInput: object,
  ): OrchestrationFailure {
    const availableYears = this.registry.getAvailableBaseYears(type);
    return {
      ok: false,
      error: this.buildError(
        ORCHESTRATOR_RATE_TABLE_NOT_FOUND_CODE,
        `요청하신 기준연도(${baseYear})의 ${this.calculatorLabel(type)} 기준표가 존재하지 않습니다. 사용 가능한 기준연도: ${availableYears.join(', ') || '없음'}`,
        ErrorSeverity.LOW,
        {
          calculatorType: type,
          requestedBaseYear: baseYear,
          availableBaseYears: availableYears,
          preservedInput: preservedInput as unknown as Record<string, unknown>,
        },
      ),
    };
  }

  /**
   * 조건 세율/요율 미존재 등 산출 불가 실패 결과를 생성한다(요구사항 1.12/2.11/3.8).
   *
   * 순수 계산 함수가 반환한 오류 코드·메시지를 표준 오류로 감싸고 입력을 보존한다.
   *
   * @param code - 계산 함수 오류 코드
   * @param message - 사용자 안내 메시지
   * @param preservedInput - 보존할 원본 입력
   * @returns 표준 오류를 담은 실패 결과
   */
  private calculationFailed(
    code: string,
    message: string,
    preservedInput: object,
  ): OrchestrationFailure {
    return {
      ok: false,
      error: this.buildError(
        ORCHESTRATOR_CALCULATION_FAILED_CODE,
        message,
        ErrorSeverity.LOW,
        {
          calculationErrorCode: code,
          preservedInput: preservedInput as unknown as Record<string, unknown>,
        },
      ),
    };
  }

  /**
   * 검증 오류 목록을 사용자 안내 메시지로 요약한다.
   *
   * @param errors - 검증 오류 목록
   * @returns 요약 메시지
   */
  private summarizeValidationErrors(errors: ValidationError[]): string {
    const detail = errors.map((e) => `${e.field}(${e.message})`).join(' ');
    return `입력값 검증에 실패했습니다. 입력값은 그대로 보존됩니다. ${detail}`.trim();
  }

  /**
   * 안전한 기본 기준표 제약(상한)을 반환한다.
   *
   * 기준표가 로드되지 않은 경우 검증 단계에서 사용하며, 상한 초과 오탐을 피하도록
   * 충분히 큰 값을 사용한다. 기준표 미존재 자체는 이후 별도 오류로 안내된다.
   *
   * @returns 기본 기준표 제약
   */
  private fallbackConstraints(): RateTableConstraints {
    return {
      maxAmount: Number.MAX_SAFE_INTEGER,
      maxArea: Number.MAX_SAFE_INTEGER,
      maxHoldingPeriod: Number.MAX_SAFE_INTEGER,
    };
  }

  /**
   * 계산기 유형의 한국어 표시명을 반환한다.
   *
   * @param type - 계산기 유형
   * @returns 표시명
   */
  private calculatorLabel(type: CalculatorType): string {
    switch (type) {
      case 'acquisition':
        return '취득세';
      case 'transfer_tax':
        return '양도세';
      case 'brokerage':
        return '중개수수료';
      default:
        return '계산';
    }
  }

  /**
   * 표준 `ErrorResponse`를 생성한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 안내 메시지
   * @param severity - 오류 심각도
   * @param context - 오류 컨텍스트 (보존 입력 등)
   * @returns 표준 오류 응답
   */
  private buildError(
    code: string,
    message: string,
    severity: ErrorSeverity,
    context?: Record<string, unknown>,
  ): ErrorResponse {
    return {
      code,
      message,
      severity,
      timestamp: new Date().toISOString(),
      ...(context ? { context } : {}),
    };
  }
}
