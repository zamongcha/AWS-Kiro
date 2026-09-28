/**
 * 위험도 평가기 모듈 (RiskEvaluatorModule)
 *
 * 위험조항 탐지기가 산출한 위험 조항에 위험도 등급(상/중/하)을 부여하고,
 * 개별 등급으로부터 종합 위험도 등급을 산출하는 표준 `ServiceModule`
 * 구현체이다. 등기부 대조기(태스크 7.2)가 주입한 전세사기 위험 점수
 * (fraudScore)가 있으면 종합 등급 산출에 반영한다.
 *
 * 처리 흐름:
 *   1. `GradeAssigner`로 각 위험 조항에 등급 부여 (미확정 시 "상" 처리)
 *   2. 등기부 대조 결과 기반 전세사기 위험 점수 반영
 *   3. 종합 위험도 등급 산출 (개별 최고 등급 또는 고위험 기준 초과 시 "상")
 *
 * 주요 규칙:
 *   - Property 12: 각 조항 등급은 {high, medium, low} 중 정확히 하나.
 *     미부여/이상값이면 "상"(high) + isGradeUndetermined=true.
 *   - Property 13: 종합 등급 = 개별 등급 최고(상>중>하), 위험 조항 0건이면 "하"(low).
 *   - Property 14: 등급-색상 1:1 매핑(상=red, 중=yellow, 하=green).
 *
 * 전세사기 위험 점수 산출 자체는 등기부 대조기(태스크 7.2)가 담당하며, 본
 * 모듈은 주입된 fraudScore를 입력으로 받아 종합 등급과 출력에 반영하는 역할만
 * 수행한다.
 *
 * @module RiskEvaluatorModule
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.10
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
  RiskEvaluatorInput,
  RiskEvaluatorOutput,
  FraudRiskScore,
  RegistryMatchResult,
} from '../interfaces/index.js';
import { GradeAssigner, type GradeAssignmentInput } from './grade-assigner.js';

/** 위험도 평가기 입력 판별자 */
export const RISK_EVALUATOR_INPUT_TYPE = 'risk-evaluator.evaluate';

/** 입력 스키마 불일치 오류 코드 */
export const RISK_EVALUATION_INVALID_INPUT_CODE = 'RISK_EVALUATION_INVALID_INPUT';

/** 위험도 평가 실패 오류 코드 */
export const RISK_EVALUATION_ERROR_CODE = 'RISK_EVALUATION_FAILED';

/**
 * 위험도 평가기 모듈 설정
 */
export interface RiskEvaluatorModuleConfig {
  /** 등급 부여기 (선택, 기본 인스턴스 생성) */
  gradeAssigner?: GradeAssigner;
}

/**
 * 위험도 평가기 실행 입력 확장.
 *
 * 표준 `RiskEvaluatorInput`을 기반으로 하되, 위험 조항별 사전 산출 등급 정보를
 * 함께 전달할 수 있도록 `GradeAssignmentInput`을 허용한다. 등급 정보가 없으면
 * Property 12에 따라 "상"(high) + 미확정으로 처리한다.
 */
export interface RiskEvaluatorExecuteInput
  extends Omit<RiskEvaluatorInput, 'riskClauses'> {
  /** 등급 부여 대상 위험 조항 목록 (등급 정보 포함 가능) */
  riskClauses: GradeAssignmentInput[];
}

/**
 * 위험도 평가기 모듈
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.10
 */
export class RiskEvaluatorModule implements ServiceModule {
  private readonly gradeAssigner: GradeAssigner;

