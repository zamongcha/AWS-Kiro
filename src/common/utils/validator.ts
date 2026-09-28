/**
 * @fileoverview 입력 검증 유틸리티 모듈
 * @description 사용자 입력의 유효성을 검증하고 위험한 내용을 정화(sanitize)하는 기능을 제공한다.
 *
 * 주요 기능:
 * - 문자열 길이 검증
 * - 빈 값 검증
 * - 질문 입력 종합 검증 (길이, 스크립트 인젝션, 빈 문자열)
 * - 입력 정화 (XSS 방지, 트림)
 */

/**
 * 질문 입력 검증 결과 인터페이스
 */
export interface ValidationResult {
  /** 검증 통과 여부 */
  valid: boolean;
  /** 검증 실패 사유 목록 */
  errors: string[];
}

/**
 * 문자열 길이가 지정된 범위 내에 있는지 검증한다.
 *
 * @param value - 검증할 문자열
 * @param min - 최소 길이 (포함)
 * @param max - 최대 길이 (포함)
 * @returns 범위 내이면 true, 아니면 false
 *
 * @example
 * ```typescript
 * validateStringLength("안녕하세요", 1, 100); // true
 * validateStringLength("", 1, 100);           // false
 * ```
 */
export function validateStringLength(value: string, min: number, max: number): boolean {
  const length = value.length;
  return length >= min && length <= max;
}

/**
 * 값이 비어 있지 않은지 검증한다.
 *
 * 다음 경우를 빈 값으로 판정한다:
 * - null, undefined
 * - 빈 문자열 또는 공백만으로 구성된 문자열
 * - 빈 배열
 * - 빈 객체
 *
 * @param value - 검증할 값
 * @returns 비어 있지 않으면 true, 비어 있으면 false
 *
 * @example
 * ```typescript
 * validateNotEmpty("부동산 질문");  // true
 * validateNotEmpty("");             // false
 * validateNotEmpty("   ");          // false
 * validateNotEmpty(null);           // false
 * ```
 */
export function validateNotEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return true;
}

/**
 * 스크립트 인젝션 의심 패턴 목록
 */
const SCRIPT_INJECTION_PATTERNS: RegExp[] = [
  /<script\b[^>]*>/i,
  /<\/script>/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
  /<link\b[^>]*href/i,
  /eval\s*\(/i,
  /document\.(cookie|location|write)/i,
  /window\.(location|open)/i,
];

/**
 * 질문 입력을 종합적으로 검증한다.
 *
 * 검증 항목:
 * 1. 빈 문자열 또는 공백만으로 구성되었는지
 * 2. 길이 범위 (1~2000자)
 * 3. 스크립트 인젝션 패턴 포함 여부
 *
 * @param query - 검증할 질문 문자열
 * @returns 검증 결과 (valid 여부 + 에러 목록)
 *
 * @example
 * ```typescript
 * const result = validateQueryInput("임대차보호법 적용 조건이 무엇인가요?");
 * // { valid: true, errors: [] }
 *
 * const result2 = validateQueryInput("");
 * // { valid: false, errors: ["질문을 입력해 주세요."] }
 * ```
 */
export function validateQueryInput(query: string): ValidationResult {
  const errors: string[] = [];

  // 트림 후 빈 문자열 체크
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    errors.push('질문을 입력해 주세요.');
    return { valid: false, errors };
  }

  // 길이 검증 (1~2000자)
  if (trimmed.length < 1) {
    errors.push('질문은 1자 이상이어야 합니다.');
  }

  if (trimmed.length > 2000) {
    errors.push(`질문은 2000자 이하여야 합니다. (현재 ${trimmed.length}자)`);
  }

  // 스크립트 인젝션 검사
  for (const pattern of SCRIPT_INJECTION_PATTERNS) {
    if (pattern.test(query)) {
      errors.push('허용되지 않는 문자 패턴이 포함되어 있습니다.');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 입력 문자열을 정화(sanitize)한다.
 * 기본적인 XSS 방지 처리와 트림을 수행한다.
 *
 * 처리 항목:
 * - 앞뒤 공백 제거
 * - HTML 특수문자 이스케이프 (<, >, &, ", ')
 * - 널 바이트 제거
 * - 연속 공백을 단일 공백으로 치환
 *
 * @param input - 정화할 입력 문자열
 * @returns 정화된 문자열
 *
 * @example
 * ```typescript
 * sanitizeInput("  <script>alert('xss')</script>  ");
 * // "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;"
 * ```
 */
export function sanitizeInput(input: string): string {
  let sanitized = input;

  // 트림
  sanitized = sanitized.trim();

  // 널 바이트 제거
  sanitized = sanitized.replace(/\0/g, '');

  // HTML 특수문자 이스케이프
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  // 연속 공백을 단일 공백으로 치환
  sanitized = sanitized.replace(/\s+/g, ' ');

  return sanitized;
}
