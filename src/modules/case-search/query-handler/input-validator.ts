/**
 * @fileoverview 판례 검색 입력 검증 모듈
 * @description 사용자 상황 설명 입력의 유효성을 검증한다.
 * 길이(20~2000자), 빈 입력, 공백만 입력된 경우를 검증하여
 * 유효하지 않은 입력에 대해 적절한 한국어 오류 메시지를 반환한다.
 * 유효한 입력에 대해서는 정제(trim + normalize whitespace) 처리된 텍스트를 반환한다.
 *
 * @requirements 1.1 - 입력 길이 제한 (20~2000자)
 * @requirements 1.5 - 빈 입력 거부
 */

import type { InputValidationResult } from '../interfaces/index.js';

/** 최소 입력 길이 */
const MIN_LENGTH = 20;

/** 최대 입력 길이 */
const MAX_LENGTH = 2000;

/**
 * 판례 검색 입력 검증기
 *
 * 사용자의 상황 설명 입력이 시스템 요구사항을 충족하는지 검증한다.
 * 검증 순서:
 * 1. null/undefined/빈 문자열 체크
 * 2. 정제(trim + whitespace normalization) 후 빈 문자열 체크
 * 3. 최소 길이 (20자) 체크
 * 4. 최대 길이 (2000자) 체크
 *
 * 검증 성공 시 정제된 입력 텍스트를 반환한다.
 *
 * @requirements 1.1, 1.5
 */
export class CaseSearchInputValidator {
  /**
   * 상황 설명 입력을 검증한다.
   *
   * @param text - 검증할 사용자 상황 설명 문자열
   * @returns 검증 결과 (isValid, errorMessage, sanitizedInput)
   *
   * @example
   * ```typescript
   * const validator = new CaseSearchInputValidator();
   *
   * validator.validate("임대인이 보증금을 돌려주지 않고 있습니다. 계약 만료 후 6개월이 지났습니다.");
   * // { isValid: true, sanitizedInput: "임대인이 보증금을 돌려주지 않고 있습니다. 계약 만료 후 6개월이 지났습니다." }
   *
   * validator.validate("");
   * // { isValid: false, errorMessage: "분쟁 상황을 입력해 주세요." }
   *
   * validator.validate("보증금 반환");
   * // { isValid: false, errorMessage: "분쟁 상황을 20자 이상으로 구체적으로 설명해 주세요." }
   * ```
   */
  validate(text: string): InputValidationResult {
    // null/undefined 또는 빈 문자열 체크
    if (text === null || text === undefined || text === '') {
      return {
        isValid: false,
        errorMessage: '분쟁 상황을 입력해 주세요.',
      };
    }

    // 정제 처리
    const sanitized = this.sanitize(text);

    // 정제 후 빈 문자열 체크 (공백만 입력된 경우)
    if (sanitized.length === 0) {
      return {
        isValid: false,
        errorMessage: '분쟁 상황을 입력해 주세요.',
      };
    }

    // 최소 길이 체크 (20자 미만)
    if (sanitized.length < MIN_LENGTH) {
      return {
        isValid: false,
        errorMessage: '분쟁 상황을 20자 이상으로 구체적으로 설명해 주세요.',
      };
    }

    // 최대 길이 체크 (2000자 초과)
    if (sanitized.length > MAX_LENGTH) {
      return {
        isValid: false,
        errorMessage: '입력은 2000자 이내로 제한됩니다. 핵심 사실관계를 요약해 주세요.',
      };
    }

    return {
      isValid: true,
      sanitizedInput: sanitized,
    };
  }

  /**
   * 입력 텍스트를 정제한다.
   *
   * - 앞뒤 공백 제거 (trim)
   * - 연속 공백을 단일 공백으로 정규화
   * - 연속 줄바꿈을 단일 줄바꿈으로 정규화
   *
   * @param text - 원본 입력 텍스트
   * @returns 정제된 텍스트
   */
  private sanitize(text: string): string {
    return text
      .trim()
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{2,}/g, '\n');
  }
}
