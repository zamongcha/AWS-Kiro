/**
 * 계약서 AI 분석 모듈 인터페이스 진입점
 *
 * 모든 계약서 분석 관련 인터페이스와 타입을 일괄 re-export 한다.
 */

// 기본 공통 타입 정의
export type {
  ContractType,
  PartyPerspective,
  RiskGrade,
  PartyImpact,
  ClauseSpan,
  BoundingBox,
} from './types.js';

// 문서 인식기
export type {
  DocumentRecognizerInput,
  DocumentRecognizerOutput,
  RecognizedClause,
  OcrProvider,
  OcrRequest,
  OcrResult,
  OcrBlock,
} from './document-recognizer.js';

// 위험조항 탐지기
export type {
  RiskDetectorInput,
  RiskDetectorOutput,
  RiskClause,
  MissingClause,
} from './risk-detector.js';

// 위험도 평가기
export type {
  RiskEvaluatorInput,
  RiskEvaluatorOutput,
  GradedRiskClause,
  FraudRiskScore,
  ExceededCriterion,
} from './risk-evaluator.js';

// 등기부 대조기
export type {
  RegistryMatcherInput,
  RegistryMatchResult,
  RegistryInfo,
} from './registry-matcher.js';

// 수정제안 생성기
export type {
  RevisionAdvisorInput,
  RevisionAdvisorOutput,
  RevisionSuggestion,
  ClauseJudgment,
  LegalReference,
} from './revision-advisor.js';

// 특약 추천기
export type {
  ClauseRecommenderInput,
  ClauseRecommenderOutput,
  RecommendedClause,
} from './clause-recommender.js';

// 정보 추출기
export type {
  InfoExtractorInput,
  InfoExtractorOutput,
  ExtractedField,
} from './info-extractor.js';

// 비교 분석기
export type {
  ComparatorInput,
  ComparatorOutput,
  ClauseComparison,
} from './comparator.js';

// 판례 연동기
export type {
  CaseLinkerInput,
  CaseLinkerOutput,
  ClauseLinkedCases,
  LinkedCase,
} from './case-linker.js';

// 버전 관리기
export type {
  VersionManagerInput,
  VersionManagerOutput,
  ContractVersion,
  VersionComparison,
  ClauseChange,
} from './version-manager.js';

// 시뮬레이션 엔진
export type {
  SimulationEngineInput,
  ClauseChangeRequest,
  SimulationEngineOutput,
} from './simulation-engine.js';

// 인용 표시기
export type {
  CitationInput,
  CitationOutput,
  AnnotatedClause,
  Footnote,
} from './citation.js';

// 계산기 연동기
export type {
  CalculatorBridgeOutput,
  CalculatorInputSchema,
  CalculatorOutputSchema,
} from './calculator-bridge.js';

// 첨부서류 체크리스트
export type {
  ChecklistItem,
  ContractChecklist,
} from './checklist.js';

// DynamoDB 레코드 타입
export type {
  ContractDocumentRecord,
  ContractVersionRecord,
  ContractAnalysisRecord,
  RuleSetMetadataRecord,
  ContractConfigRecord,
} from './records.js';
