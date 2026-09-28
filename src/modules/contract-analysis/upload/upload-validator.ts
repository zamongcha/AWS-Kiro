/**
 * @fileoverview 계약서 업로드 파일 검증기
 * @description 업로드된 계약서 파일의 MIME 타입과 크기를 검증한다.
 * 검증에 실패하면 지원 형식/허용 크기 범위를 안내하는 표준 오류 응답을 반환하며,
 * 이 경우 상위 처리기(UploadHandler)는 파일을 저장하지 않고 처리를 중단한다.
 *
 * @requirements 1.1 - 업로드 가능한 파일 크기를 1KB 이상 20MB 이하로 제한
 * @requirements 1.6 - 지원 형식(JPEG/PNG/PDF) 외 파일 거부 및 형식 안내
 * @requirements 1.7 - 허용 크기 범위 벗어난 파일 거부 및 범위 안내
 *
 * Property 3(업로드 파일 형식 검증), Property 4(업로드 파일 크기 경계 검증) 대비.
 */

import type { ErrorResponse } from '../../../common/interfaces/service-module.js';
import { ErrorSeverity } from '../../../common/interfaces/service-module.js';

/** 허용되는 업로드 MIME 타입 목록 (JPEG/PNG/PDF) */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

/** 허용 MIME 타입 유니온 */
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** 최소 허용 파일 크기 (1KB = 1024 바이트, 경계 포함) */
export const MIN_FILE_SIZE_BYTES = 1024;

/** 최대 허용 파일 크기 (20MB = 20 * 1024 * 1024 바이트, 경계 포함) */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** 형식 위반 오류 코드 */
export const ERROR_CODE_UNSUPPORTED_FORMAT = 'CONTRACT_UPLOAD_UNSUPPORTED_FORMAT';

/** 크기 위반 오류 코드 */
export const ERROR_CODE_INVALID_SIZE = 'CONTRACT_UPLOAD_INVALID_SIZE';

/**
 * 업로드 검증 대상 입력
 */
export interface UploadValidationInput {
  /** 업로드 파일 MIME 타입 */
  mimeType: string;
  /** 업로드 파일 크기 (바이트) */
  sizeBytes: number;
}

/**
 * 업로드 검증 결과
 *
 * `valid`가 true이면 검증을 통과한 것이며, false이면 `error`에 표준 오류 응답이 담긴다.
 */
export type UploadValidationResult =
  | { valid: true }
  | { valid: false; error: ErrorResponse };

/**
 * 계약서 업로드 파일 검증기
 *
 * MIME 타입과 파일 크기를 검증하여 지원 형식/허용 크기 범위를 강제한다.
 * 순수 검증 로직만 담당하며, 저장/부수효과는 수행하지 않는다.
 */
export class UploadValidator {
  /**
   * 파일의 MIME 타입과 크기를 함께 검증한다.
   *
   * MIME 타입 검증을 먼저 수행하고, 통과 시 크기 검증을 수행한다.
   *
   * @param input - 검증 대상 (MIME 타입, 크기)
   * @returns 검증 결과 (통과 또는 표준 오류 응답)
   */
  validate(input: UploadValidationInput): UploadValidationResult {
    const mimeResult = this.validateMimeType(input.mimeType);
    if (!mimeResult.valid) {
      return mimeResult;
    }

    return this.validateSize(input.sizeBytes);
  }

  /**
   * MIME 타입이 허용 형식(JPEG/PNG/PDF) 중 하나인지 검증한다.
   *
   * @param mimeType - 검증할 MIME 타입
   * @returns 검증 결과. 위반 시 지원 형식을 안내하는 오류 응답 포함
   */
  validateMimeType(mimeType: string): UploadValidationResult {
    if (this.isAllowedMimeType(mimeType)) {
      return { valid: true };
    }

    return {
      valid: false,
      error: this.buildError(
        ERROR_CODE_UNSUPPORTED_FORMAT,
        `지원하지 않는 파일 형식입니다. JPEG, PNG, PDF 형식만 업로드할 수 있어요. (요청 형식: ${
          mimeType || '알 수 없음'
        })`,
        { mimeType, allowedMimeTypes: [...ALLOWED_MIME_TYPES] },
      ),
    };
  }

  /**
   * 파일 크기가 허용 범위(1KB 이상 20MB 이하)인지 검증한다.
   *
   * 경계값(정확히 1KB, 정확히 20MB)은 허용한다.
   *
   * @param sizeBytes - 검증할 파일 크기 (바이트)
   * @returns 검증 결과. 위반 시 허용 크기 범위를 안내하는 오류 응답 포함
   */
  validateSize(sizeBytes: number): UploadValidationResult {
    const isWithinRange =
      Number.isFinite(sizeBytes) &&
      sizeBytes >= MIN_FILE_SIZE_BYTES &&
      sizeBytes <= MAX_FILE_SIZE_BYTES;

    if (isWithinRange) {
      return { valid: true };
    }

    return {
      valid: false,
      error: this.buildError(
        ERROR_CODE_INVALID_SIZE,
        `허용 파일 크기 범위를 벗어났습니다. 파일 크기는 1KB(1,024바이트) 이상 20MB(${MAX_FILE_SIZE_BYTES.toLocaleString()}바이트) 이하여야 해요. (요청 크기: ${
          Number.isFinite(sizeBytes) ? sizeBytes.toLocaleString() : '알 수 없음'
        }바이트)`,
        {
          sizeBytes,
          minSizeBytes: MIN_FILE_SIZE_BYTES,
          maxSizeBytes: MAX_FILE_SIZE_BYTES,
        },
      ),
    };
  }

  /**
   * MIME 타입이 허용 목록에 포함되는지 판별한다.
   *
   * @param mimeType - 판별할 MIME 타입
   * @returns 허용 여부
   */
  private isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
    return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
  }

  /**
   * 표준 오류 응답(ErrorResponse)을 생성한다.
   *
   * 입력 오류이므로 심각도는 LOW로 분류한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 대면 한국어 메시지
   * @param context - 오류 컨텍스트 정보
   * @returns 표준 오류 응답
   */
  private buildError(
    code: string,
    message: string,
    context: Record<string, unknown>,
  ): ErrorResponse {
    return {
      code,
      message,
      severity: ErrorSeverity.LOW,
      timestamp: new Date().toISOString(),
      context,
    };
  }
}
