/**
 * @fileoverview 문서 인식 결과 검증기 (RecognitionValidator)
 * @description 문서 인식기가 수행한 텍스트 추출의 결과를 검증한다. 손상 파일 감지,
 * 처리 시간 초과(120초), 인식 텍스트 최소 길이(20자) 조건을 판정하고, 각 실패
 * 상황에 맞는 표준 오류 응답과 사용자 복구 옵션(재업로드/재시도/직접입력)을 생성한다.
 *
 * @requirements 1.8 - 손상 파일 감지 시 오류 반환 및 재업로드 옵션(부분 결과 미저장)
 * @requirements 1.9 - 120초 타임아웃 시 시간 초과 오류 및 재시도 옵션(중간 결과 미저장)
 * @requirements 1.10 - 인식 텍스트 20자 미만이면 recognitionStatus=failed, 재업로드/직접입력 옵션
 */

import { ErrorSeverity, type ErrorResponse } from '../../../common/interfaces/service-module.js';

/** 문서 인식 처리 제한 시간 (밀리초, 요구사항 1.9) */
export const RECOGNITION_TIMEOUT_MS = 120_000;

/** 인식 텍스트 최소 유효 길이 (문자 수, 요구사항 1.10) */
export const MIN_RECOGNIZED_TEXT_LENGTH = 20;

/** 문서 인식 상태 */
export type RecognitionStatus = 'success' | 'low_quality' | 'failed';

/** 사용자에게 제공되는 복구 옵션 */
export type RecoveryOption = 'reupload' | 'retry' | 'direct_input';

/**
 * 검증 실패 결과
 *
 * 검증에 실패하면 표준 ErrorResponse와 사용자 복구 옵션을 함께 담아 반환한다.
 * 실패 시 중간/부분 결과를 저장하지 않아야 함을 shouldPersist=false로 명시한다.
 */
export interface RecognitionValidationFailure {
  /** 검증 통과 여부 (실패 시 false) */
  valid: false;
  /** 인식 상태 (실패 시 failed) */
  recognitionStatus: RecognitionStatus;
  /** 표준 오류 응답 */
  error: ErrorResponse;
  /** 사용자에게 제공할 복구 옵션 */
  recoveryOptions: RecoveryOption[];
  /** 결과 저장 여부 (실패 시 항상 false — 부분/중간 결과 미저장) */
  shouldPersist: false;
}

/**
 * 검증 성공 결과
 */
export interface RecognitionValidationSuccess {
  /** 검증 통과 여부 */
  valid: true;
  /** 인식 상태 (20자 이상이면 success) */
  recognitionStatus: 'success';
  /** 결과 저장 가능 여부 */
  shouldPersist: true;
}

/** 검증 결과 (성공 또는 실패) */
export type RecognitionValidationResult =
  | RecognitionValidationSuccess
  | RecognitionValidationFailure;

/**
 * 문서 인식 결과 검증기
 *
 * 파일 손상, 처리 시간 초과, 최소 텍스트 길이 조건을 각각 판정한다.
 * 모든 실패 응답은 부분 결과를 저장하지 않도록(shouldPersist=false) 설계되어 있다.
 */
export class RecognitionValidator {
  private readonly timeoutMs: number;
  private readonly minTextLength: number;

  constructor(
    config: { timeoutMs?: number; minTextLength?: number } = {},
  ) {
    this.timeoutMs = config.timeoutMs ?? RECOGNITION_TIMEOUT_MS;
    this.minTextLength = config.minTextLength ?? MIN_RECOGNIZED_TEXT_LENGTH;
  }

