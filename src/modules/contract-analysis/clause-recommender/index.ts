/**
 * 특약 추천기 모듈 (ClauseRecommenderModule)
 *
 * 계약 유형·당사자 관점 확정 시 권장 특약을 추천하고, 계약서에서 식별된
 * 누락 특약을 추천 목록 상단에 우선 배치하는 표준 `ServiceModule` 구현체이다.
 *
 * 처리 흐름:
 *   1. 입력(`ClauseRecommenderInput`) 검증
 *   2. `ClauseRecommender`로 계약 유형·관점별 권장 특약 산출
 *   3. 누락 특약을 상단 우선순위로 병합하여 반환
 *
 * 주요 규칙:
 *   - 요구사항 11.1 (Property 28): 권장 특약 존재 시 1개 이상 + hasRecommendations=true, 3초 이내 반환
 *   - 요구사항 11.2: 권장 특약이 없으면 빈 목록 대신 hasRecommendations=false 안내
 *   - 요구사항 11.3: 각 추천에 특약 문안·추천 사유·관점 이점 제공
 *   - 요구사항 11.4 (Property 28): 누락 특약을 그 외 특약보다 높은 우선순위로 상단 배치
 *   - 요구사항 11.5: 텍스트 편집 중단 2초 경과 시 추천 목록 갱신(디바운스)
 *   - 요구사항 11.6, 11.7: 근거 법조항/판례 1건 이상, 미확인 시 isBasisVerified=false
 *
 * 디바운스(요구사항 11.5)는 `scheduleRecommendationUpdate`로 제공하며, 편집
 * 중단 2초 경과 시점에 최신 입력으로 추천을 재계산하는 트리거 로직만 담당한다.
 * 실제 프론트엔드 연동은 인터페이스만 정의한다.
 *
 * @module ClauseRecommenderModule
 * @requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
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
  ClauseRecommenderInput,
  ClauseRecommenderOutput,
  ContractType,
  PartyPerspective,
} from '../interfaces/index.js';
import { ClauseRecommender, type ClauseRecommenderConfig } from './recommender.js';

/** 특약 추천기 입력 판별자 */
export const CLAUSE_RECOMMENDER_INPUT_TYPE = 'clause-recommender.recommend';

/** 입력 스키마 불일치 오류 코드 */
export const CLAUSE_RECOMMENDER_INVALID_INPUT_CODE =
  'CLAUSE_RECOMMENDER_INVALID_INPUT';

/** 추천 생성 실패 오류 코드 */
export const CLAUSE_RECOMMENDER_ERROR_CODE = 'CLAUSE_RECOMMENDER_FAILED';

/** 편집 중단 후 추천 갱신까지의 디바운스 지연 (밀리초). 요구사항 11.5: 2초 */
export const RECOMMENDATION_DEBOUNCE_MS = 2_000;

/** 허용되는 계약 유형 집합 */
const VALID_CONTRACT_TYPES: ReadonlySet<ContractType> = new Set<ContractType>([
  'sale',
  'jeonse',
  'wolse',
  'commercial_lease',
]);

/** 허용되는 당사자 관점 집합 */
const VALID_PERSPECTIVES: ReadonlySet<PartyPerspective> =
  new Set<PartyPerspective>(['buyer', 'seller', 'landlord', 'tenant']);

/**
 * 특약 추천기 모듈 설정
 */
export interface ClauseRecommenderModuleConfig extends ClauseRecommenderConfig {
  /** 디바운스 지연 (밀리초, 기본 2000) */
  debounceMs?: number;
}

/**
 * 특약 추천기 모듈
 *
 * @requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */
export class ClauseRecommenderModule implements ServiceModule {
  private readonly recommender: ClauseRecommender;
  private readonly debounceMs: number;
  private debounceTimer?: ReturnType<typeof setTimeout>;

