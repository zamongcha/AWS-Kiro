/**
 * AI 자문 보조 모듈 (AiAdvisorAssistModule)
 *
 * 표준 `ServiceModule` 인터페이스를 구현하여 "AI에게 물어보기" 설명 보조 채널을 노출한다.
 * 실제 처리는 `AiAdvisorAssist`에 위임하며, 이 모듈은 계산 경로와 완전히 분리되어 있다.
 * 세율·세액을 재계산하지 않고 설명·보완만 수행하며, 계산 결과를 응답에 포함하거나
 * 변경하지 않는다. AI 채널 장애는 Circuit Breaker와 30초 타임아웃으로 격리한다.
 *
 * 입력 페이로드는 `AiAssistInput`이며, 응답(AiAssistOutput)을 `ModuleOutput.data`에 담아
 * 반환한다. 입력 스키마가 불일치하면 표준 `ErrorResponse`를 담은 실패 출력을 반환한다.
 * AI 호출 실패/타임아웃은 오류가 아니라 `AiAssistOutput.isAvailable=false`로 표현되므로
 * 모듈 실행 자체는 성공(success=true)으로 반환한다(계산 결과 격리 보장).
 *
 * @requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10
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
  AiAssistInput,
  AiCalculationContext,
} from '../interfaces/ai-advisor.js';
import type { CalculatorType } from '../interfaces/types.js';
import {
  AiAdvisorAssist,
  type AiAdvisorAssistOptions,
} from './ai-advisor.js';

/** AI 자문 보조 입력 판별자 */
export const AI_ASSIST_INPUT_TYPE = 'ai-advisor.assist';

/** AI 자문 보조 모듈 서비스 이름 */
const MODULE_NAME = 'CALC_AI_ADVISOR_ASSIST_MODULE';
/** AI 자문 보조 모듈 버전 */
const MODULE_VERSION = '1.0.0';

/** 입력 스키마 불일치 오류 코드 */
export const AI_ASSIST_INVALID_INPUT_CODE = 'AI_ASSIST_INVALID_INPUT';

/** 유효 계산기 유형 집합 */
const CALCULATOR_TYPES: readonly CalculatorType[] = [
  'acquisition',
  'transfer_tax',
  'brokerage',
];

/**
 * AI 자문 보조 모듈 클래스.
 *
 * 표준 `ServiceModule` 계약을 구현하며, 입력 검증 후 `AiAdvisorAssist`에 위임한다.
 * 계산 경로와 분리된 별도 채널이므로 계산 결과를 산출·변경하지 않는다.
 */
export class AiAdvisorAssistModule implements ServiceModule {
  private readonly advisor: AiAdvisorAssist;
  private initialized = false;

  /**
   * @param options - AI 자문 보조 옵션 (제공자·타임아웃·Circuit Breaker 주입 가능)
   */
  constructor(options: AiAdvisorAssistOptions = {}) {
    this.advisor = new AiAdvisorAssist(options);
  }

  /**
   * 모듈을 초기화한다. 외부 준비가 필요 없어 즉시 완료된다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    this.initialized = true;
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * 입력 스키마를 검증한 뒤 `AiAdvisorAssist`에 위임하여 설명형 응답을 생성한다.
   * AI 호출 실패/타임아웃은 `AiAssistOutput.isAvailable=false`로 표현되며 모듈 실행은
   * 성공으로 반환한다(계산 결과는 이 채널과 무관하게 그대로 유지).
   *
   * @param input - 모듈 입력 (payload: AiAssistInput)
   * @returns 모듈 출력 (data: AiAssistOutput)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return this.failure(
        'NOT_INITIALIZED',
        'AI 자문 보조 모듈이 초기화되지 않았습니다.',
        ErrorSeverity.CRITICAL,
      );
    }

    const schema = this.validateSchema(input);
    if (!schema.valid) {
      return { success: false, errors: [schema.error] };
    }

    const output = await this.advisor.assist(schema.payload);
    return { success: true, data: output };
  }

  /**
   * 실행 입력의 스키마를 검증한다.
   *
   * 입력 유형 판별자와 AI 자문 보조 입력의 필수 항목(계산기 유형·질문·계산 컨텍스트)이
   * 기대 형식과 일치하는지 확인한다. 위반 시 표준 오류를 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 검증 입력 포함)
   */
  private validateSchema(
    input: ModuleInput,
  ):
    | { valid: true; payload: AiAssistInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: AI_ASSIST_INVALID_INPUT_CODE,
        message: 'AI 자문 보조 요청 형식이 올바르지 않습니다. 입력 항목을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== AI_ASSIST_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }

    const p = input.payload as Partial<AiAssistInput> | undefined;
    if (!p || typeof p !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }

    if (!CALCULATOR_TYPES.includes(p.calculatorType as CalculatorType)) {
      return invalid('calculatorType(계산기 유형)이 올바르지 않습니다.');
    }
    if (typeof p.question !== 'string' || p.question.trim().length === 0) {
      return invalid('question(질문)은 비어있지 않은 문자열이어야 합니다.');
    }
    if (!this.isValidContext(p.calculationContext)) {
      return invalid('calculationContext(계산 컨텍스트)가 올바르지 않습니다.');
    }

    return { valid: true, payload: p as AiAssistInput };
  }

  /**
   * 계산 컨텍스트 스키마의 유효성을 검증한다.
   *
   * @param context - 검증 대상 계산 컨텍스트
   * @returns 유효 여부
   */
  private isValidContext(
    context: AiCalculationContext | undefined,
  ): context is AiCalculationContext {
    if (!context || typeof context !== 'object') {
      return false;
    }
    if (!context.inputs || typeof context.inputs !== 'object') {
      return false;
    }
    const result = context.result;
    if (!result || typeof result !== 'object') {
      return false;
    }
    if (typeof result.total !== 'number' || Number.isNaN(result.total)) {
      return false;
    }
    if (!Array.isArray(result.lineItems)) {
      return false;
    }
    if (!result.appliedRates || typeof result.appliedRates !== 'object') {
      return false;
    }
    if (
      result.taxBase !== undefined &&
      (typeof result.taxBase !== 'number' || Number.isNaN(result.taxBase))
    ) {
      return false;
    }
    return true;
  }

  /**
   * 표준 오류 응답을 담은 실패 모듈 출력을 생성한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 안내 메시지
   * @param severity - 오류 심각도
   * @param context - 오류 컨텍스트
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
   * AI 자문 보조는 선택 채널이므로 초기화되었다면 HEALTHY로 판정한다. 실제 AI 호출
   * 가용 여부는 요청 시점의 Circuit Breaker/타임아웃으로 격리 처리된다.
   *
   * @returns 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    return {
      status: this.initialized
        ? HealthStatusEnum.HEALTHY
        : HealthStatusEnum.UNHEALTHY,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: this.initialized,
        channel: 'ai-advisor-assist',
        isolated: true,
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

// AI 자문 보조기 및 관련 심볼 re-export
export {
  AiAdvisorAssist,
  LocalGeminiProvider,
  TaxServiceProvider,
  AI_ADVISOR_DISCLAIMER,
  AI_ADVISOR_OUT_OF_SCOPE_MESSAGE,
  AI_ADVISOR_UNAVAILABLE_MESSAGE,
  AI_ADVISOR_TIMEOUT_MS,
  AI_ADVISOR_SYSTEM_PROMPT,
  AI_ADVISOR_CIRCUIT_BREAKER_CONFIG,
} from './ai-advisor.js';
export type {
  AiAdvisorProvider,
  AiAdvisorProviderType,
  AiAdvisorAssistOptions,
} from './ai-advisor.js';
