/**
 * 세법 수집 모듈 인터페이스 정의
 *
 * 국가법령정보센터 및 국세법령정보시스템에서 수집하는
 * 세법 데이터의 입출력과 구조를 정의한다.
 */

import type { TaxType } from './tax-types.js';

/**
 * 세법 개정 이력 항목
 */
export interface RevisionEntry {
  /** 개정 일자 (ISO 8601) */
  date: string;
  /** 개정 유형 */
  type: 'enacted' | 'amended' | 'repealed';
  /** 개정 설명 */
  description: string;
}

/**
 * 세법 조항 인터페이스
 *
 * 수집된 세법 조항의 구조화된 데이터를 나타낸다.
 */
export interface TaxLawArticle {
  /** 법령명 (소득세법, 지방세법 등) */
  lawName: string;
  /** 조항 번호 */
  articleNumber: string;
  /** 조항 내용 */
  articleContent: string;
  /** 시행일자 (ISO 8601) */
  effectiveDate: string;
  /** 개정 이력 */
  revisionHistory: RevisionEntry[];
  /** 적용 세목 */
  applicableTaxType: TaxType[];
  /** 세율 테이블 포함 여부 */
  hasRateTable: boolean;
  /** 메타데이터 */
  metadata: {
    /** 법령 고유 ID */
    lawId: string;
    /** 법령 분류 */
    category: string;
    /** 데이터 출처 */
    source: 'MOLEG' | 'NTS';
    /** 수집 시각 (ISO 8601) */
    collectedAt: string;
  };
}

/**
 * 세법 수집기 입력 인터페이스
 */
export interface TaxLawCollectorInput {
  /** 수집 대상 세법 목록 */
  targetLaws: string[];
  /** 강제 갱신 여부 */
  forceUpdate?: boolean;
}

/**
 * 수집 실패 항목 인터페이스
 */
export interface FailedItem {
  /** 항목 식별자 */
  itemId: string;
  /** 오류 메시지 */
  error: string;
  /** 재시도 가능 여부 */
  retryable: boolean;
}

/**
 * 세법 수집기 출력 인터페이스
 */
export interface TaxLawCollectorOutput {
  /** 수집 건수 */
  collectedCount: number;
  /** 갱신 건수 */
  updatedCount: number;
  /** 추출된 세율 테이블 수 */
  rateTablesExtracted: number;
  /** 실패 항목 목록 */
  failedItems: FailedItem[];
  /** 마지막 동기화 시각 (ISO 8601) */
  lastSyncTimestamp: string;
}