  constructor(config: ClauseRecommenderModuleConfig = {}) {
    this.recommender = new ClauseRecommender(config);
    this.debounceMs = config.debounceMs ?? RECOMMENDATION_DEBOUNCE_MS;
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
   * 입력 페이로드를 검증한 뒤 특약 추천을 수행하고 결과를 `ModuleOutput`으로
   * 감싸 반환한다. 검증 실패 또는 추천 생성 실패 시 표준 `ErrorResponse`를
   * 담은 실패 출력을 반환하며 입력을 변경하지 않는다.
   *
   * @param input - 모듈 입력 (payload: ClauseRecommenderInput)
   * @returns 모듈 출력
   *
   * @requirements 11.1, 11.2, 11.3, 11.4
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const output = await this.recommender.recommend(validation.payload);
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildError(error)] };
    }
  }

  /**
   * 특약 추천 결과를 직접 산출한다.
   *
   * 오케스트레이터가 `ModuleInput` 래핑 없이 추천 결과를 필요로 할 때 사용하는
   * 편의 메서드이다.
   *
   * @param input - 특약 추천기 입력
   * @returns 특약 추천 결과
   *
   * @requirements 11.1, 11.2, 11.3, 11.4
   */
  async recommend(
    input: ClauseRecommenderInput,
  ): Promise<ClauseRecommenderOutput> {
    return this.recommender.recommend(input);
  }

  /**
   * 텍스트 편집 중단 시점 기준 디바운스 추천 갱신을 예약한다.
   *
   * 요구사항 11.5: 사용자가 계약서 텍스트 편집을 중단한 시점으로부터 2초가
   * 경과하면 변경 내용을 반영하여 추천 목록을 갱신한다. 편집이 계속되면 기존
   * 예약 타이머를 취소하고 새 타이머를 등록하여, 편집 중단 후 2초가 실제로
   * 경과한 경우에만 갱신 콜백이 실행되도록 한다.
   *
   * 프론트엔드는 편집 이벤트마다 이 메서드를 호출하고, 콜백에서 최신 추천
   * 결과를 UI에 반영한다.
   *
   * @param input - 최신 특약 추천기 입력
   * @param onUpdate - 갱신된 추천 결과를 전달받는 콜백
   * @returns 예약된 갱신을 취소하는 함수
   *
   * @requirements 11.5
   */
  scheduleRecommendationUpdate(
    input: ClauseRecommenderInput,
    onUpdate: (output: ClauseRecommenderOutput) => void,
  ): () => void {
    // 편집이 계속되는 동안 이전 예약을 취소하여 편집 중단 후에만 실행되도록 한다.
    this.cancelScheduledUpdate();

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.recommender
        .recommend(input)
        .then(onUpdate)
        .catch(() => {
          // 갱신 실패는 기존 추천 목록을 유지하며 조용히 무시한다.
        });
    }, this.debounceMs);

    return () => this.cancelScheduledUpdate();
  }

  /**
   * 예약된 디바운스 갱신 타이머를 취소한다.
   *
   * @requirements 11.5
   */
  cancelScheduledUpdate(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 필수 필드(contractType/perspective)의 유효성을 확인하고,
   * missingClauses가 제공된 경우 배열 형태인지 확인한다. 위반 시 표준 오류
   * 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: ClauseRecommenderInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: CLAUSE_RECOMMENDER_INVALID_INPUT_CODE,
        message: '특약 추천 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== CLAUSE_RECOMMENDER_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<ClauseRecommenderInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (
      typeof payload.contractType !== 'string' ||
      !VALID_CONTRACT_TYPES.has(payload.contractType as ContractType)
    ) {
      return invalid('유효한 contractType이 필요합니다.');
    }
    if (
      typeof payload.perspective !== 'string' ||
      !VALID_PERSPECTIVES.has(payload.perspective as PartyPerspective)
    ) {
      return invalid('유효한 perspective가 필요합니다.');
    }
    if (
      payload.missingClauses !== undefined &&
      !Array.isArray(payload.missingClauses)
    ) {
      return invalid('missingClauses는 배열이어야 합니다.');
    }

    return { valid: true, payload: payload as ClauseRecommenderInput };
  }

  /**
   * 추천 생성 실패를 표준 오류 응답으로 변환한다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildError(error: unknown): ErrorResponse {
    return {
      code: CLAUSE_RECOMMENDER_ERROR_CODE,
      message: '특약 추천 중 오류가 발생했습니다. 다시 시도해 주세요.',
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
   * 특약 추천기는 코드 내 시드를 사용하며 외부 저장소를 별도로 폴링하지
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
    return 'clause-recommender';
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
  ClauseRecommender,
  MISSING_CLAUSE_PRIORITY_BASE,
  GENERAL_CLAUSE_PRIORITY_BASE,
} from './recommender.js';
export type {
  ClauseRecommenderConfig,
  ClauseSeedSource,
} from './recommender.js';
export {
  RECOMMENDATION_SEED,
} from './recommendation-seed.js';
export type {
  RecommendationSeed,
  RecommendationSeedMap,
} from './recommendation-seed.js';
