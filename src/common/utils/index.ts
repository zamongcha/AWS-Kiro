/**
 * @fileoverview 공통 유틸리티 모듈 진입점
 * @description 모든 유틸리티를 하나의 진입점에서 내보낸다.
 */

// 재시도 유틸리티
export {
  type BackoffType,
  type RetryPolicy,
  RetryExhaustedError,
  DEFAULT_RETRY_POLICY,
  LAW_COLLECTOR_RETRY_POLICY,
  CASE_COLLECTOR_RETRY_POLICY,
  calculateDelay,
  executeWithRetry,
} from './retry.js';

// 에러 처리 유틸리티
export {
  ErrorSeverity,
  AppError,
  classifyError,
  createErrorResponse,
  isRetryableError,
} from './error-handler.js';

// Circuit Breaker
export {
  type CircuitBreakerConfig,
  CircuitBreakerState,
  type CircuitBreakerStats,
  CircuitBreakerOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  CircuitBreaker,
} from './circuit-breaker.js';

// 입력 검증 유틸리티
export {
  type ValidationResult,
  validateStringLength,
  validateNotEmpty,
  validateQueryInput,
  sanitizeInput,
} from './validator.js';
