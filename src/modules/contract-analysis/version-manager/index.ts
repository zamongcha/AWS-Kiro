/**
 * 버전 관리기 모듈 (VersionManagerModule)
 *
 * 계약서 수정본을 버전으로 저장(action=save)하거나 두 버전을 조항 단위로
 * 비교(action=compare)하는 표준 `ServiceModule` 구현체이다. 저장은
 * `VersionStore`, 비교는 `VersionComparator`에 위임하며, 본 모듈은 입력
 * 검증·오류 표준화·타임아웃·헬스체크 등 모듈 계약을 담당한다.
 *
 * 주요 규칙:
 *   - action=save: 기존 버전 보존한 채 신규 버전 생성, 저장 실패 시 오류
 *     반환·수정본 보존(요구사항 12.1, 12.7).
 *   - action=compare: 두 버전을 조항 단위로 대조하고 5초 이내 반환, 실패 또는
 *     5초 초과 시 오류·재시도 안내·대상 데이터 무변경(요구사항 12.5, 12.8).
 *
 * @module VersionManagerModule
 * @requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8
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
  VersionManagerInput,
  VersionManagerOutput,
} from '../interfaces/version-manager.js';
import type { ContractDynamoStore } from '../storage/dynamo-store.js';
import { VersionComparator } from './version-comparator.js';
import { VersionStore } from './version-store.js';

/** 버전 관리기 입력 판별자 */
export const VERSION_MANAGER_INPUT_TYPE = 'version-manager.manage';

/** 입력 스키마 불일치 오류 코드 */
export const VERSION_MANAGER_INVALID_INPUT_CODE = 'VERSION_MANAGER_INVALID_INPUT';

/** 버전 저장 실패 오류 코드 */
export const VERSION_MANAGER_SAVE_FAILED_CODE = 'VERSION_MANAGER_SAVE_FAILED';

/** 버전 비교 실패/타임아웃 오류 코드 */
export const VERSION_MANAGER_COMPARE_FAILED_CODE =
  'VERSION_MANAGER_COMPARE_FAILED';

/** 버전 비교 기본 타임아웃 (ms) - 요구사항 12.5: 5초 이내 */
export const VERSION_COMPARE_TIMEOUT_MS = 5000;

/**
 * 버전 관리기 모듈 설정
 */
export interface VersionManagerModuleConfig {
  /** DynamoDB 계약서 저장소 (필수) */
  dynamoStore: ContractDynamoStore;
  /** 버전 저장소 (선택, 기본 인스턴스 생성) */
  versionStore?: VersionStore;
  /** 버전 비교기 (선택, 기본 인스턴스 생성) */
  versionComparator?: VersionComparator;
  /** 버전 비교 타임아웃 (ms, 기본 5000) */
  compareTimeoutMs?: number;
}

/**
 * 버전 관리기 모듈
 *
 * @requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8
 */
export class VersionManagerModule implements ServiceModule {
  private readonly dynamoStore: ContractDynamoStore;
  private readonly versionStore: VersionStore;
  private readonly versionComparator: VersionComparator;
  private readonly compareTimeoutMs: number;

  constructor(config: VersionManagerModuleConfig) {
    this.dynamoStore = config.dynamoStore;
    this.versionStore =
      config.versionStore ?? new VersionStore({ dynamoStore: config.dynamoStore });
    this.versionComparator = config.versionComparator ?? new VersionComparator();
    this.compareTimeoutMs =
      config.compareTimeoutMs ?? VERSION_COMPARE_TIMEOUT_MS;
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
   * 입력 페이로드를 검증한 뒤 action에 따라 저장 또는 비교를 수행한다.
   * 스키마 불일치는 스키마 오류로, 저장/비교 실패는 각각의 오류로 표준화한다.
   *
   * @param input - 모듈 입력 (payload: VersionManagerInput)
   * @returns 모듈 출력
   *
   * @requirements 12.1, 12.5, 12.7, 12.8
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateModuleInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    const payload = validation.payload;

    if (payload.action === 'save') {
      return this.executeSave(payload);
    }
    return this.executeCompare(payload);
  }

