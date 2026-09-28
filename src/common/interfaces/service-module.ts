/**
 * 서비스 모듈 공통 인터페이스 정의
 *
 * 모든 서비스 모듈이 구현해야 하는 표준 인터페이스와
 * 공통 타입들을 정의한다.
 */

/**
 * 모듈 헬스 상태 열거형
 */
export enum HealthStatusEnum {
  /** 정상 동작 중 */
  HEALTHY = 'healthy',
  /** 성능 저하 상태 */
  DEGRADED = 'degraded',
  /** 비정상 상태 */
  UNHEALTHY = 'unhealthy',
}

/**
 * 오류 심각도 열거형
 */
export enum ErrorSeverity {
  /** 치명적 오류 - 즉시 대응 필요 */
  CRITICAL = 'critical',
  /** 높은 심각도 - 재시도 및 알림 */
  HIGH = 'high',
  /** 중간 심각도 - 로깅 후 계속 진행 */
  MEDIUM = 'medium',
  /** 낮은 심각도 - 사용자 안내 */
  LOW = 'low',
}

/**
 * 모듈 헬스체크 응답 인터페이스
 */
export interface HealthStatus {
  /** 현재 헬스 상태 */
  status: HealthStatusEnum;
  /** 마지막 체크 시각 (ISO 8601) */
  lastCheck: string;
  /** 상세 정보 */
  details?: Record<string, unknown>;
}

/**
 * 모듈 설정 인터페이스
 */
export interface ModuleConfig {
  /** 모듈 이름 */
  name: string;
  /** 모듈 버전 */
  version: string;
  /** 모듈 활성화 여부 */
  enabled: boolean;
  /** 모듈별 세부 설정 */
  config: Record<string, unknown>;
}

/**
 * 모듈 입력 인터페이스
 *
 * 타입 판별자를 통해 입력 유형을 구분하고,
 * 페이로드와 메타데이터를 전달한다.
 */
export interface ModuleInput {
  /** 입력 유형 판별자 */
  type: string;
  /** 입력 페이로드 */
  payload: unknown;
  /** 요청 메타데이터 */
  metadata?: Record<string, string>;
}

/**
 * 모듈 출력 인터페이스
 */
export interface ModuleOutput {
  /** 처리 성공 여부 */
  success: boolean;
  /** 출력 데이터 */
  data?: unknown;
  /** 오류 목록 */
  errors?: ErrorResponse[];
  /** 응답 메타데이터 */
  metadata?: Record<string, string>;
}

/**
 * 오류 응답 인터페이스
 */
export interface ErrorResponse {
  /** 오류 코드 */
  code: string;
  /** 오류 메시지 */
  message: string;
  /** 오류 심각도 */
  severity: ErrorSeverity;
  /** 오류 발생 시각 (ISO 8601) */
  timestamp: string;
  /** 오류 발생 컨텍스트 정보 */
  context?: Record<string, unknown>;
}

/**
 * 서비스 모듈 표준 인터페이스
 *
 * 모든 서비스 모듈은 이 인터페이스를 구현하여
 * 플러그인 레지스트리에 등록할 수 있다.
 */
export interface ServiceModule {
  /**
   * 모듈 초기화
   * @param config - 모듈 설정
   */
  initialize(config: ModuleConfig): Promise<void>;

  /**
   * 모듈 실행
   * @param input - 모듈 입력
   * @returns 모듈 출력
   */
  execute(input: ModuleInput): Promise<ModuleOutput>;

  /**
   * 모듈 헬스체크
   * @returns 현재 헬스 상태
   */
  healthCheck(): Promise<HealthStatus>;

  /**
   * 모듈 이름 반환
   * @returns 모듈 이름
   */
  getName(): string;

  /**
   * 모듈 버전 반환
   * @returns 모듈 버전
   */
  getVersion(): string;
}
