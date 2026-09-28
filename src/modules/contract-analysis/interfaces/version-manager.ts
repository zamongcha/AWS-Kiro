/**
 * 버전 관리기 (version-manager) 인터페이스 정의
 *
 * 계약서 수정본을 버전으로 저장(action=save)하거나 두 버전을 조항 단위로
 * 비교(action=compare)하는 관리기의 입출력 타입을 정의한다.
 *
 * 버전 유지 정책: 최소 10개 유지, 최대 50개 제한. 50개 초과 시 버전
 * 번호가 가장 낮은 오래된 버전부터 삭제한다.
 */

import type { RiskGrade } from './types.js';

/**
 * 버전 관리기 입력
 */
export interface VersionManagerInput {
  /** 저장 | 비교 */
  action: 'save' | 'compare';
  /** 문서 식별자 */
  documentId: string;
  /** action=save 시 수정본 내용 */
  revisedContent?: string;
  /** action=compare 시 버전 A */
  versionA?: number;
  /** action=compare 시 버전 B */
  versionB?: number;
}

/**
 * 버전 관리기 출력
 */
export interface VersionManagerOutput {
  /** 수행 액션 */
  action: 'save' | 'compare';
  /** action=save 시 저장된 버전 */
  savedVersion?: ContractVersion;
  /** action=compare 시 비교 결과 */
  comparison?: VersionComparison;
}

/**
 * 계약서 버전
 */
export interface ContractVersion {
  /** 버전 번호 (1부터 1씩 증가) */
  versionNumber: number;
  /** 저장 일시 (YYYY-MM-DD HH:mm:ss) */
  savedAt: string;
  /** 종합 위험도 등급 */
  overallGrade: RiskGrade;
}

/**
 * 버전 비교 결과
 */
export interface VersionComparison {
  /** 추가된 조항 */
  added: string[];
  /** 삭제된 조항 */
  removed: string[];
  /** 변경된 조항 */
  changed: ClauseChange[];
  /** 버전 A 종합 등급 */
  gradeA: RiskGrade;
  /** 버전 B 종합 등급 */
  gradeB: RiskGrade;
  /** 등급 변화 (상승/하락/동일) */
  gradeShift: 'up' | 'down' | 'same';
}

/**
 * 조항 변경 내역
 */
export interface ClauseChange {
  /** 변경 전 */
  before: string;
  /** 변경 후 */
  after: string;
}