  /**
   * 버전 저장을 수행한다.
   *
   * 저장 실패 시 기존 버전은 변경되지 않으며(저장소가 신규 항목만 추가),
   * 표준 저장 오류를 반환하여 상위 계층이 수정본을 보존하도록 한다.
   *
   * @param payload - 버전 관리기 입력 (action=save)
   * @returns 모듈 출력
   *
   * @requirements 12.1, 12.7
   */
  private async executeSave(
    payload: VersionManagerInput,
  ): Promise<ModuleOutput> {
    try {
      const savedVersion = await this.versionStore.save(
        payload.documentId,
        payload.revisedContent ?? '',
      );
      const output: VersionManagerOutput = { action: 'save', savedVersion };
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildSaveError(error)] };
    }
  }

  /**
   * 버전 비교를 수행한다.
   *
   * 두 버전 레코드를 조회하여 조항 단위로 대조하며, 5초 이내에 완료되지
   * 않으면 타임아웃 오류로 처리한다. 비교는 조회한 데이터만 사용하고 대상
   * 버전 데이터를 변경하지 않는다.
   *
   * @param payload - 버전 관리기 입력 (action=compare)
   * @returns 모듈 출력
   *
   * @requirements 12.5, 12.6, 12.8
   */
  private async executeCompare(
    payload: VersionManagerInput,
  ): Promise<ModuleOutput> {
    try {
      const comparison = await this.withTimeout(
        this.runCompare(payload),
        this.compareTimeoutMs,
      );
      const output: VersionManagerOutput = { action: 'compare', comparison };
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildCompareError(error)] };
    }
  }

  /**
   * 두 버전을 조회하여 비교기에 위임한다.
   *
   * @param payload - 버전 관리기 입력 (action=compare)
   * @returns 버전 비교 결과
   * @throws 버전 미존재 시 오류
   */
  private async runCompare(payload: VersionManagerInput) {
    const [recordA, recordB] = await Promise.all([
      this.dynamoStore.getVersion(payload.documentId, payload.versionA!),
      this.dynamoStore.getVersion(payload.documentId, payload.versionB!),
    ]);

    if (!recordA || !recordB) {
      const missing = !recordA ? payload.versionA : payload.versionB;
      throw new Error(`비교 대상 버전을 찾을 수 없습니다: 버전 ${missing}`);
    }

    return this.versionComparator.compare(
      recordA.content,
      recordB.content,
      recordA.overallGrade,
      recordB.overallGrade,
    );
  }

  /**
   * 모듈 입력을 검증한다.
   *
   * 입력 유형 판별자, 페이로드 존재 여부, action 유효성, action별 필수
   * 필드(save: documentId, compare: documentId·versionA·versionB)를 확인한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateModuleInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: VersionManagerInput }
    | { valid: false; error: ErrorResponse } {
    if (input.type !== VERSION_MANAGER_INPUT_TYPE) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error(`알 수 없는 입력 유형입니다: ${input.type}`),
        ),
      };
    }

    const payload = input.payload as VersionManagerInput | undefined;
    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        error: this.buildInvalidInputError(new Error('페이로드가 비어있습니다.')),
      };
    }

    if (payload.action !== 'save' && payload.action !== 'compare') {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error(`유효하지 않은 action 값입니다: ${String(payload.action)}`),
        ),
      };
    }

    if (typeof payload.documentId !== 'string' || payload.documentId.length === 0) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error('documentId 는 비어있지 않은 문자열이어야 합니다.'),
        ),
      };
    }

    if (payload.action === 'save') {
      if (typeof payload.revisedContent !== 'string') {
        return {
          valid: false,
          error: this.buildInvalidInputError(
            new Error('저장 요청에는 revisedContent(문자열)가 필요합니다.'),
          ),
        };
      }
    } else {
      if (
        !Number.isInteger(payload.versionA) ||
        !Number.isInteger(payload.versionB)
      ) {
        return {
          valid: false,
          error: this.buildInvalidInputError(
            new Error('비교 요청에는 정수형 versionA·versionB 가 필요합니다.'),
          ),
        };
      }
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
      code: VERSION_MANAGER_INVALID_INPUT_CODE,
      message: '버전 관리 요청 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
      severity: ErrorSeverity.MEDIUM,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 버전 저장 실패 표준 오류 응답을 만든다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildSaveError(error: unknown): ErrorResponse {
    return {
      code: VERSION_MANAGER_SAVE_FAILED_CODE,
      message:
        '버전 저장 중 오류가 발생했어요. 기존 버전과 입력하신 수정본은 그대로 보존됩니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 버전 비교 실패/타임아웃 표준 오류 응답을 만든다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildCompareError(error: unknown): ErrorResponse {
    return {
      code: VERSION_MANAGER_COMPARE_FAILED_CODE,
      message:
        '버전 비교 중 오류가 발생했어요. 대상 버전 데이터는 변경되지 않았습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 주어진 Promise 를 지정 시간(ms) 내로 제한한다.
   *
   * 시간 내 완료되지 않으면 타임아웃 오류로 거부한다.
   *
   * @param promise - 대상 Promise
   * @param timeoutMs - 타임아웃 (ms)
   * @returns Promise 결과
   * @throws 타임아웃 도달 시 오류
   *
   * @requirements 12.5, 12.8
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`버전 비교가 ${timeoutMs}ms 이내에 완료되지 않았습니다.`),
        );
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 외부 의존성(DynamoDB) 상태는 저장소 계층에 위임되므로, 본 모듈은 즉시
   * 정상 상태를 반환한다.
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
    return 'version-manager';
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
  VersionStore,
  MIN_RETAINED_VERSIONS,
  MAX_RETAINED_VERSIONS,
  type GradeEvaluator,
  type VersionStoreConfig,
} from './version-store.js';
export {
  VersionComparator,
  GRADE_RANK,
  DEFAULT_CHANGE_MATCH_THRESHOLD,
  type VersionComparatorConfig,
} from './version-comparator.js';
