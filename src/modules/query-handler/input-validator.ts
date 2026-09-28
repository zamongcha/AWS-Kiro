/**
 * @fileoverview 질문 입력 검증 모듈
 * @description 사용자 질문 입력의 유효성을 검증한다.
 * 길이(10~1000자), 빈 입력, 공백만 입력된 경우를 검증하여
 * 유효하지 않은 입력에 대해 적절한 한국어 오류 메시지를 반환한다.
 *
 * @requirements 6.1 - 입력 길이 제한 (10~1000자)
 * @requirements 6.8 - 빈 입력 거부
 */

/**
 * 입력 검증 결과 인터페이스
 */
export interface InputValidationResult {
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
 * 질문 입력 검증기
 *
 * 사용자의 질문 입력이 시스템 요구사항을 충족하는지 검증한다.
 * 검증 순서:
 * 1. null/undefined 체크
 * 2. 공백 제거 후 빈 문자열 체크
 * 3. 최소 길이 (10자) 체크
 * 4. 최대 길이 (1000자) 체크
 *
 * @requirements 6.1, 6.8
 */
export class InputValidator {
  /**
   * 질문 입력을 검증한다.
   *
   * @param query - 검증할 사용자 질문 문자열
   * @returns 검증 결과 ({ valid: true } 또는 { valid: false, error: string })
   *
   * @example
   * ```typescript
   * const validator = new InputValidator();
   *
   * validator.validate("임대차보호법에서 보증금 반환 기한은 어떻게 되나요?");
   * // { valid: true }
   *
   * validator.validate("");
   * // { valid: false, error: "질문을 입력해 주세요." }
   *
   * validator.validate("안녕");
   * // { valid: false, error: "질문은 10자 이상으로 입력해 주세요." }
   * ```
   */
  validate(query: string): InputValidationResult {
    // null/undefined 또는 빈 문자열 체크
    if (query === null || query === undefined) {
      return { valid: false, error: '질문을 입력해 주세요.' };
    }

    // 공백만 입력된 경우 체크
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: '질문을 입력해 주세요.' };
    }

    // 최소 길이 체크 (10자 미만)
    if (trimmed.length < MIN_LENGTH) {
      return { valid: false, error: '질문은 10자 이상으로 입력해 주세요.' };
    }

    // 최대 길이 체크 (1000자 초과)
    if (trimmed.length > MAX_LENGTH) {
      return { valid: false, error: '질문은 1000자 이하로 입력해 주세요.' };
    }

    return { valid: true };
  }
}
