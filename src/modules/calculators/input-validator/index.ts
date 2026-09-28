/**
 * 입력 검증기 모듈 (InputValidatorModule)
 *
 * 계산기 입력 검증을 표준 `ServiceModule` 인터페이스로 노출하는 구현체이다.
 * 실제 검증 로직은 순수 클래스 `InputValidator`에 위임한다.
 *
 * 주요 규칙(요구사항 4.1~4.6):
 *   - 검증 순서: 필수 존재 → 타입 일치 → 음수 아님 → 기준표 상한 이하
 *   - 위반 시 계산을 수행하지 않으며, 위반 항목별 오류와 보존된 입력을 반환
 *   - 통과 시 검증된 입력을 계산기로 전달
 *
 * 입력 페이로드 형식이 스키마에 맞지 않으면 표준 `ErrorResponse`를 반환한다.
 * 성공/검증실패(위반) 모두 `success: true`로 반환하며, 검증 결과(`isValid`)로
 * 위반 여부를 구분한다. 검증 위반은 정상적인 판정 결과이지 실행 오류가 아니다.
 *
 * @module InputValidatorModule
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
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
import type { CalculatorType } from '../interfaces/types.js';
import type {
  RateTableConstraints,
  ValidationInput,
} from '../interfaces/input-validator.js';
import { InputValidator } from './input-validator.js';

/** 입력 검증기 입력 판별자 */
export const INPUT_VALIDATOR_INPUT_TYPE = 'input-validator.validate';

/** 입력 스키마 불일치 오류 코드 */
export const INPUT_VALIDATOR_INVALID_INPUT_CODE = 'INPUT_VALIDATOR_INVALID_INPUT';

/** 허용 계산기 유형 집합 */
const CALCULATOR_TYPES: readonly CalculatorType[] = ['acquisition', 'transfer_tax', 'brokerage'];

/**
 * 입력 검증기 모듈 설정
 */
export interface InputValidatorModuleConfig {
  /** 입력 검증기 (선택, 기본 인스턴스 생성) */
  validator?: InputValidator;
}

/**
 * 입력 검증기 모듈
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
export class InputValidatorModule implements ServiceModule {
  private readonly validator: InputValidator;

  constructor(config: InputValidatorModuleConfig = {}) {
    this.validator = config.validator ?? new InputValidator();
  }

  /**
   * 모듈을 초기화한다. 순수 검증기는 별도 준비가 필요 없어 즉시 완료된다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    // 의존성은 생성자에서 주입되므로 추가 초기화가 필요하지 않다.
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * 입력 페이로드 스키마를 확인한 뒤 검증을 수행하고 결과를 `ModuleOutput`으로
   * 감싸 반환한다. 스키마 자체가 잘못된 경우에만 표준 `ErrorResponse`를 담은
   * 실패 출력을 반환하며, 검증 위반은 성공 출력의 결과(`isValid=false`)로 담는다.
   *
   * @param input - 모듈 입력 (payload: ValidationInput)
   * @returns 모듈 출력 (data: ValidationResult)
   *
   * @requirements 4.1, 4.6
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateSchema(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    const result = this.validator.validate(validation.payload);
    return { success: true, data: result };
  }

  /**
   * 실행 입력의 스키마를 검증한다.
   *
   * 입력 유형 판별자, 계산기 유형, 페이로드 객체, 기준표 제약(상한 수치)의
   * 존재와 형식을 확인한다. 위반 시 표준 오류 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 검증 입력 포함)
   */
  private validateSchema(
    input: ModuleInput,
  ): { valid: true; payload: ValidationInput } | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: INPUT_VALIDATOR_INVALID_INPUT_CODE,
        message: '입력 검증 요청 형식이 올바르지 않습니다. 요청을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== INPUT_VALIDATOR_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }

    const payload = input.payload as Partial<ValidationInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (
      typeof payload.calculatorType !== 'string' ||
      !CALCULATOR_TYPES.includes(payload.calculatorType as CalculatorType)
    ) {
      return invalid('calculatorType이 올바르지 않습니다.');
    }
    if (!payload.payload || typeof payload.payload !== 'object') {
      return invalid('검증 대상 payload가 필요합니다.');
    }
    if (!this.isValidConstraints(payload.rateTableConstraints)) {
      return invalid('rateTableConstraints(maxAmount/maxArea/maxHoldingPeriod)가 필요합니다.');
    }

    return { valid: true, payload: payload as ValidationInput };
  }

  /**
   * 기준표 제약이 필요한 수치 상한을 모두 갖췄는지 확인한다.
   *
   * @param constraints - 검사 대상 제약
   * @returns 유효 여부
   */
  private isValidConstraints(
    constraints: RateTableConstraints | undefined,
  ): constraints is RateTableConstraints {
    if (!constraints || typeof constraints !== 'object') {
      return false;
    }
    return (
      typeof constraints.maxAmount === 'number' &&
      typeof constraints.maxArea === 'number' &&
      typeof constraints.maxHoldingPeriod === 'number'
    );
  }

  /**
   * 모듈 헬스 상태를 반환한다.
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
    return 'calculator-input-validator';
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { InputValidator } from './input-validator.js';
