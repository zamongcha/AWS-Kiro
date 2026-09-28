/**
 * 판례 검색 모듈 인터페이스 진입점
 *
 * 모든 판례 검색 관련 인터페이스와 타입을 일괄 re-export 한다.
 */

// 기본 타입 정의
export type { DisputeType } from './types.js';
export type { PartyRelation, SearchQuery, CaseSearchResult, SimilarityDetail } from './types.js';

// 사실관계 분석 인터페이스
export type { FactAnalysisInput, FactAnalysisOutput } from './fact-analysis.js';

// 판례 검색 엔진 인터페이스
export type { CaseSearchModuleInput, CaseSearchModuleOutput } from './case-search.js';

// 판례 분석 인터페이스
export type {
  CaseAnalysisInput,
  CaseAnalysisResponse,
  IndividualCaseAnalysis,
} from './case-analysis.js';

// 비교 분석 인터페이스
export type { ComparisonInput, ComparisonResult, ComparedCase } from './comparison.js';

// 트렌드 분석 인터페이스
export type { TrendInput, TrendResult, TrendChange, LawChange } from './trend.js';

// 인용 표시 인터페이스
export type { CaseCitation } from './citation.js';

// 카테고리 탐색 인터페이스
export type {
  CategoryListInput,
  CategoryListOutput,
  SubCategory,
  CategoryCaseItem,
  CaseDetailInput,
  CaseDetailOutput,
} from './category.js';

// 세션 및 이력 인터페이스
export type {
  CaseSearchSessionRecord,
  CaseSearchConversation,
  CaseSearchHistoryRecord,
} from './session.js';

// 입출력 인터페이스
export type {
  CaseSearchInput,
  CaseSearchOutput,
  InputValidationResult,
} from './input-output.js';
