/**
 * @fileoverview Circuit Breaker 패턴 구현 모듈
 * @description 모듈 간 오류 격리를 위한 Circuit Breaker 패턴을 구현한다.
 * 연속 실패 시 회로를 개방(Open)하여 장애 전파를 방지하고,
 * 일정 시간 후 반개방(HalfOpen) 상태에서 복구를 시도한다.
 *
 * 상태 전이:
 * - Closed → Open: 실패 횟수가 failureThreshold에 도달
 * - Open → HalfOpen: timeout(ms) 경과 후
 * - HalfOpen → Closed: 성공 횟수가 successThreshold에 도달
 * - HalfOpen → Open: 실패 발생 시
 *
 * @requirements 8.6 - Circuit Breaker 패턴 적용으로 장애 전파 방지
 */

/**
 * Circuit Breaker 설정 인터페이스
 */
export interface CircuitBreakerConfig {
  /** 회로 개방(Open)을 위한 실패 임계값 */
  failureThreshold: number;
  /** 반개방(HalfOpen)에서 닫힘(Closed)으로 전환하기 위한 성공 임계값 */
  successThreshold: number;
  /** 개방(Open) 상태에서 반개방(HalfOpen)으로 전환하기까지의 대기 시간 (밀리초) */
  timeout: number;
  /** 실패 횟수를 모니터링하는 윈도우 크기 (밀리초). 이 기간 내 실패만 카운트한다. */
  monitoringWindow: number;
}

/**
 * Circuit Breaker 상태 열거형
 */
export enum CircuitBreakerState {
  /** 닫힘 - 정상 동작, 요청을 통과시킨다 */
  Closed = 'CLOSED',
  /** 열림 - 장애 감지, 요청을 즉시 거부한다 */
  Open = 'OPEN',
  /** 반열림 - 복구 시도, 제한된 요청만 통과시킨다 */
  HalfOpen = 'HALF_OPEN',
}

/**
 * Circuit Breaker 통계 정보
 */
export interface CircuitBreakerStats {
  /** 현재 상태 */
  state: CircuitBreakerState;
  /** 총 실패 횟수 */
  totalFailures: number;
  /** 총 성공 횟수 */
  totalSuccesses: number;
  /** 현재 모니터링 윈도우 내 실패 횟수 */
  currentFailures: number;
  /** HalfOpen 상태에서의 연속 성공 횟수 */
  halfOpenSuccesses: number;
  /** 마지막 실패 시각 */
  lastFailureTime: string | null;
  /** 마지막 상태 전이 시각 */
  lastStateChangeTime: string;
}

/**
 * Circuit Breaker가 열려 있을 때 발생하는 에러
 */
export class CircuitBreakerOpenError extends Error {
  /** 회로가 다시 닫힐 예상 시각 */
  public readonly retryAfter: number;

  constructor(retryAfterMs: number) {
    super(
      `Circuit Breaker가 열려 있습니다. ${Math.ceil(retryAfterMs / 1000)}초 후에 다시 시도해 주세요.`
    );
    this.name = 'CircuitBreakerOpenError';
    this.retryAfter = retryAfterMs;
  }
}

/**
 * 실패 기록 항목
 */
interface FailureRecord {
  timestamp: number;
  error: Error;
}

