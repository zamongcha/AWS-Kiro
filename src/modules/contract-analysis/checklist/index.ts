/**
 * 첨부서류 체크리스트 모듈 (ChecklistModule)
 *
 * 확정된 계약 유형에 대응하는 필수 첨부서류 체크리스트를 제공하고, 등기부등본
 * 대조 결과를 반영하여 항목 상태를 갱신하는 표준 `ServiceModule` 구현체이다.
 *
 * 처리 흐름:
 *   1. 입력(`ChecklistInput`) 검증
 *   2. `ChecklistService`로 계약 유형별 체크리스트 산출(요구사항 10.1, 10.2)
 *   3. 등기부 대조 결과가 함께 제공되면 항목 상태를 갱신(요구사항 10.4, 10.5)
 *
 * @module ChecklistModule
 * @requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
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
  ContractType,
  RegistryMatchResult,
} from '../interfaces/index.js';
import {
  ChecklistService,
  type ChecklistResult,
  type ChecklistServiceConfig,
} from './checklist-service.js';

/** 체크리스트 입력 판별자 */
export const CHECKLIST_INPUT_TYPE = 'checklist.provide';

/** 입력 스키마 불일치 오류 코드 */
export const CHECKLIST_INVALID_INPUT_CODE = 'CHECKLIST_INVALID_INPUT';

/** 체크리스트 제공 실패 오류 코드 */
export const CHECKLIST_ERROR_CODE = 'CHECKLIST_FAILED';

/** 허용되는 계약 유형 집합 */
const VALID_CONTRACT_TYPES: ReadonlySet<ContractType> = new Set<ContractType>([
  'sale',
  'jeonse',
  'wolse',
  'commercial_lease',
]);

/**
 * 체크리스트 모듈 입력 페이로드.
 */
export interface ChecklistInput {
  /** 확정된 계약 유형 */
  contractType: ContractType;
  /** 등기부 대조 결과 (제공 시 항목 상태 갱신에 사용) */
  registryResult?: RegistryMatchResult;
}

/**
 * 첨부서류 체크리스트 모듈.
 *
 * @requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */
export class ChecklistModule implements ServiceModule {
  private readonly service: ChecklistService;

  constructor(config: ChecklistServiceConfig = {}) {
    this.service = new ChecklistService(config);
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
   * 입력 페이로드를 검증한 뒤 체크리스트를 산출하고, 등기부 대조 결과가
   * 함께 제공되면 항목 상태를 갱신하여 `ModuleOutput`으로 반환한다. 검증
   * 실패 또는 제공 실패 시 표준 `ErrorResponse`를 담은 실패 출력을 반환하며
   * 입력을 변경하지 않는다.
   *
   * @param input - 모듈 입력 (payload: ChecklistInput)
   * @returns 모듈 출력
   *
   * @requirements 10.1, 10.2, 10.4, 10.5
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const result = await this.provide(
        validation.payload.contractType,
        validation.payload.registryResult,
      );
      return { success: result.success, data: result };
    } catch (error) {
      return { success: false, errors: [this.buildError(error)] };
    }
  }

  /**
   * 계약 유형별 체크리스트를 산출하고, 등기부 대조 결과가 있으면 반영한다.
   *
   * 오케스트레이터가 `ModuleInput` 래핑 없이 결과를 필요로 할 때 사용하는
   * 편의 메서드이다.
   *
   * @param contractType - 확정된 계약 유형
   * @param registryResult - 등기부 대조 결과 (선택)
   * @returns 체크리스트 조회 결과
   *
   * @requirements 10.1, 10.2, 10.4, 10.5
   */
  async provide(
    contractType: ContractType,
    registryResult?: RegistryMatchResult,
  ): Promise<ChecklistResult> {
    const result = await this.service.getChecklist(contractType);

    // 체크리스트가 있고 등기부 대조 결과가 제공되면 항목 상태를 갱신한다.
    if (result.success && result.checklist && registryResult) {
      return {
        ...result,
        checklist: this.service.applyRegistryMatch(
          result.checklist,
          registryResult,
        ),
      };
    }

    return result;
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 필수 필드(contractType)의 유효성을 확인한다. 위반 시
   * 표준 오류 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: ChecklistInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (
      reason: string,
    ): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: CHECKLIST_INVALID_INPUT_CODE,
        message:
          '첨부서류 체크리스트 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== CHECKLIST_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<ChecklistInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (
      typeof payload.contractType !== 'string' ||
      !VALID_CONTRACT_TYPES.has(payload.contractType as ContractType)
    ) {
      return invalid('유효한 contractType이 필요합니다.');
    }

    return { valid: true, payload: payload as ChecklistInput };
  }

  /**
   * 제공 실패를 표준 오류 응답으로 변환한다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildError(error: unknown): ErrorResponse {
    return {
      code: CHECKLIST_ERROR_CODE,
      message:
        '첨부서류 체크리스트를 제공하는 중 오류가 발생했습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.MEDIUM,
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
   * 체크리스트 서비스는 코드 내 시드를 사용하며 외부 저장소를 별도로 폴링하지
   * 않으므로 정상 상태를 즉시 반환한다.
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
    return 'checklist';
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
  ChecklistService,
  CHECKLIST_PROVIDE_TIMEOUT_MS,
  REGISTRY_DOCUMENT_KEYWORD,
} from './checklist-service.js';
export type {
  ChecklistResult,
  ChecklistSource,
  ChecklistServiceConfig,
} from './checklist-service.js';
export { CHECKLIST_SEED } from './checklist-seed.js';
export type { ChecklistSeedMap } from './checklist-seed.js';
