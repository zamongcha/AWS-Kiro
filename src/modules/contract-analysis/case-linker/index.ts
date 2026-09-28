/**
 * 판례 연동기 모듈 (CaseLinkerModule)
 *
 * 위험 조항별로 기존 판례 검색 서비스(real-estate-case-search)를 호출하여
 * 사실관계가 유사한 분쟁 판례를 조항당 최대 3건까지 연동하는 표준
 * `ServiceModule` 구현체이다.
 *
 * 처리 흐름:
 *   1. 각 위험 조항에 대해 `CaseSearchClient`로 유사 판례를 조회한다.
 *   2. 조회는 10초 타임아웃으로 통제한다. 어떤 조항 조회라도 타임아웃/오류가
 *      발생하면 판례 연동을 생략하고 `caseLinkAvailable=false`로 반환한다.
 *   3. 성공 시 조항별 연동 판례 목록과 `caseLinkAvailable=true`를 반환한다.
 *
 * 주요 규칙:
 *   - 요구사항 7.3: 위험 조항당 유사 분쟁 판례 최대 3건 검색
 *   - 요구사항 7.4: 각 판례의 사건번호·법원명·판결 요지·원문 링크 제공
 *   - 요구사항 7.5: 10초 이내 응답하지 않거나 오류 시 판례 연동 생략 폴백
 *     (`caseLinkAvailable=false` + 안내), 계약서 분석 결과는 그대로 유지
 *   - 요구사항 7.7: 원문 링크 유효성 확인(urlVerified)
 *   - Property 24: 조항당 판례 ≤3건, URL 유효성에 따른 urlVerified 표시
 *
 * 판례 검색 서비스 장애는 예외로 전파하지 않고 폴백으로 흡수하여, 계약서 분석
 * 나머지 기능이 정상 동작하도록 오류를 격리한다.
 *
 * @module CaseLinkerModule
 * @requirements 7.3, 7.4, 7.5, 7.7
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
  CaseLinkerInput,
  CaseLinkerOutput,
  ClauseLinkedCases,
  RiskClause,
} from '../interfaces/index.js';
import { CaseSearchClient } from './case-search-client.js';

/** 판례 서비스 호출 타임아웃 (밀리초). 요구사항 7.5: 10초 이내 */
export const CASE_LINK_TIMEOUT_MS = 10_000;

/** 판례 연동기 입력 판별자 */
export const CASE_LINKER_INPUT_TYPE = 'case-linker.link';

/** 입력 스키마 불일치 오류 코드 */
export const CASE_LINK_INVALID_INPUT_CODE = 'CASE_LINK_INVALID_INPUT';

/** 판례 연동 폴백 안내 메시지 (요구사항 7.5) */
export const CASE_LINK_FALLBACK_MESSAGE = '현재 유사 판례 연동을 제공할 수 없습니다.';

/**
 * 판례 연동기 모듈 설정
 */
export interface CaseLinkerModuleConfig {
  /** 판례 검색 클라이언트 (미주입 시 기본 인스턴스 생성) */
  caseSearchClient?: CaseSearchClient;
  /** 판례 서비스 호출 타임아웃 (밀리초, 기본 10000) */
  timeoutMs?: number;
}

/**
 * 판례 연동기 모듈
 *
 * @requirements 7.3, 7.4, 7.5, 7.7
 */
export class CaseLinkerModule implements ServiceModule {
  private readonly caseSearchClient: CaseSearchClient;
  private readonly timeoutMs: number;

  constructor(config: CaseLinkerModuleConfig = {}) {
    this.caseSearchClient = config.caseSearchClient ?? new CaseSearchClient();
    this.timeoutMs = config.timeoutMs ?? CASE_LINK_TIMEOUT_MS;
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
   * 입력 페이로드를 검증한 뒤 판례 연동을 수행하고, 결과를 `ModuleOutput`으로
   * 감싸 반환한다. 판례 서비스 실패는 예외가 아니라 폴백 결과
   * (`caseLinkAvailable=false`)로 반환되므로, 입력 형식 오류가 아닌 한 실행은
   * 항상 성공(`success=true`)으로 종료된다.
   *
   * @param input - 모듈 입력 (payload: CaseLinkerInput)
   * @returns 모듈 출력
   *
   * @requirements 7.5
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    const output = await this.link(validation.payload);
    const metadata = output.caseLinkAvailable
      ? undefined
      : { notice: CASE_LINK_FALLBACK_MESSAGE };
    return metadata
      ? { success: true, data: output, metadata }
      : { success: true, data: output };
  }

