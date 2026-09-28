/**
 * 공통 인터페이스 모듈 진입점
 *
 * 모든 인터페이스와 타입을 일괄 re-export 한다.
 */

// 서비스 모듈 관련 인터페이스
export {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  ErrorResponse,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from './service-module.js';

// 데이터 모델 관련 인터페이스
export {
  LawArticle,
  CourtCase,
  RevisionEntry,
  SessionRecord,
  ConversationEntry,
  Citation,
  LawCitation,
  CaseCitation,
  RevisionType,
  CitationType,
} from './data-models.js';

// 검색 관련 인터페이스
export {
  SearchInput,
  SearchOutput,
  SearchResult,
  SearchFilters,
  SearchOptions,
  SearchResultType,
  SearchResultSource,
} from './search.js';

// 응답 생성 관련 인터페이스
export {
  ResponseGeneratorInput,
  ResponseGeneratorOutput,
  FormattedAnswer,
  AnswerSection,
  ResponseGeneratorOptions,
  ResponseMetadata,
} from './response.js';
