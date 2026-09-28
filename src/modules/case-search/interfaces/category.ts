/**
 * 카테고리 탐색 모듈 인터페이스 정의
 *
 * 분쟁 유형별 판례 목록 조회, 하위 세부 분류,
 * 개별 판례 상세 분석 등 카테고리 탐색 기능의
 * 입출력 인터페이스를 정의한다.
 */

import type { DisputeType } from './types.js';
import type { IndividualCaseAnalysis } from './case-analysis.js';
import type { CaseCitation } from './citation.js';

/**
 * 카테고리 목록 조회 입력 인터페이스
 */
export interface CategoryListInput {
  /** 분쟁 유형 */
  disputeType: DisputeType;
  /** 페이지 번호 (기본 1) */
  page?: number;
  /** 페이지 크기 (기본 20) */
  pageSize?: number;
}

/**
 * 카테고리 목록 조회 출력 인터페이스
 */
export interface CategoryListOutput {
  /** 분쟁 유형 */
  disputeType: DisputeType;
  /** 하위 세부 분류 */
  subCategories: SubCategory[];
  /** 판례 목록 */
  cases: CategoryCaseItem[];
  /** 전체 판례 수 */
  totalCount: number;
  /** 현재 페이지 */
  page: number;
  /** 페이지 크기 */
  pageSize: number;
}

/**
 * 하위 세부 분류 인터페이스
 */
export interface SubCategory {
  /** 세부 분류 ID */
  id: string;
  /** 세부 분류명 */
  name: string;
  /** 해당 분류 판례 수 */
  caseCount: number;
}

/**
 * 카테고리 내 판례 항목 인터페이스
 */
export interface CategoryCaseItem {
  /** 판례 고유 ID */
  caseId: string;
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 선고일자 (ISO 8601) */
  judgmentDate: string;
  /** 핵심 쟁점 요약 */
  keyIssueSummary: string;
}

/**
 * 개별 판례 상세 조회 입력 인터페이스
 */
export interface CaseDetailInput {
  /** 판례 고유 ID */
  caseId: string;
}

/**
 * 개별 판례 상세 조회 출력 인터페이스
 */
export interface CaseDetailOutput {
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 선고일자 (ISO 8601) */
  judgmentDate: string;
  /** 사건 유형 */
  caseType: DisputeType;
  /** 상세 분석 */
  analysis: IndividualCaseAnalysis;
  /** 인용 목록 */
  citations: CaseCitation[];
}