  /**
   * 판례 연동 핵심 로직.
   *
   * 각 위험 조항에 대해 판례 검색 클라이언트를 호출하여 유사 판례를 조회한다.
   * 전체 조회를 10초 타임아웃으로 통제하며, 타임아웃 또는 오류가 발생하면 판례
   * 연동을 생략하고 `caseLinkAvailable=false`, 빈 연동 목록을 반환한다. 이때
   * 예외를 던지지 않아 계약서 분석 결과가 그대로 유지되도록 한다.
   *
   * @param input - 판례 연동기 입력 (위험 조항 목록)
   * @returns 판례 연동 결과
   *
   * @requirements 7.3, 7.4, 7.5, 7.7
   */
  async link(input: CaseLinkerInput): Promise<CaseLinkerOutput> {
    const riskClauses = input.riskClauses ?? [];

    // 위험 조항이 없으면 호출 없이 사용 가능 상태로 빈 목록을 반환한다.
    if (riskClauses.length === 0) {
      return { linkedCases: [], caseLinkAvailable: true };
    }

    try {
      const linkedCases = await this.withTimeout(
        this.searchAllClauses(riskClauses),
        this.timeoutMs,
      );
      return { linkedCases, caseLinkAvailable: true };
    } catch {
      // 요구사항 7.5: 10초 타임아웃/오류 시 판례 연동 생략 폴백.
      return { linkedCases: [], caseLinkAvailable: false };
    }
  }

  /**
   * 모든 위험 조항에 대한 판례 조회를 병렬 수행한다.
   *
   * 각 조항 조회 결과는 조항당 최대 3건으로 제한된 연동 판례 목록이며(클라이언트
   * 책임), 이를 `ClauseLinkedCases`로 묶어 반환한다.
   *
   * @param riskClauses - 위험 조항 목록
   * @returns 조항별 연동 판례 목록
   *
   * @requirements 7.3, 7.4, 7.7
   */
  private async searchAllClauses(
    riskClauses: RiskClause[],
  ): Promise<ClauseLinkedCases[]> {
    const results = await Promise.all(
      riskClauses.map(async (clause) => {
        const cases = await this.caseSearchClient.searchForClause(clause);
        return { clauseId: clause.clauseId, cases } satisfies ClauseLinkedCases;
      }),
    );
    return results;
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 `riskClauses` 배열의 존재를 확인한다. 위반 시 표준 오류
   * 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: CaseLinkerInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: CASE_LINK_INVALID_INPUT_CODE,
        message: '판례 연동 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== CASE_LINKER_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<CaseLinkerInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (!Array.isArray(payload.riskClauses)) {
      return invalid('riskClauses 배열이 필요합니다.');
    }

    return { valid: true, payload: payload as CaseLinkerInput };
  }

  /**
   * 주어진 Promise가 타임아웃 내에 완료되지 않으면 타임아웃 오류를 던진다.
   *
   * 타이머는 성공/실패와 무관하게 항상 정리된다.
   *
   * @param promise - 감싸질 작업 Promise
   * @param timeoutMs - 타임아웃 (밀리초)
   * @returns 작업 결과
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CaseLinkTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
    }) as Promise<T>;
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 판례 연동기는 외부 서비스 상태를 별도로 폴링하지 않으므로 정상 상태를 즉시
   * 반환한다. 판례 서비스 장애는 실행 시 폴백으로 처리된다.
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
    return 'case-linker';
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }
}

/**
 * 판례 연동 타임아웃 오류
 *
 * 판례 서비스 호출이 설정된 타임아웃(기본 10초)을 초과했음을 나타낸다.
 */
export class CaseLinkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`판례 연동이 ${timeoutMs}ms 타임아웃을 초과했습니다.`);
    this.name = 'CaseLinkTimeoutError';
  }
}

// 하위 모듈 re-export
export {
  CaseSearchClient,
  MockCaseSearchInvoker,
  isValidFullUrl,
  MAX_CASES_PER_CLAUSE,
} from './case-search-client.js';
export type {
  CaseSearchClientConfig,
  CaseSearchInvoker,
  CaseSearchHit,
} from './case-search-client.js';
