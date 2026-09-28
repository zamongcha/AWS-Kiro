/**
 * DynamoDB 레코드 타입 정의
 *
 * 계약서 분석 모듈이 기존 DynamoDB 테이블을 공유하며, 파티션 키에
 * `CONTRACT#` 접두사를 사용하여 데이터를 논리적으로 분리한다. 계약서 문서,
 * 버전, 분석 결과, 룰셋/표준계약서 메타데이터, 시스템 설정 레코드 타입을
 * 정의한다.
 */

import type { ContractType, PartyPerspective, RiskGrade } from './types.js';

/**
 * 계약서 문서 레코드
 *
 * PK: `CONTRACT#DOC#{documentId}`, SK: `METADATA`
 */
export interface ContractDocumentRecord {
  /** 파티션 키 (CONTRACT#DOC#{documentId}) */
  PK: string;
  /** 정렬 키 (METADATA) */
  SK: string;
  /** 문서 식별자 */
  documentId: string;
  /** 원본 S3 키 */
  s3Key: string;
  /** 계약 유형 */
  contractType?: ContractType;
  /** 당사자 관점 */
  perspective?: PartyPerspective;
  /** 처리 상태 */
  status: 'uploaded' | 'recognizing' | 'analyzing' | 'completed' | 'error';
  /** 생성 일시 */
  createdAt: string;
  /** TTL (오류 시 24시간 보존) */
  ttl: number;
}

/**
 * 계약서 버전 레코드
 *
 * PK: `CONTRACT#{documentId}`, SK: `VERSION#{zeroPaddedVersion}`
 */
export interface ContractVersionRecord {
  /** 파티션 키 (CONTRACT#{documentId}) */
  PK: string;
  /** 정렬 키 (VERSION#000001) */
  SK: string;
  /** 버전 번호 (1부터 1씩 증가) */
  versionNumber: number;
  /** 저장 일시 (YYYY-MM-DD HH:mm:ss) */
  savedAt: string;
  /** 버전 계약서 내용 */
  content: string;
  /** 종합 위험도 등급 */
  overallGrade: RiskGrade;
}

/**
 * 분석 결과 레코드
 *
 * PK: `CONTRACT#DOC#{documentId}`, SK: `ANALYSIS#{timestamp}`
 */
export interface ContractAnalysisRecord {
  /** 파티션 키 (CONTRACT#DOC#{documentId}) */
  PK: string;
  /** 정렬 키 (ANALYSIS#{timestamp}) */
  SK: string;
  /** 종합 위험도 등급 */
  overallGrade: RiskGrade;
  /** 위험 조항 수 */
  riskClauseCount: number;
  /** 전세사기 위험 점수 (해당 시) */
  fraudScore?: number;
}

/**
 * 룰셋/표준계약서 메타데이터 레코드
 *
 * PK: `CONTRACT#RULESET#{contractType}` / `CONTRACT#STANDARD#{contractType}`,
 * SK: `version#{n}`
 */
export interface RuleSetMetadataRecord {
  /** 파티션 키 (CONTRACT#RULESET#jeonse 등) */
  PK: string;
  /** 정렬 키 (version#3) */
  SK: string;
  /** 단조 증가 버전 번호 */
  version: number;
  /** 갱신 시각 (UTC ISO 8601) */
  updatedAt: string;
  /** 벡터 적재 상태 */
  vectorStatus: 'completed' | 'partial' | 'failed';
  /** 적재 실패 패턴 목록 */
  failedPatterns: string[];
}

/**
 * 시스템 설정 레코드
 *
 * PK: `CONTRACT#CONFIG`, SK: `fraud_threshold`
 */
export interface ContractConfigRecord {
  /** 파티션 키 (CONTRACT#CONFIG) */
  PK: string;
  /** 정렬 키 (fraud_threshold) */
  SK: string;
  /** 전세사기 위험 점수 임계값 (기본 70) */
  fraudScoreThreshold: number;
}
