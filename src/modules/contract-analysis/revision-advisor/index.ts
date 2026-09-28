/**
 * 수정제안 생성기 모듈 (RevisionAdvisorModule)
 *
 * 위험 조항에 대한 수정 문안 제안(mode=suggest)과 사용자 문의 조항의 법적
 * 유효성·유불리·주의사항 판단(mode=judge)을 생성하는 표준 `ServiceModule`
 * 구현체이다. 실제 생성 로직은 `SuggestionGenerator`에 위임하며, 본 모듈은
 * 입력 검증·오류 표준화·헬스체크 등 모듈 계약을 담당한다.
 *
 * 주요 규칙:
 *   - Property 19: mode=suggest 결과의 수정 제안 수는 1개 이상 5개 이하.
 *   - Property 20: 근거가 없으면 hasExplicitBasis=false + 일반 주의사항만 제공.
 *   - Property 21: 모든 결과의 disclaimer(면책 고지)는 비어있지 않음.
 *   - Property 22: 부동산 계약 범위 외 문의는 isOutOfScope=true + judgment 미생성.
 *   - 30초 이내 생성(타임아웃), 존댓말 한국어.
 *   - 생성 실패 시 표준 오류를 반환하고 부분 결과를 저장하지 않는다(6.8).
 *
 * LLM 제공자는 `LLM_PROVIDER` 환경 변수(bedrock | gemini | mock)로 교체 가능하다.
 *
 * @module RevisionAdvisorModule
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
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
  RevisionAdvisorInput,
  RevisionAdvisorOutput,
} from '../interfaces/index.js';
import {
  SuggestionGenerator,
  SuggestionInputError,
  SuggestionGenerationError,
  type SuggestionGeneratorConfig,
} from './suggestion-generator.js';

/** 수정제안 생성기 입력 판별자 */
export const REVISION_ADVISOR_INPUT_TYPE = 'revision-advisor.advise';

/** 입력 스키마 불일치 오류 코드 */
export const REVISION_ADVISOR_INVALID_INPUT_CODE =
  'REVISION_ADVISOR_INVALID_INPUT';

/** 수정 제안/조항 판단 생성 실패 오류 코드 */
export const REVISION_ADVISOR_ERROR_CODE = 'REVISION_ADVISOR_FAILED';

/**
 * 수정제안 생성기 모듈 설정
 */
export interface RevisionAdvisorModuleConfig {
  /** 수정 제안 생성기 (선택, 기본 인스턴스 생성) */
  suggestionGenerator?: SuggestionGenerator;
  /** 생성기 세부 설정 (suggestionGenerator 미주입 시 사용) */
  generatorConfig?: SuggestionGeneratorConfig;
}

/**
 * 수정제안 생성기 모듈
 *
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */
export class RevisionAdvisorModule implements ServiceModule {
  private readonly generator: SuggestionGenerator;

  constructor(config: RevisionAdvisorModuleConfig = {}) {
    this.generator =
      config.suggestionGenerator ??
      new SuggestionGenerator(config.generatorConfig ?? {});
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
   * 입력 페이로드를 검증한 뒤 수정 제안 또는 조항 판단을 생성하고, 결과를
   * `ModuleOutput`으로 감싸 반환한다. 스키마 불일치는 스키마 오류로, 생성
   * 실패는 생성 오류로 표준화하며, 어떤 경우에도 부분 결과를 저장하지 않는다.
   *
   * @param input - 모듈 입력 (payload: RevisionAdvisorInput)
   * @returns 모듈 출력
   *
   * @requirements 6.1, 6.2, 6.7, 6.8, 16.8
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateModuleInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const output = await this.generator.generate(validation.payload);
      return { success: true, data: output };
    } catch (error) {
      if (error instanceof SuggestionInputError) {
        return { success: false, errors: [this.buildInvalidInputError(error)] };
      }
      return { success: false, errors: [this.buildGenerationError(error)] };
    }
  }

  /**
   * 수정 제안 또는 조항 판단을 직접 생성한다(모듈 래핑 없이).
   *
   * 다른 컴포넌트(오케스트레이터 등)가 결과 객체를 직접 사용할 수 있도록
   * 제공하는 편의 메서드이다.
   *
   * @param input - 수정제안 생성기 입력
   * @returns 수정제안 생성기 출력
   * @throws SuggestionInputError 입력 스키마 불일치 시
   * @throws SuggestionGenerationError 생성 실패 시
   *
   * @requirements 6.1, 6.2, 6.7, 6.8
   */
  async advise(input: RevisionAdvisorInput): Promise<RevisionAdvisorOutput> {
    return this.generator.generate(input);
  }

  /**
   * 모듈 입력을 검증한다.
   *
   * 입력 유형 판별자와 페이로드 존재 여부를 확인한다. 세부 mode별 필드
   * 검증은 `SuggestionGenerator`가 수행한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateModuleInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: RevisionAdvisorInput }
    | { valid: false; error: ErrorResponse } {
    if (input.type !== REVISION_ADVISOR_INPUT_TYPE) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error(`알 수 없는 입력 유형입니다: ${input.type}`),
        ),
      };
    }
    const payload = input.payload as RevisionAdvisorInput | undefined;
    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        error: this.buildInvalidInputError(new Error('페이로드가 비어있습니다.')),
      };
    }
    return { valid: true, payload };
  }

  /**
   * 스키마 불일치 표준 오류 응답을 만든다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   *
   * @requirements 16.8
   */
  private buildInvalidInputError(error: unknown): ErrorResponse {
    return {
      code: REVISION_ADVISOR_INVALID_INPUT_CODE,
      message:
        '수정 제안/조항 판단 요청 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
      severity: ErrorSeverity.MEDIUM,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 생성 실패 표준 오류 응답을 만든다.
   *
   * 부분 결과는 저장하지 않으며, 사용자에게는 재시도 안내를 제공한다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   *
   * @requirements 6.8
   */
  private buildGenerationError(error: unknown): ErrorResponse {
    const message =
      error instanceof SuggestionGenerationError
        ? error.message
        : '수정 제안/조항 판단 생성 중 오류가 발생했습니다. 다시 시도해 주세요.';
    return {
      code: REVISION_ADVISOR_ERROR_CODE,
      message,
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        retryRequested: true,
        partialResultSaved: false,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 외부 저장소 상태를 별도로 폴링하지 않으므로 정상 상태를 즉시 반환한다.
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
    return 'revision-advisor';
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
  SuggestionGenerator,
  SuggestionInputError,
  SuggestionGenerationError,
  MAX_SUGGESTIONS,
  MIN_SUGGESTIONS,
  MIN_QUERY_LENGTH,
  MAX_QUERY_LENGTH,
  DEFAULT_GENERATION_TIMEOUT_MS,
  DISCLAIMER,
  GENERAL_CAUTION,
} from './suggestion-generator.js';
export type { SuggestionGeneratorConfig } from './suggestion-generator.js';
export {
  createRevisionLlmAdapter,
  resolveRevisionLlmProviderType,
  RevisionBedrockAdapter,
  RevisionGeminiAdapter,
  RevisionMockLlmAdapter,
} from './revision-llm-adapter.js';
export type {
  RevisionLlmAdapter,
  RevisionLlmProviderType,
} from './revision-llm-adapter.js';
