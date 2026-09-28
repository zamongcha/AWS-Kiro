/**
 * 비교 분석기 모듈 (ComparatorModule)
 *
 * 확정된 계약 유형에 대응하는 표준계약서를 표준계약서_저장소에서 로드하고,
 * 업로드 계약서와 조항 단위로 대조하여 누락/변경/추가를 식별하는 표준
 * `ServiceModule` 구현체이다. 표준양식 로드는 `StandardFormLoader`,
 * 조항 대조는 `ClauseComparator`에 위임하며, 본 모듈은 입력 검증·오류
 * 표준화·헬스체크 등 모듈 계약을 담당한다.
 *
 * 주요 규칙:
 *   - 표준양식이 없으면 standardFormExists=false + 비교 생략 안내(요구사항 8.5).
 *   - 표준양식 로드 5초 타임아웃/실패 시 오류 반환, 업로드 데이터 보존(요구사항 8.1, 8.6).
 *   - Property 25: 차이유형은 누락/변경/추가 중 정확히 하나.
 *
 * @module ComparatorModule
 * @requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
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
  ComparatorInput,
  ComparatorOutput,
} from '../interfaces/comparator.js';
import type { ContractType } from '../interfaces/index.js';
import { ClauseComparator } from './clause-comparator.js';
import { StandardFormLoader } from './standard-form-loader.js';

/** 비교 분석기 입력 판별자 */
export const COMPARATOR_INPUT_TYPE = 'comparator.compare';

/** 입력 스키마 불일치 오류 코드 */
export const COMPARATOR_INVALID_INPUT_CODE = 'COMPARATOR_INVALID_INPUT';

/** 표준양식 로드 실패 오류 코드 */
export const COMPARATOR_LOAD_FAILED_CODE = 'COMPARATOR_LOAD_FAILED';

/** 비교 처리 실패 오류 코드 */
export const COMPARATOR_ERROR_CODE = 'COMPARATOR_FAILED';

/** 허용 계약 유형 집합 (입력 검증용) */
const VALID_CONTRACT_TYPES: ReadonlySet<ContractType> = new Set<ContractType>([
  'sale',
  'jeonse',
  'wolse',
  'commercial_lease',
]);

/**
 * 비교 분석기 모듈 설정
 */
export interface ComparatorModuleConfig {
  /** 표준계약서 로더 (필수) */
  standardFormLoader: StandardFormLoader;
  /** 조항 비교기 (선택, 기본 인스턴스 생성) */
  clauseComparator?: ClauseComparator;
}

/**
 * 비교 분석기 모듈
 *
 * @requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
export class ComparatorModule implements ServiceModule {
  private readonly loader: StandardFormLoader;
  private readonly comparator: ClauseComparator;

  constructor(config: ComparatorModuleConfig) {
    this.loader = config.standardFormLoader;
    this.comparator = config.clauseComparator ?? new ClauseComparator();
  }

  /**
   * 모듈을 초기화한다. 의존성은 생성자에서 주입되므로 즉시 완료된다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    // 추가 초기화가 필요하지 않다.
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * 입력 페이로드를 검증한 뒤 표준양식을 로드하고 조항 대조를 수행한다.
   * 스키마 불일치는 스키마 오류로, 로드 실패는 로드 오류로, 그 외 처리
   * 실패는 처리 오류로 표준화한다.
   *
   * @param input - 모듈 입력 (payload: ComparatorInput)
   * @returns 모듈 출력
   *
   * @requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateModuleInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const output = await this.compare(validation.payload);
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildProcessingError(error)] };
    }
  }

  /**
   * 표준계약서를 로드하여 업로드 계약서와 조항 단위로 대조한다(모듈 래핑 없이).
   *
   * 표준양식이 없으면 비교를 생략하고 안내 메시지와 함께
   * standardFormExists=false 결과를 반환한다. 표준양식 로드가 실패하면
   * 오류를 던진다(업로드 데이터는 변경하지 않는다).
   *
   * @param payload - 비교 분석기 입력
   * @returns 비교 분석기 출력
   * @throws 표준양식 로드 실패 시 오류
   *
   * @requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
   */
  async compare(payload: ComparatorInput): Promise<ComparatorOutput> {
    const loadResult = await this.loader.load(payload.contractType);

    // 로드 자체가 실패한 경우: 오류로 처리 (업로드 데이터는 변경하지 않음)
    if (!loadResult.success) {
      throw new Error(
        loadResult.errorReason ?? '표준계약서 로드에 실패했습니다.',
      );
    }

    // 표준양식이 존재하지 않는 경우: 비교 생략 안내
    if (!loadResult.exists) {
      return {
        comparisons: [],
        standardFormExists: false,
      };
    }

    // 표준양식 존재: 조항 단위 대조 수행
    return this.comparator.compare(
      loadResult.clauses,
      payload.uploadedClauses,
      loadResult.version,
    );
  }

  /**
   * 모듈 입력을 검증한다.
   *
   * 입력 유형 판별자, 페이로드 존재 여부, 계약 유형 유효성,
   * 업로드 조항 배열 형식을 확인한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateModuleInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: ComparatorInput }
    | { valid: false; error: ErrorResponse } {
    if (input.type !== COMPARATOR_INPUT_TYPE) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error(`알 수 없는 입력 유형입니다: ${input.type}`),
        ),
      };
    }
    const payload = input.payload as ComparatorInput | undefined;
    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error('페이로드가 비어있습니다.'),
        ),
      };
    }
    if (!VALID_CONTRACT_TYPES.has(payload.contractType)) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error(`유효하지 않은 계약 유형입니다: ${payload.contractType}`),
        ),
      };
    }
    if (!Array.isArray(payload.uploadedClauses)) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error('uploadedClauses 는 배열이어야 합니다.'),
        ),
      };
    }
    return { valid: true, payload };
  }

  /**
   * 스키마 불일치 표준 오류 응답을 만든다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildInvalidInputError(error: unknown): ErrorResponse {
    return {
      code: COMPARATOR_INVALID_INPUT_CODE,
      message: '비교 분석 요청 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
      severity: ErrorSeverity.MEDIUM,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 비교 처리 실패 표준 오류 응답을 만든다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildProcessingError(error: unknown): ErrorResponse {
    return {
      code: COMPARATOR_ERROR_CODE,
      message:
        '표준계약서 비교 중 오류가 발생했어요. 업로드하신 계약서 데이터는 보존됩니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 외부 의존성(표준계약서 저장소)의 상태는 로더에 위임되어 있으므로,
   * 본 모듈은 즉시 정상 상태를 반환한다.
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
    return 'comparator';
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
  ClauseComparator,
  DEFAULT_MATCH_THRESHOLD,
  DEFAULT_CHANGE_THRESHOLD,
} from './clause-comparator.js';
export {
  StandardFormLoader,
  STANDARD_FORM_LOAD_TIMEOUT_MS,
  type StandardFormLoadResult,
  type StandardFormSource,
  type StandardFormLoaderConfig,
} from './standard-form-loader.js';
