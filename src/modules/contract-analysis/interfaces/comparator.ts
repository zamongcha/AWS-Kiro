/**
 * 비교 분석기 (comparator) 인터페이스 정의
 *
 * 표준계약서와 업로드 계약서를 조항 단위로 대조하여 누락/변경/추가를
 * 식별하는 비교 분석기의 입출력 타입을 정의한다.
 */

import type { ContractType } from './types.js';
import type { RecognizedClause } from './document-recognizer.js';

/**
 * 비교 분석기 입력
 */
export interface ComparatorInput {
  /** 계약 유형 */
  contractType: ContractType;
  /** 업로드된 조항 목록 */
  uploadedClauses: RecognizedClause[];
}

/**
 * 비교 분석기 출력
 */
export interface ComparatorOutput {
  /** 조항 비교 결과 목록 */
  comparisons: ClauseComparison[];
  /** 표준양식 존재 여부 (없으면 비교 생략 안내) */
  standardFormExists: boolean;
  /** 표준양식 버전 */
  standardFormVersion?: number;
}

/**
 * 조항 비교 결과
 */
export interface ClauseComparison {
  /** 차이 유형 (누락 | 변경 | 추가) */
  diffType: 'missing' | 'changed' | 'added';
  /** 표준조항 내용 */
  standardClause?: string;
  /** 업로드조항 내용 */
  uploadedClause?: string;
}