  constructor(config: RiskEvaluatorModuleConfig = {}) {
    this.gradeAssigner = config.gradeAssigner ?? new GradeAssigner();
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
   * 입력 페이로드를 검증한 뒤 위험도 평가를 수행하고, 결과를 `ModuleOutput`으로
   * 감싸 반환한다. 실패 시 표준 `ErrorResponse`를 담은 실패 출력을 반환하며
   * 입력을 변경하지 않는다.
   *
   * @param input - 모듈 입력 (payload: RiskEvaluatorExecuteInput)
   * @returns 모듈 출력
   *
   * @requirements 4.1, 4.2, 4.3, 4.4
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const output = this.evaluate(validation.payload);
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildError(error)] };
    }
  }

  /**
   * 위험도 평가 핵심 로직.
   *
   * 각 위험 조항에 등급을 부여하고, 등기부 대조 결과(전세사기 위험 점수)를
   * 반영하여 종합 위험도 등급을 산출한다. 등기부 대조 결과가 있으면
   * fraudScore를 출력에 포함한다.
   *
   * @param input - 평가 실행 입력
   * @returns 위험도 평가 결과
   *
   * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.10
   */
  evaluate(input: RiskEvaluatorExecuteInput): RiskEvaluatorOutput {
    const { riskClauses, registryResult } = input;

    // Property 12: 각 조항에 등급 부여 (미확정 시 "상" 처리)
    const gradedClauses = this.gradeAssigner.assignGrades(riskClauses);

    // 등기부 대조 결과 기반 전세사기 위험 점수 도출
    const fraudScore = this.buildFraudScore(registryResult);

    // Property 13: 종합 등급 산출 (등기부 대조 고위험 기준 반영)
    const overallGrade = this.gradeAssigner.computeOverallGrade(
      gradedClauses,
      fraudScore,
    );

    const output: RiskEvaluatorOutput = {
      gradedClauses,
      overallGrade,
    };
    if (fraudScore) {
      output.fraudScore = fraudScore;
    }
    return output;
  }

  /**
   * 등기부 대조 결과로부터 전세사기 위험 점수를 구성한다.
   *
   * 전세사기 위험 점수 산출 로직 자체는 등기부 대조기(태스크 7.2)가 담당하므로,
   * 본 모듈은 대조 결과가 이미 산출한 전세가율·선순위 비율·소유자 불일치 여부를
   * 그대로 반영한다. 대조 결과가 없으면 undefined를 반환한다.
   *
   * exceededCriteria는 등기부 대조기가 판정하는 것이 원칙이나, 대조 결과에 해당
   * 정보가 없을 경우를 대비해 여기서는 결과에 포함된 값만 반영한다.
   *
   * @param registryResult - 등기부 대조 결과 (선택)
   * @returns 전세사기 위험 점수 또는 undefined
   *
   * @requirements 4.3
   */
  private buildFraudScore(
    registryResult?: RegistryMatchResult,
  ): FraudRiskScore | undefined {
    if (!registryResult) {
      return undefined;
    }
    // 등기부 대조기가 산출한 fraudScore가 결과에 포함되어 전달될 수 있다.
    const provided = (
      registryResult as RegistryMatchResult & { fraudScore?: FraudRiskScore }
    ).fraudScore;
    if (provided) {
      return provided;
    }
    // 대조 결과에 별도 fraudScore가 없으면 대조 수치로부터 최소 구성한다.
    return {
      score: 0,
      jeonseRatio: registryResult.jeonseRatio,
      seniorClaimRatio: registryResult.seniorClaimRatio,
      exceededCriteria: [],
      ownerMismatch: registryResult.ownerMismatch,
    };
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 필수 필드(riskClauses 배열)의 존재 및 타입을 확인한다.
   * 위반 시 표준 오류 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: RiskEvaluatorExecuteInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: RISK_EVALUATION_INVALID_INPUT_CODE,
        message: '위험도 평가 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== RISK_EVALUATOR_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<RiskEvaluatorExecuteInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (!Array.isArray(payload.riskClauses)) {
      return invalid('riskClauses 배열이 필요합니다.');
    }

    return { valid: true, payload: payload as RiskEvaluatorExecuteInput };
  }

  /**
   * 평가 실패를 표준 오류 응답으로 변환한다.
   *
   * 어떤 경우에도 입력 데이터는 변경되지 않는다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildError(error: unknown): ErrorResponse {
    return {
      code: RISK_EVALUATION_ERROR_CODE,
      message: '위험도 평가 중 오류가 발생했습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        retryRequested: true,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 위험도 평가기는 외부 저장소 상태를 별도로 폴링하지 않으므로 정상 상태를
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
    return 'risk-evaluator';
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
  GradeAssigner,
  VALID_GRADES,
  GRADE_RANK,
  GRADE_COLOR_MAP,
  FALLBACK_GRADE,
  UNDETERMINED_GRADE_CRITERIA,
} from './grade-assigner.js';
export type { GradeAssignmentInput } from './grade-assigner.js';
