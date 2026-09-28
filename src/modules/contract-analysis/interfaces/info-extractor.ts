/**
 * 정보 추출기 (info-extractor) 인터페이스 정의
 *
 * 계약서 텍스트에서 보증금·월세·매매가·관리비·계약기간·당사자·소재지·면적을
 * 구조화 추출하고 단위를 부여하는 추출기의 입출력 타입을 정의한다.
 */

import type { ContractType } from './types.js';

/**
 * 정보 추출기 입력
 */
export interface InfoExtractorInput {
  /** 문서 식별자 */
  documentId: string;
  /** 전체 인식 텍스트 */
  fullText: string;
  /** 계약 유형 */
  contractType: ContractType;
}

/**
 * 정보 추출기 출력
 */
export interface InfoExtractorOutput {
  /** 추출된 필드 목록 */
  extractedFields: ExtractedField[];
  /** 추출 상태 */
  extractionStatus: 'success' | 'partial' | 'failed';
}

/**
 * 추출된 필드
 */
export interface ExtractedField {
  /** 필드명 (보증금/월세/매매가/관리비/계약기간/당사자/소재지/면적) */
  fieldName: string;
  /** 필드 값 */
  value: string | number | null;
  /** 단위 (금액=원, 면적=제곱미터, 기간=개월) */
  unit?: 'KRW' | 'sqm' | 'month';
  /** 확인 불가 시 false → "확인 불가" 표시 */
  isConfirmable: boolean;
}
