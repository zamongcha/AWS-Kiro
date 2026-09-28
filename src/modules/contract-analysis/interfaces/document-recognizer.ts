/**
 * 문서 인식기 (document-recognizer) 인터페이스 정의
 *
 * 업로드된 계약서 파일을 텍스트로 인식하고 조항 단위로 분할하는
 * 문서 인식기의 입출력 타입과 OCR 제공자 어댑터 인터페이스를 정의한다.
 */

import type { BoundingBox } from './types.js';

/**
 * 문서 인식기 입력
 */
export interface DocumentRecognizerInput {
  /** 문서 식별자 */
  documentId: string;
  /** 원본 파일 S3 키 */
  s3Key: string;
  /** 파일 MIME 타입 */
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  /** OCR 모드 (로컬:multimodal / 배포 옵션:textract_precise) */
  ocrMode: 'multimodal' | 'textract_precise';
}

/**
 * 문서 인식기 출력
 */
export interface DocumentRecognizerOutput {
  /** 문서 식별자 */
  documentId: string;
  /** 전체 인식 텍스트 */
  fullText: string;
  /** 분할된 조항 목록 (최대 1000개) */
  clauses: RecognizedClause[];
  /** Textract 좌표 존재 여부 */
  hasCoordinates: boolean;
  /** 인식 상태 */
  recognitionStatus: 'success' | 'low_quality' | 'failed';
  /** 처리 소요 시간 (ms) */
  processingTimeMs: number;
}

/**
 * 인식된 조항
 */
export interface RecognizedClause {
  /** 문서 내 중복되지 않는 식별자 */
  clauseId: string;
  /** 조항 원문 */
  text: string;
  /** 원문 내 순서 */
  order: number;
  /** 원문 내 시작 위치 */
  startOffset: number;
  /** 원문 내 끝 위치 */
  endOffset: number;
  /** Textract 좌표 (옵션) */
  boundingBox?: BoundingBox;
}

/**
 * OCR 제공자 어댑터 인터페이스
 *
 * Gemini Vision / AWS Textract / Mock 등 교체 가능한 제공자를 추상화한다.
 */
export interface OcrProvider {
  /** 텍스트 추출 수행 */
  extractText(input: OcrRequest): Promise<OcrResult>;
}

/**
 * OCR 요청
 */
export interface OcrRequest {
  /** 문서 식별자 */
  documentId: string;
  /** 원본 파일 S3 키 */
  s3Key: string;
  /** 파일 MIME 타입 */
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
}

/**
 * OCR 결과
 */
export interface OcrResult {
  /** 추출된 텍스트 */
  text: string;
  /** 좌표 포함 블록 (Textract만) */
  blocks?: OcrBlock[];
}

/**
 * OCR 블록 (좌표 포함)
 */
export interface OcrBlock {
  /** 블록 텍스트 */
  text: string;
  /** 블록 좌표 */
  boundingBox: BoundingBox;
}
