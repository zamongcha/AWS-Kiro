/**
 * @fileoverview 오류 처리 유틸리티 모듈
 * @description 오류 분류, 표준 에러 응답 생성, 재시도 가능 여부 판별 기능을 제공한다.
 * AWS SDK 에러, 네트워크 에러, 유효성 검증 에러를 체계적으로 처리한다.
 *
 * 오류 분류 체계:
 * - Critical: 시스템 장애 (즉시 알림 + 서비스 중단)
 * - High: 외부 API 실패 (재시도 + 알림)
 * - Medium: 부분 실패 (로깅 + 계속 진행)
 * - Low: 입력 오류 (사용자 안내)
 */

import { ErrorSeverity, ErrorResponse } from '../interfaces/service-module.js';

// ErrorSeverity를 재내보내기하여 이 모듈에서도 접근 가능하게 함
export { ErrorSeverity } from '../interfaces/service-module.js';

/**
 * 애플리케이션 커스텀 에러 클래스
 * 표준 Error를 확장하여 에러 코드, 심각도, 컨텍스트, 재시도 가능 여부를 포함한다.
 */
export class AppError extends Error {
  /** 에러 코드 (예: 'NETWORK_ERROR', 'VALIDATION_ERROR') */
  public readonly code: string;
  /** 에러 심각도 */
  public readonly severity: ErrorSeverity;
  /** 에러 발생 컨텍스트 정보 */
  public readonly context: Record<string, unknown>;
  /** 에러 발생 시각 */
  public readonly timestamp: string;
  /** 재시도 가능 여부 */
  public readonly isRetryable: boolean;

  constructor(params: {
    message: string;
    code: string;
    severity: ErrorSeverity;
    context?: Record<string, unknown>;
    isRetryable?: boolean;
    cause?: Error;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.severity = params.severity;
    this.context = params.context ?? {};
    this.timestamp = new Date().toISOString();
    this.isRetryable = params.isRetryable ?? false;

    if (params.cause) {
      this.cause = params.cause;
    }
  }
}

/**
 * AWS SDK 에러 이름 목록 (재시도 가능)
 */
const RETRYABLE_AWS_ERRORS: Set<string> = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'InternalServerError',
  'RequestTimeout',
  'RequestTimeoutException',
  'IDPCommunicationError',
  'EC2ThrottledException',
  'TransactionInProgressException',
  'RequestLimitExceeded',
  'BandwidthLimitExceeded',
  'ProvisionedThroughputExceededException',
]);

/**
 * 네트워크 관련 에러 코드 목록
 */
const NETWORK_ERROR_CODES: Set<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ECONNABORTED',
]);

/**
 * 에러의 심각도를 분류한다.
 *
 * 분류 기준:
 * - Critical: 시스템 연결 불가 (OpenSearch, DynamoDB 등)
 * - High: 외부 API 실패, AWS SDK 에러
 * - Medium: 부분 실패, 타임아웃
 * - Low: 유효성 검증 실패, 입력 오류
 *
 * @param error - 분류할 에러
 * @returns 에러 심각도
 */
export function classifyError(error: unknown): ErrorSeverity {
  // AppError인 경우 이미 분류된 심각도 반환
  if (error instanceof AppError) {
    return error.severity;
  }

  if (!(error instanceof Error)) {
    return ErrorSeverity.LOW;
  }

  const errorName = error.name;
  const errorMessage = error.message.toLowerCase();

  // Critical: 시스템 연결 불가
  if (isSystemConnectionError(error)) {
    return ErrorSeverity.CRITICAL;
  }

  // High: AWS SDK 에러 (스로틀링, 서비스 불가)
  if (RETRYABLE_AWS_ERRORS.has(errorName)) {
    return ErrorSeverity.HIGH;
  }

  // High: 네트워크 에러
  if (isNetworkError(error)) {
    return ErrorSeverity.HIGH;
  }

  // Medium: 타임아웃
  if (errorMessage.includes('timeout') || errorName === 'TimeoutError') {
    return ErrorSeverity.MEDIUM;
  }

  // Medium: 부분 실패
  if (errorMessage.includes('partial') || errorMessage.includes('일부')) {
    return ErrorSeverity.MEDIUM;
  }

  // Low: 유효성 검증 에러
  if (
    errorName === 'ValidationError' ||
    errorName === 'TypeError' ||
    errorName === 'RangeError' ||
    errorMessage.includes('validation') ||
    errorMessage.includes('invalid')
  ) {
    return ErrorSeverity.LOW;
  }

  // 기본값: Medium
  return ErrorSeverity.MEDIUM;
}

