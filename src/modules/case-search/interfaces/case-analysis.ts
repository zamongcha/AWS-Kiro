/**
 * 판례 분석 모듈 인터페이스 정의
 *
 * 검색된 판례를 분석하여 판결 요지, 핵심 쟁점, 판결 이유,
 * 실무 시사점, 사용자 상황과의 유사점/차이점 등을 추출하는
 * 모듈의 입출력 인터페이스를 정의한다.
 */

import type { ConversationEntry } from '../../../common/interfaces/data-models.js';
import type { CaseSearchResult, SimilarityDetail } from './types.js';
import type { FactAnalysisOutput } from './fact-analysis.js';
import type { CaseSearchModuleOutput } from './case-search.js';
import type { ComparisonResult } from './comparison.js';
import type { TrendResult } from './trend.js';
import type { CaseCitation } from './citation.js';

/**
 * 판례 분석 모듈 입력 인터페이스
 */
export interface CaseAnalysisInput {
  /** 사용자 상황 분석 결과 */
  userSituation: FactAnalysisOutput;
  /** 판례 검색 결과 */
  searchResults: CaseSearchModuleOutput;
  /** 세션 컨텍스트 (후속 질문 처리용) */
  sessionContext?: ConversationEntry[];
}

/**
 * 판례 분석 응답 인터페이스
 *
 * 전체 분석 응답의 최상위 구조를 정의한다.
 */
export interface CaseAnalysisResponse {
  /** 사용자 상황 요약 */
  situationSummary: string;
  /** 개별 판례 분석 목록 */
  caseAnalyses: IndividualCaseAnalysis[];
  /** 비교 분석 (조건부: 동일 쟁점 상이 결론 2건 이상 시) */
  comparisonAnalysis?: ComparisonResult;
  /** 트렌드 분석 (조건부: 해당 분쟁유형 판례 5건 이상 시) */
  trendAnalysis?: TrendResult;
  /** 종합 시사점 */
  overallImplication: string;
  /** 인용 목록 */
  citations: CaseCitation[];
  /** 면책 고지 */
  disclaimer: string;
}

/**
 * 개별 판례 분석 인터페이스
 *
 * 검색된 각 판례에 대한 심층 분석 정보를 담는다.
 */
export interface IndividualCaseAnalysis {
  /** 사건번호 */
  caseNumber: string;
  /** 판결 요지 */
  judgmentSummary: string;
  /** 핵심 쟁점 목록 */
  keyIssues: string[];
  /** 판결 이유 */
  judgmentReason: string;
  /** 실무 시사점 */
  practicalImplication: string;
  /** 사용자 상황과의 유사점/차이점 */
  similarityToUser: SimilarityDetail;
}
