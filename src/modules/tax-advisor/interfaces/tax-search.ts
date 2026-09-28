/**
 * 세무 검색 모듈 인터페이스 정의
 *
 * 세법 및 예규/심판례 벡터 검색의 입출력과
 * 수치 정보 추출 결과를 정의한다.
 */

import type { TaxType } from './tax-types.js';

/**
 * 세무 검색 입력 인터페이스
 */
export interface TaxSearchInput {
  /** 사용자 질문 */
  query: string;
  /** 이전 대화 컨텍스트 */
  sessionContext?: string[];
  /** 최대 결과 수 (기본 5) */
  maxResults?: number;
}

/**
 * 세무 검색 결과 문서 인터페이스
 */
export interface TaxSearchResult {
  /** 문서 고유 ID */
  documentId: string;
  /** 문서 유형 */
  documentType: 'tax_law' | 'ruling';
  /** 문서 내용 */
  content: string;
  /** 유사도 점수 (0.0~1.0) */
  similarityScore: number;
  /** 관련도 기준 미달 여부 */
  isLowRelevance: boolean;
  /** 문서 메타데이터 */
  metadata: {
    /** 문서 제목 */
    title: string;
    /** 출처 */
    source: string;
    /** 일자 (ISO 8601) */
    date: string;
    /** 세목 분류 */
    taxType: TaxType;
    /** 추가 메타데이터 */
    [key: string]: unknown;
  };
}

/**
 * 추출된 수치 정보 인터페이스
 *
 * 질문 텍스트에서 추출한 세무 관련 수치 정보를 나타낸다.
 */
export interface ExtractedNumericInfo {
  /** 금액 (매매가, 취득가 등, 원 단위) */
  amount?: number;
  /** 면적 (㎡) */
  area?: number;
  /** 보유기간 (년) */
  holdingPeriod?: number;
  /** 부동산 유형 */
  propertyType?: string;
  /** 보유 주택 수 */
  housingCount?: number;
  /** 공시가격 (원) */
  officialPrice?: number;
  /** 취득가액 (원) */
  acquisitionPrice?: number;
  /** 양도가액 (원) */
  transferPrice?: number;
}

/**
 * 세무 검색 출력 인터페이스
 */
export interface TaxSearchOutput {
  /** 관련 세법 문서 목록 */
  taxLawDocuments: TaxSearchResult[];
  /** 관련 예규/심판례 문서 목록 */
  rulingDocuments: TaxSearchResult[];
  /** 분해된 세목 목록 */
  decomposedTaxTypes?: TaxType[];
  /** 추출된 수치 정보 */
  extractedNumerics?: ExtractedNumericInfo;
}
