/**
 * 판례 검색 세션 및 이력 데이터 모델 정의
 *
 * DynamoDB에 저장되는 세션 레코드, 대화 항목, 검색 이력 레코드의
 * 인터페이스를 정의한다. 'CASE_SEARCH#' 파티션 키 접두사로 데이터를 격리한다.
 */

import type { DisputeType } from './types.js';
import type { FactAnalysisOutput } from './fact-analysis.js';
import type { CaseAnalysisResponse } from './case-analysis.js';

/**
 * 판례 검색 세션 레코드 인터페이스
 *
 * DynamoDB PK: `CASE_SEARCH#SESSION#{sessionId}`
 * 최대 30개 대화 쌍을 유지하며, 24시간 TTL 기반 자동 만료.
 */
export interface CaseSearchSessionRecord {
  /** 파티션 키: CASE_SEARCH#SESSION#{sessionId} */
  PK: string;
  /** 정렬 키: CREATED#{ISO timestamp} */
  SK: string;
  /** 질문-응답 대화 목록 (최대 30) */
  conversations: CaseSearchConversation[];
  /** 마지막 활동 일시 (ISO 8601) */
  lastActivityAt: string;
  /** TTL (Unix timestamp, 24시간 후 자동 삭제) */
  ttl: number;
}

/**
 * 판례 검색 대화 항목 인터페이스
 *
 * 단일 질문-응답 쌍의 상세 정보를 담는다.
 */
export interface CaseSearchConversation {
  /** 질문 고유 ID */
  questionId: string;
  /** 사용자 상황 설명 */
  situationDescription: string;
  /** 사실관계 분석 결과 */
  factAnalysis: FactAnalysisOutput;
  /** 분석 응답 */
  analysisResponse: CaseAnalysisResponse;
  /** 대화 시각 (ISO 8601) */
  timestamp: string;
  /** 사용자 피드백 */
  feedback?: 'helpful' | 'not_helpful';
}

/**
 * 판례 검색 이력 레코드 인터페이스
 *
 * DynamoDB PK: `CASE_SEARCH#HISTORY#{YYYY-MM-DD}`
 * 검색 이력을 기록하여 서비스 개선에 활용한다.
 */
export interface CaseSearchHistoryRecord {
  /** 파티션 키: CASE_SEARCH#HISTORY#{YYYY-MM-DD} */
  PK: string;
  /** 정렬 키: #{ISO timestamp}#{requestId} */
  SK: string;
  /** 세션 ID */
  sessionId: string;
  /** 분류된 분쟁 유형 */
  disputeTypes: DisputeType[];
  /** 원본 상황 설명 */
  searchQuery: string;
  /** 검색 결과 수 */
  resultCount: number;
  /** 최고 유사도 점수 */
  topSimilarityScore: number;
  /** 처리 소요 시간 (ms) */
  processingTimeMs: number;
}
