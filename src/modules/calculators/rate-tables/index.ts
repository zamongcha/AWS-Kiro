/**
 * 기준표 관리기 모듈 (RateTableModule)
 *
 * 표준 ServiceModule 인터페이스를 구현하여 기준연도별 기준표를 제공하는 모듈이다.
 * 요청 기준연도에 해당하는 기준표가 존재하면 이를 반환하고, 존재하지 않으면 사용
 * 가능한 기준연도 목록을 안내하는 응답(RateTableResponse)을 반환한다. 내부적으로
 * RateTableRegistryImpl에 조회를 위임하며, 계산 로직과 분리된 상수 기준표만 다룬다.
 *
 * @requirements 6.2 - 지정 기준연도 기준표 버전 제공
 * @requirements 6.5 - 기준표에 기준연도·버전 메타데이터 포함
 * @requirements 6.6 - 요청 기준연도 미존재 시 사용 가능 기준연도 목록 안내
 */

import type {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
} from '../../../common/interfaces/index.js';
import { HealthStatusEnum, ErrorSeverity } from '../../../common/interfaces/index.js';

import type {
  RateTableRequest,
  RateTableResponse,
} from '../interfaces/rate-tables.js';
import type { CalculatorType } from '../interfaces/types.js';
import { RateTableRegistryImpl } from './rate-table-registry.js';

/** 기준표 관리기 모듈 서비스 이름 */
const MODULE_NAME = 'CALC_RATE_TABLE_MODULE';
/** 기준표 관리기 모듈 버전 */
const MODULE_VERSION = '1.0.0';

/** 유효한 계산기 유형 집합 (입력 검증용) */
const VALID_CALCULATOR_TYPES: readonly CalculatorType[] = [
  'acquisition',
  'transfer_tax',
  'brokerage',
];

/**
 * 기준표 관리기 모듈 클래스.
 *
 * 기준연도별 기준표 조회 요청(RateTableRequest)을 받아 기준표 제공 또는 사용 가능
 * 기준연도 목록 안내 응답을 반환한다. 상태 비저장 결정론적 조회만 수행한다.
 */
export class RateTableModule implements ServiceModule {
  private readonly registry: RateTableRegistryImpl;
  private initialized = false;

  /**
   * @param registry - 기준표 레지스트리 (미지정 시 기본 구현 사용)
   */
  constructor(registry?: RateTableRegistryImpl) {
    this.registry = registry ?? new RateTableRegistryImpl();
  }

  /**
   * 모듈 초기화.
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    this.initialized = true;
  }

  /**
   * 기준표 조회를 수행한다.
   *
   * 입력 페이로드는 RateTableRequest(계산기 유형·기준연도)이며, 조회 결과를
   * RateTableResponse로 감싸 ModuleOutput.data에 담아 반환한다.
   *
   * @param input - 모듈 입력 (payload = RateTableRequest)
   * @returns 조회 결과를 담은 모듈 출력
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return this.errorOutput(
        'NOT_INITIALIZED',
        '기준표 관리기 모듈이 초기화되지 않았습니다.',
        ErrorSeverity.CRITICAL,
      );
    }

    const request = input.payload as RateTableRequest | undefined;

    // 요청 유효성 검사: 계산기 유형과 기준연도(정수) 존재 여부
    if (
      !request ||
      !VALID_CALCULATOR_TYPES.includes(request.calculatorType) ||
      typeof request.baseYear !== 'number' ||
      !Number.isInteger(request.baseYear)
    ) {
      return this.errorOutput(
        'INVALID_REQUEST',
        '기준표 조회 요청이 올바르지 않습니다. 계산기 유형과 기준연도를 확인하세요.',
        ErrorSeverity.LOW,
      );
    }

    const response = this.getRateTable(request);
    return { success: true, data: response };
  }

  /**
   * 기준표 조회 요청을 처리하여 응답을 생성한다.
   *
   * 요청 기준연도의 기준표가 존재하면 found=true와 기준표를 반환하고, 존재하지
   * 않으면 found=false와 함께 해당 계산기 유형에 사용 가능한 기준연도 목록을
   * 안내한다.
   *
   * @param request - 기준표 조회 요청
   * @returns 기준표 조회 응답
   */
  getRateTable(request: RateTableRequest): RateTableResponse {
    const rateTable = this.registry.getRateTable(
      request.calculatorType,
      request.baseYear,
    );

    if (rateTable) {
      return { found: true, rateTable };
    }

    return {
      found: false,
      availableBaseYears: this.registry.getAvailableBaseYears(
        request.calculatorType,
      ),
    };
  }

  /**
   * 헬스체크를 수행한다.
   *
   * 3개 계산기 유형 모두에 사용 가능한 기준연도가 존재하면 HEALTHY,
   * 일부만 존재하면 DEGRADED, 전무하면 UNHEALTHY로 판정한다.
   */
  async healthCheck(): Promise<HealthStatus> {
    const availability: Record<string, number[]> = {};
    let loadedTypeCount = 0;

    for (const type of VALID_CALCULATOR_TYPES) {
      const years = this.registry.getAvailableBaseYears(type);
      availability[type] = years;
      if (years.length > 0) {
        loadedTypeCount += 1;
      }
    }

    let status: HealthStatusEnum;
    if (loadedTypeCount === VALID_CALCULATOR_TYPES.length) {
      status = HealthStatusEnum.HEALTHY;
    } else if (loadedTypeCount > 0) {
      status = HealthStatusEnum.DEGRADED;
    } else {
      status = HealthStatusEnum.UNHEALTHY;
    }

    return {
      status,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: this.initialized,
        availableBaseYears: availability,
      },
    };
  }

  getName(): string {
    return MODULE_NAME;
  }

  getVersion(): string {
    return MODULE_VERSION;
  }

  /**
   * 표준 오류 응답을 담은 모듈 출력을 생성한다.
   */
  private errorOutput(
    code: string,
    message: string,
    severity: ErrorSeverity,
  ): ModuleOutput {
    return {
      success: false,
      errors: [
        {
          code,
          message,
          severity,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }
}

// 레지스트리 구현 re-export
export { RateTableRegistryImpl } from './rate-table-registry.js';
