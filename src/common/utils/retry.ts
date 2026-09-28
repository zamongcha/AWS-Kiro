/**
 * @fileoverview 재시도 정책 및 유틸리티 모듈
 * @description 외부 API 호출 시 지수 백오프/고정 간격 재시도 로직을 제공한다.
 * - 지수 백오프: delay = baseDelay * 2^attempt (maxDelay로 상한)
 * - 고정 간격: delay = baseDelay (일정)
 * - 지터(jitter) 추가로 썬더링 허드 방지
 *
 * @requirements 1.5 - 모든 외부 API 호출에 대해 지수 백오프 재시도 정책 적용, 3회 실패 시 대체 응답
 * @requirements 2.5 - API 호출 실패 시 최대 3회 재시도, 전체 실패 시 사용자에게 에러 메시지
 */

/**
 * 백오프 유형 정의
 * - exponential: 지수 백오프 (delay = baseDelay * 2^attempt)
 * - fixed: 고정 간격 (delay = baseDelay)
 */
export type BackoffType = 'exponential' | 'fixed';

/**
 * 재시도 정책 인터페이스
 * 외부 API 호출 실패 시 재시도 동작을 정의한다.
 */
export interface RetryPolicy {
  /** 최대 재시도 횟수 */
  maxAttempts: number;
  /** 기본 대기 시간 (밀리초) */
  baseDelay: number;
  /** 최대 대기 시간 (밀리초) */
  maxDelay: number;
  /** 백오프 유형 */
  backoffType: BackoffType;
  /** 재시도 대상 에러 타입 목록 (미지정 시 모든 에러 재시도) */
  retryableErrors?: string[];
}

/**
 * 재시도 실패 시 누적된 에러 정보를 담는 클래스
 */
export class RetryExhaustedError extends Error {
  /** 모든 시도에서 발생한 에러 목록 */
  public readonly attempts: Error[];
  /** 총 시도 횟수 */
  public readonly totalAttempts: number;

  constructor(attempts: Error[], policy: RetryPolicy) {
    const lastError = attempts[attempts.length - 1];
    super(
      `최대 재시도 횟수(${policy.maxAttempts}회) 초과. 마지막 에러: ${lastError?.message ?? '알 수 없음'}`
    );
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.totalAttempts = attempts.length;
  }
}

/**
 * 기본 재시도 정책
 * - 최대 3회 시도, 지수 백오프, 1초 초기 간격, 최대 30초
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffType: 'exponential',
};

/**
 * 법령 수집기 전용 재시도 정책
 * - 5초 초기 간격, 지수 백오프(배수 2), 최대 3회
 */
export const LAW_COLLECTOR_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelay: 5000,
  maxDelay: 40000,
  backoffType: 'exponential',
};

/**
 * 판례 수집기 전용 재시도 정책
 * - 30초 고정 간격, 최대 3회
 */
export const CASE_COLLECTOR_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelay: 30000,
  maxDelay: 30000,
  backoffType: 'fixed',
};

/**
 * 지터(jitter)를 추가한 대기 시간 계산
 * 썬더링 허드(thundering herd) 문제를 방지하기 위해 대기 시간에 무작위 변동을 추가한다.
 *
 * @param baseDelay - 기본 대기 시간 (밀리초)
 * @returns 지터가 적용된 대기 시간 (밀리초)
 */
function addJitter(baseDelay: number): number {
  // ±25% 범위의 지터 추가
  const jitterFactor = 0.75 + Math.random() * 0.5;
  return Math.floor(baseDelay * jitterFactor);
}

/**
 * 현재 시도 횟수에 따른 대기 시간 계산
 *
 * @param attempt - 현재 시도 횟수 (0-based)
 * @param policy - 재시도 정책
 * @returns 지터가 적용된 대기 시간 (밀리초)
 */
export function calculateDelay(attempt: number, policy: RetryPolicy): number {
  let delay: number;

  if (policy.backoffType === 'exponential') {
    // 지수 백오프: baseDelay * 2^attempt
    delay = policy.baseDelay * Math.pow(2, attempt);
  } else {
    // 고정 간격
    delay = policy.baseDelay;
  }

  // maxDelay로 상한 제한
  delay = Math.min(delay, policy.maxDelay);

  // 지터 추가
  return addJitter(delay);
}

/**
 * 주어진 에러가 재시도 대상인지 판별
 *
 * @param error - 발생한 에러
 * @param policy - 재시도 정책
 * @returns 재시도 가능 여부
 */
function isRetryable(error: unknown, policy: RetryPolicy): boolean {
  // retryableErrors가 지정되지 않으면 모든 에러를 재시도 대상으로 처리
  if (!policy.retryableErrors || policy.retryableErrors.length === 0) {
    return true;
  }

  if (error instanceof Error) {
    return policy.retryableErrors.includes(error.name);
  }

  return false;
}

/**
 * 지정된 시간(밀리초) 동안 대기하는 유틸리티
 *
 * @param ms - 대기 시간 (밀리초)
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 재시도 정책을 적용하여 비동기 함수를 실행한다.
 * 실패 시 정책에 따라 재시도하며, 최대 시도 횟수 초과 시 누적된 에러 정보를 포함한 예외를 던진다.
 *
 * @template T - 함수의 반환 타입
 * @param fn - 실행할 비동기 함수
 * @param policy - 적용할 재시도 정책 (기본값: DEFAULT_RETRY_POLICY)
 * @returns 함수 실행 결과
 * @throws {RetryExhaustedError} 최대 재시도 횟수 초과 시
 *
 * @example
 * ```typescript
 * const result = await executeWithRetry(
 *   () => fetchLawData(),
 *   LAW_COLLECTOR_RETRY_POLICY
 * );
 * ```
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Promise<T> {
  const errors: Error[] = [];

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const normalizedError = error instanceof Error
        ? error
        : new Error(String(error));

      errors.push(normalizedError);

      // 마지막 시도이면 재시도하지 않음
      if (attempt >= policy.maxAttempts - 1) {
        break;
      }

      // 재시도 대상이 아닌 에러이면 즉시 실패
      if (!isRetryable(error, policy)) {
        break;
      }

      // 대기 시간 계산 후 대기
      const delay = calculateDelay(attempt, policy);
      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(errors, policy);
}