/**
 * 에러를 표준 ErrorResponse 형식으로 변환한다.
 *
 * @param error - 변환할 에러
 * @returns 표준 에러 응답 객체
 */
export function createErrorResponse(error: unknown): ErrorResponse {
  const timestamp = new Date().toISOString();

  // AppError인 경우
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      severity: error.severity,
      timestamp: error.timestamp,
      context: error.context,
    };
  }

  // 일반 Error인 경우
  if (error instanceof Error) {
    const severity = classifyError(error);
    return {
      code: extractErrorCode(error),
      message: error.message,
      severity,
      timestamp,
      context: {
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      },
    };
  }

  // 알 수 없는 에러
  return {
    code: 'UNKNOWN_ERROR',
    message: String(error),
    severity: ErrorSeverity.MEDIUM,
    timestamp,
  };
}

/**
 * 에러가 재시도 가능한지 판별한다.
 *
 * 재시도 가능한 에러:
 * - AWS SDK 스로틀링/서비스 불가 에러
 * - 네트워크 연결 에러
 * - 타임아웃 에러
 * - AppError.isRetryable = true
 *
 * 재시도 불가능한 에러:
 * - 유효성 검증 에러
 * - 인증/권한 에러
 * - 리소스 미발견 에러
 *
 * @param error - 판별할 에러
 * @returns 재시도 가능 여부
 */
export function isRetryableError(error: unknown): boolean {
  // AppError인 경우 명시적 플래그 사용
  if (error instanceof AppError) {
    return error.isRetryable;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const errorName = error.name;
  const errorMessage = error.message.toLowerCase();

  // AWS SDK 재시도 가능 에러
  if (RETRYABLE_AWS_ERRORS.has(errorName)) {
    return true;
  }

  // 네트워크 에러
  if (isNetworkError(error)) {
    return true;
  }

  // 타임아웃 에러
  if (errorMessage.includes('timeout') || errorName === 'TimeoutError') {
    return true;
  }

  // 재시도 불가: 인증/권한 에러
  if (
    errorName === 'AccessDeniedException' ||
    errorName === 'UnauthorizedException' ||
    errorName === 'ForbiddenException' ||
    errorMessage.includes('access denied') ||
    errorMessage.includes('unauthorized')
  ) {
    return false;
  }

  // 재시도 불가: 유효성 검증 에러
  if (
    errorName === 'ValidationError' ||
    errorName === 'TypeError' ||
    errorMessage.includes('validation')
  ) {
    return false;
  }

  // 재시도 불가: 리소스 미발견
  if (
    errorName === 'ResourceNotFoundException' ||
    errorName === 'NotFoundError' ||
    errorMessage.includes('not found')
  ) {
    return false;
  }

  // 기본값: 재시도 불가
  return false;
}

/**
 * 시스템 연결 불가 에러인지 확인
 */
function isSystemConnectionError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('opensearch') && message.includes('connect') ||
    message.includes('dynamodb') && message.includes('connect') ||
    message.includes('connection refused') && message.includes('system') ||
    error.name === 'OpenSearchConnectionError' ||
    error.name === 'DynamoDBConnectionError'
  );
}

/**
 * 네트워크 에러인지 확인
 */
function isNetworkError(error: Error): boolean {
  // Node.js 네트워크 에러 코드 확인
  const errorCode = (error as NodeJS.ErrnoException).code;
  if (errorCode && NETWORK_ERROR_CODES.has(errorCode)) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    error.name === 'NetworkError'
  );
}

/**
 * Error 객체에서 에러 코드를 추출한다.
 */
function extractErrorCode(error: Error): string {
  // AWS SDK 에러는 name을 코드로 사용
  if (RETRYABLE_AWS_ERRORS.has(error.name)) {
    return `AWS_${error.name.toUpperCase()}`;
  }

  // Node.js 에러 코드
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code) {
    return `NETWORK_${nodeError.code}`;
  }

  // 이름 기반 코드 생성
  return error.name
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
}