/**
 * 기본 Circuit Breaker 설정
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 60000,
  monitoringWindow: 120000,
};

/**
 * Circuit Breaker 클래스
 *
 * 외부 서비스 호출을 감싸서 연속 실패 시 회로를 개방하고,
 * 일정 시간 후 복구를 시도하는 패턴을 구현한다.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   successThreshold: 3,
 *   timeout: 60000,
 *   monitoringWindow: 120000,
 * });
 *
 * const result = await breaker.execute(() => callExternalService());
 * ```
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.Closed;
  private failures: FailureRecord[] = [];
  private halfOpenSuccesses: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private lastFailureTime: number | null = null;
  private lastStateChangeTime: number = Date.now();
  private openedAt: number | null = null;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    this.config = config;
  }

  /**
   * 함수를 Circuit Breaker로 감싸서 실행한다.
   *
   * - Closed 상태: 함수를 정상 실행하고, 실패 시 실패 카운트를 증가시킨다.
   * - Open 상태: 즉시 CircuitBreakerOpenError를 던진다.
   * - HalfOpen 상태: 함수를 실행하고, 성공/실패에 따라 상태를 전이한다.
   *
   * @template T - 함수의 반환 타입
   * @param fn - 실행할 비동기 함수
   * @returns 함수 실행 결과
   * @throws {CircuitBreakerOpenError} 회로가 열려 있을 때
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Open 상태: 타임아웃 경과 확인
    if (this.state === CircuitBreakerState.Open) {
      if (this.shouldTransitionToHalfOpen()) {
        this.transitionTo(CircuitBreakerState.HalfOpen);
      } else {
        const retryAfter = this.getRemainingTimeout();
        throw new CircuitBreakerOpenError(retryAfter);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 현재 Circuit Breaker 상태를 반환한다.
   */
  getState(): CircuitBreakerState {
    // Open 상태에서 타임아웃 경과 확인
    if (this.state === CircuitBreakerState.Open && this.shouldTransitionToHalfOpen()) {
      this.transitionTo(CircuitBreakerState.HalfOpen);
    }
    return this.state;
  }

  /**
   * Circuit Breaker를 초기 상태(Closed)로 리셋한다.
   */
  reset(): void {
    this.state = CircuitBreakerState.Closed;
    this.failures = [];
    this.halfOpenSuccesses = 0;
    this.openedAt = null;
    this.lastStateChangeTime = Date.now();
  }

  /**
   * Circuit Breaker 통계 정보를 반환한다.
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      currentFailures: this.getRecentFailureCount(),
      halfOpenSuccesses: this.halfOpenSuccesses,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
      lastStateChangeTime: new Date(this.lastStateChangeTime).toISOString(),
    };
  }

  /**
   * 성공 시 처리 로직
   */
  private onSuccess(): void {
    this.totalSuccesses++;

    if (this.state === CircuitBreakerState.HalfOpen) {
      this.halfOpenSuccesses++;
      // 성공 임계값 도달 시 Closed로 전환
      if (this.halfOpenSuccesses >= this.config.successThreshold) {
        this.transitionTo(CircuitBreakerState.Closed);
      }
    } else if (this.state === CircuitBreakerState.Closed) {
      // Closed 상태에서 성공하면 오래된 실패 기록 정리
      this.pruneOldFailures();
    }
  }

  /**
   * 실패 시 처리 로직
   */
  private onFailure(error: Error): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitBreakerState.HalfOpen) {
      // HalfOpen에서 실패하면 즉시 Open으로 전환
      this.transitionTo(CircuitBreakerState.Open);
    } else if (this.state === CircuitBreakerState.Closed) {
      // 실패 기록 추가
      this.failures.push({ timestamp: Date.now(), error });
      this.pruneOldFailures();

      // 모니터링 윈도우 내 실패 횟수가 임계값에 도달하면 Open으로 전환
      if (this.getRecentFailureCount() >= this.config.failureThreshold) {
        this.transitionTo(CircuitBreakerState.Open);
      }
    }
  }

  /**
   * 상태 전이 처리
   */
  private transitionTo(newState: CircuitBreakerState): void {
    this.state = newState;
    this.lastStateChangeTime = Date.now();

    switch (newState) {
      case CircuitBreakerState.Open:
        this.openedAt = Date.now();
        this.halfOpenSuccesses = 0;
        break;
      case CircuitBreakerState.HalfOpen:
        this.halfOpenSuccesses = 0;
        break;
      case CircuitBreakerState.Closed:
        this.failures = [];
        this.halfOpenSuccesses = 0;
        this.openedAt = null;
        break;
    }
  }

  /**
   * Open → HalfOpen 전환 조건 확인
   */
  private shouldTransitionToHalfOpen(): boolean {
    if (this.openedAt === null) {
      return false;
    }
    return Date.now() - this.openedAt >= this.config.timeout;
  }

  /**
   * Open 상태에서 남은 대기 시간 계산
   */
  private getRemainingTimeout(): number {
    if (this.openedAt === null) {
      return 0;
    }
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.config.timeout - elapsed);
  }

  /**
   * 모니터링 윈도우 밖의 오래된 실패 기록 제거
   */
  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.config.monitoringWindow;
    this.failures = this.failures.filter(f => f.timestamp >= cutoff);
  }

  /**
   * 모니터링 윈도우 내 최근 실패 횟수 반환
   */
  private getRecentFailureCount(): number {
    const cutoff = Date.now() - this.config.monitoringWindow;
    return this.failures.filter(f => f.timestamp >= cutoff).length;
  }
}
