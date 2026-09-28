/**
 * 예규/심판례 수집 모듈 인터페이스 정의
 *
 * 국세법령정보시스템에서 수집하는 유권해석, 예규, 심판례
 * 데이터의 입출력과 구조를 정의한다.
 */

import type { TaxType } from './tax-types.js';

/**
 * 예규/심판례 문서 유형
 */
export type RulingType =
  | 'authoritative_interpretation'  // 유권해석
  | 'ruling'                         // 예규
  | 'tribunal_decision';             // 심판례

/**
 * 예규/심판례 인터페이스
 *
 * 수집된 예규/심판례의 구조화된 데이터를 나타낸다.
 */
export interface TaxRuling {
  /** 문서번호 */
  documentNumber: string;
  /** 회신일자 (ISO 8601) */
  replyDate: string;
  /** 문서 유형 */
  documentType: RulingType;
  /** 세목 분류 */
  taxCategory: TaxType;
  /** 질의 요지 */
  querySummary: string;
  /** 회신 내용 */
  replyContent: string;
  /** 참조 세법 조항 목록 */
  referencedLawArticles: string[];
  /** 메타데이터 */
  metadata: {
    /** 예규 고유 ID */
    rulingId: string;
    /** 데이터 출처 */
    source: string;
    /** 수집 시각 (ISO 8601) */
    collectedAt: string;
  };
}

/**
 * 예규 수집기 입력 인터페이스
 */
export interface RulingCollectorInput {
  /** 수집 대상 세목 카테고리 */
  targetCategories: TaxType[];
  /** 수집 시작 일자 (ISO 8601) */
  dateFrom?: string;
}

/**
 * 예규 수집 실패 항목 인터페이스
 */
export interface RulingFailedItem {
  /** 항목 식별자 */
  itemId: string;
  /** 오류 메시지 */
  error: string;
  /** 재시도 가능 여부 */
  retryable: boolean;
}

/**
 * 예규 수집기 출력 인터페이스
 */
export interface RulingCollectorOutput {
  /** 수집 건수 */
  collectedCount: number;
  /** 중복 건수 */
  duplicateCount: number;
  /** 실패 항목 목록 */
  failedItems: RulingFailedItem[];
  /** 마지막 동기화 시각 (ISO 8601) */
  lastSyncTimestamp: string;
}
