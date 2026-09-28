/**
 * 입력 검증기 (InputValidator)
 *
 * 계산기 모듈 실행 전 원시 입력의 유효성을 결정론적으로 검증하는 순수 클래스이다.
 * 검증은 다음 고정 순서로 각 필드에 대해 수행한다(요구사항 4.1~4.6):
 *   1. 필수 항목 존재 (missing)
 *   2. 타입 일치 - 수치/열거형 (type_mismatch)
 *   3. 음수 아님 - 0 이상 (negative)
 *   4. 기준표 유효 상한 이하 (exceeds_max)
 *
 * 하나라도 위반하면 계산을 수행하지 않고(`isValid=false`), 위반 항목별
 * `ValidationError`를 수집하며 원본 입력을 그대로 보존한다(`preservedInput`).
 * 모든 항목이 통과하면 `validatedPayload`에 검증된 입력을 담아 전달한다.
 *
 * @module InputValidator
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import type {
  CalculatorType,
  HousingCount,
  PropertyType,
  BrokeragePropertyType,
  TransactionType,
  AcquisitionReductionType,
} from '../interfaces/types.js';
import type {
  RateTableConstraints,
  ValidationError,
  ValidationInput,
  ValidationResult,
} from '../interfaces/input-validator.js';

/**
 * 필드 검증 사양.
 *
 * 각 계산기 필수 항목의 기대 타입과 (열거형인 경우) 허용값,
 * (수치인 경우) 어떤 기준표 상한에 대해 검증할지를 기술한다.
 */
interface FieldSpec {
  /** 대상 항목명 */
  field: string;
  /** 기대 타입 분류 */
  kind: 'number' | 'boolean' | 'enum';
  /** 열거형 허용값 (kind === 'enum') */
  allowed?: readonly string[];
  /** 수치 항목이 검증 대상으로 삼는 상한 (kind === 'number') */
  bound?: 'amount' | 'area' | 'holdingPeriod';
  /** 음수 검증 대상 여부 (kind === 'number'일 때 기본 true) */
  nonNegative?: boolean;
  /**
   * 선택 입력 여부. true이면 값이 없어도(undefined/null) 누락 오류로 처리하지 않고 통과시키며,
   * 값이 존재할 때만 타입·음수·상한 검증을 수행한다.
   */
  optional?: boolean;
}

/** 부동산 유형 허용값 */
const PROPERTY_TYPE_VALUES: readonly PropertyType[] = ['house', 'non_house'];
/** 중개수수료 물건 유형 허용값 */
const BROKERAGE_PROPERTY_TYPE_VALUES: readonly BrokeragePropertyType[] = [
  'house',
  'officetel',
  'other',
];
/** 주택 수 허용값 */
const HOUSING_COUNT_VALUES: readonly HousingCount[] = ['one', 'two', 'three_or_more'];
/** 거래 유형 허용값 */
const TRANSACTION_TYPE_VALUES: readonly TransactionType[] = ['sale_exchange', 'lease'];
/** 취득세 감면 유형 허용값 */
const REDUCTION_TYPE_VALUES: readonly AcquisitionReductionType[] = [
  'first_time_buyer',
  'newlywed',
  'long_term_rental_business',
  'none',
];

/**
 * 취득비용 계산기 필수 항목 사양.
 * @requirements 4.1
 */
const ACQUISITION_SPECS: readonly FieldSpec[] = [
  { field: 'purchasePrice', kind: 'number', bound: 'amount' },
  // officialPrice(공시가격/시가표준액)는 신축 등 미정 케이스를 위해 선택 입력이다.
  // 필수 누락으로 막지 않으며, 값이 있을 때만 타입·음수·상한을 검증한다(선택 필드).
  { field: 'officialPrice', kind: 'number', bound: 'amount', optional: true },
  { field: 'propertyType', kind: 'enum', allowed: PROPERTY_TYPE_VALUES },
  { field: 'housingCount', kind: 'enum', allowed: HOUSING_COUNT_VALUES },
  { field: 'isAdjustmentArea', kind: 'boolean' },
  { field: 'exclusiveArea', kind: 'number', bound: 'area' },
  { field: 'reductionType', kind: 'enum', allowed: REDUCTION_TYPE_VALUES },
  { field: 'useJudicialScrivener', kind: 'boolean' },
  { field: 'baseYear', kind: 'number' },
];

/**
 * 양도소득세 계산기 필수 항목 사양.
 * @requirements 4.1
 */
