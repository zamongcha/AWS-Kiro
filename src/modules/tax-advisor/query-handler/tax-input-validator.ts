/**
 * @fileoverview 세무 질문 입력 검증 모듈
 * @description 세무 자문 시스템의 사용자 질문 입력 유효성을 검증한다.
 * 길이(10~1000자), 빈 입력, 공백만 입력된 경우를 검증한다.
 *
 * @requirements 8.1, 8.8
 */

/**
 * 입력 검증 결과 인터페이스
 */
export interface TaxInputValidationResult {
  /** 검증 통과 여부 */
  valid: boolean;
  /** 검증 실패 시 오류 메시지 */
  error?: string;
}

/** 최소 입력 길이 */
const MIN_LENGTH = 10;

/** 최대 입력 길이 */
const MAX_LENGTH = 1000;

/**
 * 세무 질문 입력 검증기
 *
 * 검증 순서:
 * 1. null/undefined 체크
 * 2. 공백 제거 후 빈 문자열 체크
 * 3. 최소 길이 (10자) 체크
 * 4. 최대 길이 (1000자) 체크
 *
 * @requirements 8.1, 8.8
 */
export class TaxInputValidator {
  /**
   * 질문 입력을 검증한다.
   *
   * @param query - 검증할 사용자 질문 문자열
   * @returns 검증 결과
   */
  validate(query: string | null | undefined): TaxInputValidationResult {
    if (query === null || query === undefined) {
      return { valid: false, error: '질문을 입력해 주세요.' };
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: '질문을 입력해 주세요.' };
    }

    if (trimmed.length < MIN_LENGTH) {
      return { valid: false, error: '질문은 10자 이상으로 입력해 주세요.' };
    }

    if (trimmed.length > MAX_LENGTH) {
      return { valid: false, error: '질문은 1000자 이하로 입력해 주세요.' };
    }

    return { valid: true };
  }
}
