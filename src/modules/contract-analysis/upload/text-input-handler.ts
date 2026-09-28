/**
 * @fileoverview 직접 텍스트 입력 처리기 (TextInputHandler)
 * @description 사용자가 파일 업로드 대신 계약서 텍스트를 직접 입력하는 경로를 처리한다.
 * 문서 인식(OCR) 단계를 건너뛰고, 입력 텍스트를 인식 결과로 간주하여 최소 길이 검증
 * (20자)과 조항 분할을 수행한 뒤 인식 결과 페이로드를 구성한다.
 *
 * 문서 인식기(DocumentRecognizerModule)와 동일한 검증기(RecognitionValidator)와
 * 조항 분할기(ClauseSplitter)를 재사용하여 두 입력 경로(파일/직접입력)의 결과 구조를
 * 일관되게 유지한다.
 *
 * @requirements 1.12 - 사용자가 텍스트를 직접 입력하는 방식의 계약서 분석 입력 수단 제공
 * @requirements 1.4 - 입력 텍스트를 최대 1000개 조항으로 분할, 위치 정보 부여
 * @requirements 1.10 - 20자 미만이면 recognitionStatus=failed, 재업로드/직접입력 옵션
 */

import type { DocumentRecognizerOutput } from '../interfaces/document-recognizer.js';
import { ClauseSplitter } from '../document-recognizer/clause-splitter.js';
import {
  RecognitionValidator,
  type RecognitionValidationFailure,
} from '../document-recognizer/recognition-validator.js';

/**
 * 직접 텍스트 입력 요청
 */
export interface TextInputRequest {
  /** 문서 식별자 */
  documentId: string;
  /** 사용자가 직접 입력한 계약서 텍스트 */
  text: string;
}

/**
 * 직접 텍스트 입력 처리 성공 결과
 */
export interface TextInputSuccess {
  /** 성공 여부 */
  success: true;
  /** 문서 인식기와 동일한 형태의 출력 (조항 분할 포함) */
  output: DocumentRecognizerOutput;
}

/**
 * 직접 텍스트 입력 처리 실패 결과
 */
export interface TextInputFailure {
  /** 성공 여부 */
  success: false;
  /** 검증 실패 상세 (표준 오류 응답 + 복구 옵션) */
  failure: RecognitionValidationFailure;
}

/** 직접 텍스트 입력 처리 결과 */
export type TextInputResult = TextInputSuccess | TextInputFailure;

/**
 * 직접 텍스트 입력 처리기 설정
 */
export interface TextInputHandlerConfig {
  /** 주입할 조항 분할기 (기본 새 인스턴스) */
  clauseSplitter?: ClauseSplitter;
  /** 주입할 인식 결과 검증기 (기본 새 인스턴스) */
  validator?: RecognitionValidator;
}

/**
 * 직접 텍스트 입력 처리기
 *
 * 입력 텍스트를 인식 결과로 간주하여 최소 길이 검증 후 조항 단위로 분할한다.
 * OCR 제공자를 호출하지 않으므로 좌표(hasCoordinates)는 항상 false이다.
 */
export class TextInputHandler {
  private readonly clauseSplitter: ClauseSplitter;
  private readonly validator: RecognitionValidator;

  constructor(config: TextInputHandlerConfig = {}) {
    this.clauseSplitter = config.clauseSplitter ?? new ClauseSplitter();
    this.validator = config.validator ?? new RecognitionValidator();
  }

  /**
   * 직접 입력된 텍스트를 처리하여 인식 결과 출력으로 변환한다.
   *
   * @param request - 직접 텍스트 입력 요청 (documentId, text)
   * @returns 성공 시 조항 분할이 포함된 출력, 실패 시 검증 실패 결과
   */
  handle(request: TextInputRequest): TextInputResult {
    const startedAt = Date.now();

    // 20자 미만 등 최소 길이 조건 검증 (요구사항 1.10)
    const validation = this.validator.validateRecognizedText(request.text);
    if (!validation.valid) {
      return { success: false, failure: validation };
    }

    // 조항 단위 분할 (요구사항 1.4)
    const clauses = this.clauseSplitter.split(request.text);

    const output: DocumentRecognizerOutput = {
      documentId: request.documentId,
      fullText: request.text,
      clauses,
      hasCoordinates: false,
      recognitionStatus: 'success',
      processingTimeMs: Date.now() - startedAt,
    };

    return { success: true, output };
  }
}