const TRANSFER_TAX_SPECS: readonly FieldSpec[] = [
  { field: 'transferPrice', kind: 'number', bound: 'amount' },
  { field: 'acquisitionPrice', kind: 'number', bound: 'amount' },
  { field: 'necessaryExpense', kind: 'number', bound: 'amount' },
  { field: 'holdingPeriod', kind: 'number', bound: 'holdingPeriod' },
  { field: 'residencePeriod', kind: 'number', bound: 'holdingPeriod' },
  { field: 'isSingleHouseholdOneHouse', kind: 'boolean' },
  { field: 'housingCount', kind: 'enum', allowed: HOUSING_COUNT_VALUES },
  { field: 'isAdjustmentArea', kind: 'boolean' },
  { field: 'baseYear', kind: 'number' },
];

/**
 * 중개수수료 계산기 공통 필수 항목 사양.
 * 거래유형에 따른 조건부 필수 항목은 별도로 추가한다.
 * @requirements 4.1
 */
const BROKERAGE_BASE_SPECS: readonly FieldSpec[] = [
  { field: 'transactionType', kind: 'enum', allowed: TRANSACTION_TYPE_VALUES },
  { field: 'propertyType', kind: 'enum', allowed: BROKERAGE_PROPERTY_TYPE_VALUES },
  { field: 'baseYear', kind: 'number' },
];

