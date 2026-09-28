/**
 * 세무 전용 DynamoDB 데이터 모델 정의
 *
 * 기존 법률 자문 시스템의 DynamoDB 테이블을 공유하며,
 * 파티션 키에 "TAX#" 접두사를 사용하여 데이터를 논리적으로 분리한다.
 */

import type { TaxType, TaxBracket, SpecialRate, Deduction } from './tax-types.js';
import type { TaxCitation } from './tax-response.js';
import type { TaxCalculationResult } from './tax-calculator.js';
import type { TaxSavingTip } from './tax-response.js';

/**
 * 세무 대화 항목 인터페이스
 *
 * 단일 질문-답변 쌍과 관련 메타데이터를 나타낸다.
 */
export interface TaxConversationEntry {
  /** 질문 고유 ID */
  questionId: string;
  /** 사용자 질문 */
  question: string;
  /** AI 답변 */
  answer: string;
  /** 인용 목록 */
  citations: TaxCitation[];
  /** 세율 계산 결과 (해당 시) */
  calculationResult?: TaxCalculationResult;
  /** 절세 포인트 목록 */
  taxSavingTips?: TaxSavingTip[];
  /** 대화 시각 (ISO 8601) */
  timestamp: string;
  /** 사용자 피드백 */
  feedback?: 'helpful' | 'not_helpful';
}

/**
 * 세무 세션 레코드 인터페이스
 *
 * DynamoDB에 저장되는 세무 상담 세션 정보를 나타낸다.
 * PK 형식: TAX#SESSION#{sessionId}
 * SK: createdAt (ISO 8601)
 *
 * 대화 이력은 최대 50개를 유지하며, 초과 시 FIFO 방식으로 삭제한다.
 * TTL은 24시간 후 자동 삭제된다.
 */
export interface TaxSessionRecord {
  /** 파티션 키: TAX#SESSION#{sessionId} */
  PK: string;
  /** 정렬 키: createdAt (ISO 8601) */
  SK: string;
  /** 질문-답변 대화 목록 (최대 50개) */
  conversations: TaxConversationEntry[];
  /** 마지막 활동 일시 (ISO 8601) */
  lastActivityAt: string;
  /** TTL (Unix timestamp, 24시간 후 자동 삭제) */
  ttl: number;
}

/**
 * 세무 데이터 관리 레코드 인터페이스
 *
 * 세법/예규 데이터의 관리 상태를 추적한다.
 * PK 형식: TAX#DATA#{dataType} (예: TAX#DATA#law, TAX#DATA#ruling)
 * SK: documentId
 */
export interface TaxDataManagementRecord {
  /** 파티션 키: TAX#DATA#law | TAX#DATA#ruling */
  PK: string;
  /** 정렬 키: documentId */
  SK: string;
  /** 문서 제목 */
  title: string;
  /** 최종 갱신 일시 (ISO 8601) */
  lastUpdated: string;
  /** 벡터 적재 상태 */
  vectorStatus: 'completed' | 'in_progress' | 'failed';
  /** 문서 버전 */
  version: number;
  /** 세목 분류 */
  taxType: TaxType;
  /** 추가 메타데이터 */
  metadata: Record<string, unknown>;
}

/**
 * 세율 테이블 레코드 인터페이스
 *
 * 세율 계산기가 참조하는 구조화된 세율 데이터를 저장한다.
 * PK 형식: TAX#RATE#{taxType} (예: TAX#RATE#acquisition)
 * SK: effectiveDate (ISO 8601)
 *
 * 세법 개정 시 새 버전을 생성하고 이전 버전의 expiryDate를 설정한다.
 */
export interface TaxRateRecord {
  /** 파티션 키: TAX#RATE#{taxType} */
  PK: string;
  /** 정렬 키: effectiveDate (ISO 8601) */
  SK: string;
  /** 세율 테이블 버전 */
  version: number;
  /** 세율 구간 목록 */
  brackets: TaxBracket[];
  /** 특수 세율 목록 */
  specialRates: SpecialRate[];
  /** 공제 항목 목록 */
  deductions: Deduction[];
  /** 근거 세법 조항 */
  sourceArticle: string;
  /** 만료일 (개정 시 설정, ISO 8601) */
  expiryDate?: string;
}
