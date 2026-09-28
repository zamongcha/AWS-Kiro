/**
 * 시뮬레이션 엔진 모듈 (SimulationEngineModule)
 *
 * 사용자가 입력한 조항 변경안(1~20개)을 원본 계약서와 분리된 가상 계약 상태에
 * 적용하고, 위험조항 탐지기·위험도 평가기를 재실행하여 변경 후 종합 위험도
 * 등급을 산출한 뒤, 변경 전/후 등급을 대조하여 개선/악화/동일을 판정하는 표준
 * `ServiceModule` 구현체이다.
 *
 * 처리 흐름:
 *   1. 입력 검증 (documentId, clauseChanges 배열)
 *   2. `Simulator`로 개수 검증(Property 32) → 가상 상태 구성(Property 33) →
 *      30초 이내 재실행 → 등급 대조(Property 34)
 *   3. 결과를 `SimulationEngineOutput`으로 감싸 반환
 *
 * 주요 규칙:
 *   - Property 32: 변경안이 비어있거나(0개) 20개를 초과하면 입력 오류로
 *     거부하고 시뮬레이션을 수행하지 않는다 (요구사항 13.1, 13.6).
 *   - Property 33: 시뮬레이션은 원본과 분리된 가상 상태에서 수행하며 원본
 *     계약서 데이터를 변경하지 않는다 (요구사항 13.2).
 *   - Property 34: 변경 후 등급이 한 단계 이상 낮아지면 개선, 높아지면 악화,
 *     변화 없으면 동일로 판정한다 (요구사항 13.4, 13.5).
 *
 * 재실행 실패 또는 30초 초과 시 표준 `ErrorResponse`(재시도 요청 포함)를 담은
 * 실패 출력을 반환하며, 원본 계약서 데이터와 사용자가 입력한 변경안을 보존한다
 * (요구사항 13.7).
 *
 * @module SimulationEngineModule
 * @requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
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
import type {
  ClauseChangeRequest,
  SimulationEngineInput,
  SimulationEngineOutput,
} from '../interfaces/index.js';
import {
  Simulator,
  SimulationInputCountError,
  SimulationTimeoutError,
  type SimulatorConfig,
} from './simulator.js';

/** 시뮬레이션 엔진 입력 판별자 */
export const SIMULATION_ENGINE_INPUT_TYPE = 'simulation-engine.simulate';

/** 입력 스키마 불일치 오류 코드 */
export const SIMULATION_INVALID_INPUT_CODE = 'SIMULATION_INVALID_INPUT';

/** 시뮬레이션 입력 개수 오류 코드 (Property 32, 요구사항 13.6) */
export const SIMULATION_INPUT_COUNT_CODE = 'SIMULATION_INPUT_COUNT_EXCEEDED';

/** 시뮬레이션 재실행 타임아웃 오류 코드 (요구사항 13.7) */
export const SIMULATION_TIMEOUT_CODE = 'SIMULATION_TIMEOUT';

/** 시뮬레이션 재실행 실패 오류 코드 (요구사항 13.7) */
export const SIMULATION_ERROR_CODE = 'SIMULATION_FAILED';

/**
 * 시뮬레이션 엔진 모듈 설정.
 *
 * 시뮬레이터를 직접 주입하거나, 시뮬레이터 구성 요소(등급 조회기·재실행기)를
 * 주입하여 내부에서 시뮬레이터를 생성할 수 있다.
 */
export interface SimulationEngineModuleConfig {
  /** 사전 구성된 시뮬레이터 (선택) */
  simulator?: Simulator;
  /** 시뮬레이터 구성 (simulator 미주입 시 사용) */
  simulatorConfig?: SimulatorConfig;
}

/**
 * 시뮬레이션 엔진 모듈
 *
 * @requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
 */
export class SimulationEngineModule implements ServiceModule {
  private readonly simulator: Simulator;

  constructor(config: SimulationEngineModuleConfig) {
    if (config.simulator) {
      this.simulator = config.simulator;
    } else if (config.simulatorConfig) {
      this.simulator = new Simulator(config.simulatorConfig);
    } else {
      throw new Error(
        'SimulationEngineModule은 simulator 또는 simulatorConfig 중 하나가 필요합니다.',
      );
    }
  }