/**
 * 입력 검증기.
 *
 * 상태를 갖지 않는 순수 검증기로, 동일 입력에 대해 항상 동일한 결과를 반환한다.
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
export class InputValidator {
  /**
   * 검증 입력을 받아 규칙을 순서대로 적용하고 결과를 반환한다.
   *
   * 위반이 하나라도 있으면 `isValid=false`, 오류 목록을 채우고 계산 대상
   * 페이로드를 전달하지 않는다. 원본 입력은 항상 `preservedInput`에 보존한다.
   * 모든 항목이 통과하면 `validatedPayload`에 원본 페이로드를 담아 전달한다.
   *
   * @param input - 검증 입력 (계산기 유형·원시 페이로드·기준표 제약)
   * @returns 검증 결과
   *
   * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
   */
  validate(input: ValidationInput): ValidationResult {
    const payload = input.payload ?? {};
    const specs = this.resolveSpecs(input.calculatorType, payload);
    const errors: ValidationError[] = [];

    for (const spec of specs) {
      const error = this.validateField(spec, payload, input.rateTableConstraints);
      if (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      // 위반 시 계산을 수행하지 않고 입력을 보존한다 (요구사항 4.2~4.5).
      return {
        isValid: false,
        errors,
        preservedInput: payload,
      };
    }

    // 통과 시 검증된 입력을 전달한다 (요구사항 4.6).
    return {
      isValid: true,
      errors: [],
      validatedPayload: payload,
      preservedInput: payload,
    };
  }

  /**
   * 계산기 유형에 해당하는 필수 항목 사양을 결정한다.
   *
   * 중개수수료는 거래유형에 따라 조건부 필수 항목이 달라진다.
   *   - 매매/교환(sale_exchange): salePrice 필수
   *   - 임대차(lease): deposit, monthlyRent 필수
   *
   * @param calculatorType - 계산기 유형
   * @param payload - 원시 입력 (거래유형 판별에 사용)
   * @returns 검증할 필드 사양 목록
   */
  private resolveSpecs(
    calculatorType: CalculatorType,
    payload: Record<string, unknown>,
  ): readonly FieldSpec[] {
    switch (calculatorType) {
      case 'acquisition':
        return ACQUISITION_SPECS;
      case 'transfer_tax':
        return TRANSFER_TAX_SPECS;
      case 'brokerage':
        return this.resolveBrokerageSpecs(payload);
      default:
        return [];
    }
  }

  /**
   * 중개수수료 거래유형별 조건부 필수 항목을 포함한 사양을 구성한다.
   *
   * @param payload - 원시 입력
   * @returns 중개수수료 검증 사양 목록
   */
  private resolveBrokerageSpecs(payload: Record<string, unknown>): readonly FieldSpec[] {
    const specs: FieldSpec[] = [...BROKERAGE_BASE_SPECS];
    const transactionType = payload['transactionType'];

    if (transactionType === 'sale_exchange') {
      specs.push({ field: 'salePrice', kind: 'number', bound: 'amount' });
    } else if (transactionType === 'lease') {
      specs.push({ field: 'deposit', kind: 'number', bound: 'amount' });
      specs.push({ field: 'monthlyRent', kind: 'number', bound: 'amount' });
    }

    return specs;
  }

  /**
   * 단일 필드에 대해 검증 순서를 적용한다.
   *
   * 순서: 필수 존재 → 타입 일치 → 음수 아님 → 상한 이하.
   * 앞 단계에서 위반이 발견되면 즉시 해당 오류를 반환하고 이후 단계는 건너뛴다
   * (예: 값이 없는데 상한을 검사하지 않는다).
   *
   * @param spec - 필드 사양
   * @param payload - 원시 입력
   * @param constraints - 기준표 제약(상한)
   * @returns 위반 시 오류, 통과 시 null
   */
  private validateField(
    spec: FieldSpec,
    payload: Record<string, unknown>,
    constraints: RateTableConstraints,
  ): ValidationError | null {
    const value = payload[spec.field];

    // 1. 항목 존재 검증
    if (value === undefined || value === null) {
      // 선택 입력(optional)은 값이 없어도 통과시킨다(예: 공시가격 미정 신축 케이스).
      if (spec.optional) {
        return null;
      }
      // 필수 항목 누락 (요구사항 4.1, 4.4)
      return {
        type: 'missing',
        field: spec.field,
        message: `필수 항목 '${spec.field}'이(가) 누락되었습니다. 값을 입력해 주세요.`,
        expected: this.describeExpected(spec),
      };
    }

    // 2. 타입 일치 (요구사항 4.5)
    const typeError = this.checkType(spec, value);
    if (typeError) {
      return typeError;
    }

    // 수치 항목에 한해 음수·상한 검증을 수행한다.
    if (spec.kind === 'number') {
      const numeric = value as number;

      // 3. 음수 아님 - 0 이상 (요구사항 4.2)
      if (spec.nonNegative !== false && numeric < 0) {
        return {
          type: 'negative',
          field: spec.field,
          message: `'${spec.field}'은(는) 0 이상이어야 합니다.`,
          expected: '0 이상의 수치',
        };
      }

      // 4. 기준표 유효 상한 이하 (요구사항 4.3)
      const max = this.resolveBound(spec, constraints);
      if (max !== undefined && numeric > max) {
        return {
          type: 'exceeds_max',
          field: spec.field,
          message: `'${spec.field}'이(가) 입력 가능한 범위를 초과했습니다. 0 이상 ${max} 이하로 입력해 주세요.`,
          expected: `0 이상 ${max} 이하`,
        };
      }
    }

    return null;
  }

  /**
   * 필드 값의 타입이 기대 형식과 일치하는지 검사한다.
   *
   * - number: 유한한 수치여야 하며 NaN을 허용하지 않는다.
   * - boolean: 불리언이어야 한다.
   * - enum: 허용값 목록에 포함된 문자열이어야 한다.
   *
   * @param spec - 필드 사양
   * @param value - 검사 대상 값
   * @returns 불일치 시 오류, 일치 시 null
   */
  private checkType(spec: FieldSpec, value: unknown): ValidationError | null {
    switch (spec.kind) {
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
          return this.typeMismatch(spec, '수치');
        }
        return null;
      case 'boolean':
        if (typeof value !== 'boolean') {
          return this.typeMismatch(spec, '참/거짓(boolean)');
        }
        return null;
      case 'enum':
        if (typeof value !== 'string' || !(spec.allowed ?? []).includes(value)) {
          return this.typeMismatch(spec, `열거형 (${(spec.allowed ?? []).join(', ')})`);
        }
        return null;
      default:
        return null;
    }
  }

  /**
   * 타입 불일치 오류를 생성한다.
   *
   * @param spec - 필드 사양
   * @param expectedLabel - 기대 형식 설명
   * @returns 타입 불일치 오류
   */
  private typeMismatch(spec: FieldSpec, expectedLabel: string): ValidationError {
    return {
      type: 'type_mismatch',
      field: spec.field,
      message: `'${spec.field}'의 형식이 올바르지 않습니다. 기대 형식: ${expectedLabel}.`,
      expected: expectedLabel,
    };
  }

  /**
   * 수치 필드가 검증 대상으로 삼는 기준표 상한을 반환한다.
   *
   * @param spec - 필드 사양
   * @param constraints - 기준표 제약
   * @returns 상한값 (해당 없으면 undefined)
   */
  private resolveBound(
    spec: FieldSpec,
    constraints: RateTableConstraints,
  ): number | undefined {
    switch (spec.bound) {
      case 'amount':
        return constraints.maxAmount;
      case 'area':
        return constraints.maxArea;
      case 'holdingPeriod':
        return constraints.maxHoldingPeriod;
      default:
        return undefined;
    }
  }

  /**
   * 필드 사양으로부터 기대 형식/범위 설명 문자열을 생성한다.
   *
   * @param spec - 필드 사양
   * @returns 기대 형식 설명
   */
  private describeExpected(spec: FieldSpec): string {
    switch (spec.kind) {
      case 'number':
        return '수치';
      case 'boolean':
        return '참/거짓(boolean)';
      case 'enum':
        return `열거형 (${(spec.allowed ?? []).join(', ')})`;
      default:
        return '값';
    }
  }
}
