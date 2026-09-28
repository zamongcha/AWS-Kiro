/**
 * 세무 자문 모듈 인터페이스 진입점
 *
 * 모든 세무 관련 타입과 인터페이스를 일괄 re-export 한다.
 */

// 핵심 세무 타입
export type { TaxType } from './tax-types.js';
export type {
  TaxBracket,
  SpecialRate,
  Deduction,
  RateTableData,
} from './tax-types.js';

// 세법 수집기 인터페이스
export type {
  RevisionEntry,
  TaxLawArticle,
  TaxLawCollectorInput,
  TaxLawCollectorOutput,
  FailedItem,
} from './tax-law.js';

// 예규/심판례 수집기 인터페이스
export type { RulingType } from './tax-ruling.js';
export type {
  TaxRuling,
  RulingCollectorInput,
  RulingCollectorOutput,
  RulingFailedItem,
} from './tax-ruling.js';

// 세무 검색 인터페이스
export type {
  TaxSearchInput,
  TaxSearchOutput,
  TaxSearchResult,
  ExtractedNumericInfo,
} from './tax-search.js';

// 세무 응답 생성 인터페이스
export type {
  ConversationContext,
  TaxResponseGeneratorInput,
  TaxResponseGeneratorOutput,
  TaxFormattedAnswer,
  TaxSavingTip,
  TaxLawCitationSource,
  TaxRulingCitationSource,
  TaxCitation,
  Reference,
} from './tax-response.js';

// 세율 계산기 인터페이스
export type {
  AcquisitionTaxParams,
  CapitalGainsTaxParams,
  ComprehensivePropertyTaxParams,
  PropertyTaxParams,
  GiftTaxParams,
  InheritanceTaxParams,
  TaxCalculationParams,
  TaxCalculatorInput,
  CalculationStep,
  Exemption,
  TaxCalculationResult,
} from './tax-calculator.js';

// DynamoDB 데이터 모델
export type {
  TaxConversationEntry,
  TaxSessionRecord,
  TaxDataManagementRecord,
  TaxRateRecord,
} from './dynamo-models.js';