  /**
   * 모듈을 초기화한다. 별도 상태 준비가 필요 없으므로 즉시 완료된다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    // 의존성은 생성자에서 주입되므로 추가 초기화가 필요하지 않다.
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * 입력 페이로드를 검증한 뒤 시뮬레이션을 수행하고, 결과를 `ModuleOutput`으로
   * 감싸 반환한다. 개수 초과·재실행 실패·타임아웃 시 표준 `ErrorResponse`를
   * 담은 실패 출력을 반환하며, 원본 계약서 데이터와 사용자가 입력한 변경안을
   * 변경하지 않는다.
   *
   * @param input - 모듈 입력 (payload: SimulationEngineInput)
   * @returns 모듈 출력
   *
   * @requirements 13.1, 13.2, 13.3, 13.6, 13.7
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const result = await this.simulator.simulate({
        documentId: validation.payload.documentId,
        clauseChanges: validation.payload.clauseChanges,
      });
      const output: SimulationEngineOutput = {
        beforeGrade: result.beforeGrade,
        afterGrade: result.afterGrade,
        comparison: result.comparison,
        changedClauseResults: result.changedClauseResults,
      };
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildError(error)] };
    }
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 필수 필드(documentId 문자열, clauseChanges 배열)의 존재
   * 및 타입을 확인한다. 위반 시 표준 오류 응답을 담은 실패 결과를 반환한다.
   * 변경안 개수 검증(Property 32)은 시뮬레이터가 담당하므로 여기서는 배열 존재
   * 여부만 확인한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: SimulationEngineInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: SIMULATION_INVALID_INPUT_CODE,
        message: '시뮬레이션 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.LOW,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== SIMULATION_ENGINE_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<SimulationEngineInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (typeof payload.documentId !== 'string' || payload.documentId.length === 0) {
      return invalid('documentId가 필요합니다.');
    }
    if (!Array.isArray(payload.clauseChanges)) {
      return invalid('clauseChanges 배열이 필요합니다.');
    }
    if (!this.areValidChangeShapes(payload.clauseChanges)) {
      return invalid('clauseChanges 각 항목은 clauseId와 newText를 포함해야 합니다.');
    }

    return { valid: true, payload: payload as SimulationEngineInput };
  }

  /**
   * 조항 변경안 각 항목이 필수 필드(clauseId, newText 문자열)를 갖는지 확인한다.
   *
   * @param changes - 조항 변경안 목록
   * @returns 모든 항목이 유효한 형태이면 true
   */
  private areValidChangeShapes(
    changes: ClauseChangeRequest[],
  ): boolean {
    return changes.every(
      (change) =>
        change !== null &&
        typeof change === 'object' &&
        typeof change.clauseId === 'string' &&
        typeof change.newText === 'string',
    );
  }

  /**
   * 시뮬레이션 실패를 표준 오류 응답으로 변환한다.
   *
   * 개수 초과(입력 오류)는 심각도 LOW로 사용자 안내에 그치고 재시도를 요청하지
   * 않는다. 타임아웃·재실행 실패는 심각도 HIGH로 분류하고 재시도를 요청하며,
   * 어떤 경우에도 원본 계약서 데이터와 사용자가 입력한 변경안은 변경되지
   * 않는다 (요구사항 13.7).
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   *
   * @requirements 13.6, 13.7
   */
  private buildError(error: unknown): ErrorResponse {
    if (error instanceof SimulationInputCountError) {
      return {
        code: SIMULATION_INPUT_COUNT_CODE,
        message: '변경할 조항은 1개 이상 20개 이하로 입력해 주세요.',
        severity: ErrorSeverity.LOW,
        timestamp: new Date().toISOString(),
        context: {
          retryRequested: false,
          reason: error.message,
        },
      };
    }

    const isTimeout = error instanceof SimulationTimeoutError;
    return {
      code: isTimeout ? SIMULATION_TIMEOUT_CODE : SIMULATION_ERROR_CODE,
      message: isTimeout
        ? '시뮬레이션이 지연되어 완료하지 못했습니다. 다시 시도해 주세요.'
        : '시뮬레이션 중 오류가 발생했습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        retryRequested: true,
        originalPreserved: true,
        changesPreserved: true,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 시뮬레이션 엔진은 외부 저장소 상태를 별도로 폴링하지 않으므로 정상 상태를
   * 즉시 반환한다.
   *
   * @returns 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    return {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * 모듈 이름을 반환한다.
   */
  getName(): string {
    return 'simulation-engine';
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export {
  Simulator,
  SimulationInputCountError,
  SimulationTimeoutError,
  MIN_CLAUSE_CHANGES,
  MAX_CLAUSE_CHANGES,
  SIMULATION_TIMEOUT_MS,
} from './simulator.js';
export type {
  GradeComparison,
  RerunResult,
  SimulationRerunner,
  OriginalGradeProvider,
  SimulationRunInput,
  SimulationRunResult,
  SimulatorConfig,
} from './simulator.js';
