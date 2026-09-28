/**
 * 부동산 계산기 모듈 인터페이스 진입점
 *
 * 모든 계산기 관련 인터페이스와 타입을 일괄 re-export 한다.
 */

// 기본 공통 타입 정의
export type {
  CalculatorType,
  PropertyType,
  BrokeragePropertyType,
  HousingCount,
  TransactionType,
  AcquisitionReductionType,
  CurrencyUnit,
} from './types.js';

// 공통 계산 결과 타입
export type {
  CalculationBasis,
  LineItem,
  CalculationResult,
} from './result.js';

// 입력 검증기 타입
export type {
  ValidationInput,
  RateTableConstraints,
  ValidationResult,
  ValidationError,
} from './input-validator.js';

// 취득비용 계산기 타입
export type {
  AcquisitionCostInput,
  RentalReductionCondition,
  AcquisitionCostDetail,
  ReductionDetail,
  AcquisitionCostResult,
} from './acquisition-cost.js';

// 양도세 계산기 타입
export type {
  TransferTaxInput,
  TransferTaxDetail,
  TransferTaxResult,
} from './transfer-tax.js';

// 중개수수료 계산기 타입
export type {
  BrokerageFeeInput,
  BrokerageFeeDetail,
  BrokerageFeeResult,
} from './brokerage-fee.js';

// 기준표 관리기 및 기준표 데이터 모델 타입
export type {
  RateTableRequest,
  RateTableResponse,
  RateTable,
  RateTableMetadata,
  RateTableRegistry,
  AcquisitionRateData,
  TransferRateData,
  BrokerageRateData,
  AcquisitionTaxBracket,
  HousingBondBracket,
  ScrivenerFeeBracket,
  StampTaxBracket,
  AcquisitionReduction,
  RentalDifferentialRate,
  ProgressiveBracket,
  LongTermDeductionRow,
  BrokerageRateBracket,
} from './rate-tables.js';

// 계산기 연동 어댑터 타입
export type {
  CalculatorInputSchema,
  CalculatorOutputSchema,
  BridgeAdapterResult,
} from './calculator-bridge.js';

// AI 자문 보조 타입
export type {
  AiAssistInput,
  AiCalculationContext,
  AiAssistOutput,
} from './ai-advisor.js';