  /**
   * 파일 손상 오류 응답을 생성한다.
   *
   * 파일을 읽거나 디코딩할 수 없을 때 사용하며, 재업로드 옵션을 제공하고
   * 부분 결과를 저장하지 않는다.
   *
   * @param detail - 손상 원인 상세 정보 (옵션)
   * @returns 손상 파일 검증 실패 결과
   * @requirements 1.8
   */
  buildCorruptedFileFailure(detail?: string): RecognitionValidationFailure {
    return {
      valid: false,
      recognitionStatus: 'failed',
      error: this.createError(
        'DOCUMENT_CORRUPTED',
        '업로드한 파일이 손상되어 읽을 수 없습니다. 파일을 확인하신 후 다시 업로드해 주세요.',
        ErrorSeverity.MEDIUM,
        detail ? { detail } : undefined,
      ),
      recoveryOptions: ['reupload'],
      shouldPersist: false,
    };
  }

  /**
   * 처리 시간 초과 오류 응답을 생성한다.
   *
   * 인식 처리가 120초 이내에 완료되지 않았을 때 사용하며, 재시도 옵션을 제공하고
   * 중간 결과를 저장하지 않는다.
   *
   * @param elapsedMs - 경과 시간(밀리초, 옵션)
   * @returns 시간 초과 검증 실패 결과
   * @requirements 1.9
   */
  buildTimeoutFailure(elapsedMs?: number): RecognitionValidationFailure {
    return {
      valid: false,
      recognitionStatus: 'failed',
      error: this.createError(
        'RECOGNITION_TIMEOUT',
        '문서 인식 처리가 제한 시간(120초)을 초과했습니다. 잠시 후 다시 시도해 주세요.',
        ErrorSeverity.MEDIUM,
        { timeoutMs: this.timeoutMs, ...(elapsedMs !== undefined ? { elapsedMs } : {}) },
      ),
      recoveryOptions: ['retry'],
      shouldPersist: false,
    };
  }

  /**
   * 경과 시간이 제한 시간을 초과했는지 판별한다.
   *
   * @param elapsedMs - 인식 처리 경과 시간(밀리초)
   * @returns 시간 초과 여부
   */
  isTimeout(elapsedMs: number): boolean {
    return elapsedMs > this.timeoutMs;
  }

  /**
   * 인식 텍스트의 최소 길이 조건을 검증한다.
   *
   * 텍스트를 추출하지 못했거나 길이가 20자 미만이면 recognitionStatus=failed로
   * 판정하고 재업로드/직접입력 옵션을 제공한다. 20자 이상이면 성공으로 판정한다.
   *
   * @param text - 인식된 전체 텍스트
   * @returns 검증 결과 (성공/실패)
   * @requirements 1.10
   */
  validateRecognizedText(text: string | null | undefined): RecognitionValidationResult {
    const normalized = text ?? '';
    // 공백을 제외한 실제 문자 수로 판정하여 공백만으로 20자를 채우는 것을 방지한다.
    const effectiveLength = normalized.trim().length;

    if (effectiveLength < this.minTextLength) {
      return {
        valid: false,
        recognitionStatus: 'failed',
        error: this.createError(
          'RECOGNITION_INSUFFICIENT_TEXT',
          '문서에서 충분한 텍스트를 인식하지 못했습니다. 더 선명한 파일로 재업로드하시거나 텍스트를 직접 입력해 주세요.',
          ErrorSeverity.LOW,
          { recognizedLength: effectiveLength, minRequired: this.minTextLength },
        ),
        recoveryOptions: ['reupload', 'direct_input'],
        shouldPersist: false,
      };
    }

    return {
      valid: true,
      recognitionStatus: 'success',
      shouldPersist: true,
    };
  }

  /**
   * 표준 ErrorResponse를 생성한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 대면 한국어 메시지
   * @param severity - 오류 심각도
   * @param context - 추가 컨텍스트 정보 (옵션)
   * @returns 표준 오류 응답
   */
  private createError(
    code: string,
    message: string,
    severity: ErrorSeverity,
    context?: Record<string, unknown>,
  ): ErrorResponse {
    return {
      code,
      message,
      severity,
      timestamp: new Date().toISOString(),
      ...(context ? { context } : {}),
    };
  }
}
