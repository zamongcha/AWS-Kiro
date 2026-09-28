/**
 * @fileoverview 세율 계산기 모듈
 * @description 부동산 세무에 대한 세율 계산 서비스를 제공한다.
 * 세목에 따라 적절한 계산기로 디스패치하고, 파라미터 검증,
 * 세율 테이블 로드, 세액 산출을 수행한다.
 *
 * @requirements 5.1 - 세율 계산 기능 제공
 * @requirements 5.2 - 세율 구간 적용
 * @requirements 5.3 - 장기보유특별공제 등 감면 적용
 * @requirements 5.6 - 불완전 파라미터 감지
 */

import type {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
} from '../../../common/interfaces/index.js';
import { HealthStatusEnum, ErrorSeverity } from '../../../common/interfaces/index.js';
import type {
  TaxType,
  TaxCalculatorInput,
  TaxCalculationParams,
  TaxCalculationResult,
  AcquisitionTaxParams,
  CapitalGainsTaxParams,
  ComprehensivePropertyTaxParams,
  PropertyTaxParams,
  GiftTaxParams,
  InheritanceTaxParams,
} from '../interfaces/index.js';
import { ParamValidator } from './param-validator.js';
import { BracketMatcher } from './bracket-matcher.js';
import { RateTableLoader } from './rate-table-loader.js';
import { AcquisitionTaxCalculator } from './calculators/acquisition-tax.js';
import { CapitalGainsTaxCalculator } from './calculators/capital-gains-tax.js';
import { ComprehensivePropertyTaxCalculator } from './calculators/comprehensive-property-tax.js';
import { PropertyTaxCalculator } from './calculators/property-tax.js';
import { GiftTaxCalculator } from './calculators/gift-tax.js';
import { InheritanceTaxCalculator } from './calculators/inheritance-tax.js';

/** 면책 고지 */
const DISCLAIMER = '본 계산은 참고용 추정치이며 실제 세액과 차이가 있을 수 있습니다.';

/**
 * 세율 계산기 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다.
 * 세목에 따라 적절한 계산기로 디스패치하고 결과를 통합 반환한다.
 */
export class TaxCalculatorModule implements ServiceModule {
  private paramValidator: ParamValidator;
  private bracketMatcher: BracketMatcher;
  private rateTableLoader: RateTableLoader;
  private acquisitionCalculator: AcquisitionTaxCalculator;
  private capitalGainsCalculator: CapitalGainsTaxCalculator;
  private comprehensivePropertyCalculator: ComprehensivePropertyTaxCalculator;
  private propertyCalculator: PropertyTaxCalculator;
  private giftCalculator: GiftTaxCalculator;
  private inheritanceCalculator: InheritanceTaxCalculator;

  private initialized = false;

  constructor() {
    this.paramValidator = new ParamValidator();
    this.bracketMatcher = new BracketMatcher();
    this.rateTableLoader = new RateTableLoader();
    this.acquisitionCalculator = new AcquisitionTaxCalculator();
    this.capitalGainsCalculator = new CapitalGainsTaxCalculator();
    this.comprehensivePropertyCalculator = new ComprehensivePropertyTaxCalculator();
    this.propertyCalculator = new PropertyTaxCalculator();
    this.giftCalculator = new GiftTaxCalculator();
    this.inheritanceCalculator = new InheritanceTaxCalculator();
  }

  /**
   * 모듈을 초기화한다.
   */
  async initialize(config: ModuleConfig): Promise<void> {
    // RateTableLoader 설정 적용 가능
    if (config.config['tableName'] || config.config['region']) {
      this.rateTableLoader = new RateTableLoader({
        tableName: config.config['tableName'] as string | undefined,
        region: config.config['region'] as string | undefined,
      });
    }
    this.initialized = true;
  }

  /**
   * 세율 계산을 실행한다.
   *
   * ModuleInput.payload에 TaxCalculatorInput을 전달하면
   * 세목에 맞는 계산기로 디스패치하여 결과를 반환한다.
   *
   * @param input - 모듈 입력 (payload: TaxCalculatorInput)
   * @returns 모듈 출력 (data: TaxCalculationResult)
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    try {
      const calculatorInput = input.payload as TaxCalculatorInput;

      if (!calculatorInput || !calculatorInput.taxType || !calculatorInput.parameters) {
        return {
          success: false,
          errors: [{
            code: 'INVALID_INPUT',
            message: '세목(taxType)과 계산 파라미터(parameters)가 필요합니다.',
            severity: ErrorSeverity.LOW,
            timestamp: new Date().toISOString(),
          }],
        };
      }

      const result = await this.calculateTax(calculatorInput.taxType, calculatorInput.parameters);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      return {
        success: false,
        errors: [{
          code: 'CALCULATION_ERROR',
          message,
          severity: ErrorSeverity.MEDIUM,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

  /**
   * 세율 계산을 수행한다.
   *
   * 1. 파라미터 검증
   * 2. 세목별 계산기로 디스패치
   * 3. 결과 반환
   *
   * @param taxType - 세목 유형
   * @param params - 계산 파라미터
   * @returns 계산 결과
   */
  async calculateTax(taxType: TaxType, params: TaxCalculationParams): Promise<TaxCalculationResult> {
    // 파라미터 검증
    const validation = this.paramValidator.validate(taxType, params);

    if (!validation.isValid) {
      const labels = this.paramValidator.getFieldLabels(validation.missingFields);
      return {
        taxType,
        estimatedTax: 0,
        effectiveRate: 0,
        calculationSteps: [],
        appliedArticle: '',
        appliedDate: new Date().toISOString().split('T')[0],
        possibleExemptions: [],
        disclaimer: DISCLAIMER,
        isComplete: false,
        missingInfo: labels,
      };
    }

    // 세목별 계산기로 디스패치
    switch (taxType) {
      case 'acquisition':
        return this.acquisitionCalculator.calculate(params as AcquisitionTaxParams);
      case 'capital_gains':
        return this.capitalGainsCalculator.calculate(params as CapitalGainsTaxParams);
      case 'comprehensive_property':
        return this.comprehensivePropertyCalculator.calculate(params as ComprehensivePropertyTaxParams);
      case 'property':
        return this.propertyCalculator.calculate(params as PropertyTaxParams);
      case 'gift':
        return this.giftCalculator.calculate(params as GiftTaxParams);
      case 'inheritance':
        return this.inheritanceCalculator.calculate(params as InheritanceTaxParams);
      default:
        return {
          taxType,
          estimatedTax: 0,
          effectiveRate: 0,
          calculationSteps: [],
          appliedArticle: '',
          appliedDate: new Date().toISOString().split('T')[0],
          possibleExemptions: [],
          disclaimer: DISCLAIMER,
          isComplete: false,
          missingInfo: ['지원하지 않는 세목입니다.'],
        };
    }
  }

  /**
   * 모듈 헬스체크를 수행한다.
   */
  async healthCheck(): Promise<HealthStatus> {
    return {
      status: this.initialized ? HealthStatusEnum.HEALTHY : HealthStatusEnum.DEGRADED,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: this.initialized,
        supportedTaxTypes: [
          'acquisition',
          'capital_gains',
          'comprehensive_property',
          'property',
          'gift',
          'inheritance',
        ],
      },
    };
  }

  /**
   * 모듈 이름을 반환한다.
   */
  getName(): string {
    return 'TaxCalculatorModule';
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { ParamValidator } from './param-validator.js';
export { BracketMatcher } from './bracket-matcher.js';
export { RateTableLoader } from './rate-table-loader.js';
export { AcquisitionTaxCalculator } from './calculators/acquisition-tax.js';
export { CapitalGainsTaxCalculator } from './calculators/capital-gains-tax.js';
export { ComprehensivePropertyTaxCalculator } from './calculators/comprehensive-property-tax.js';
export { PropertyTaxCalculator } from './calculators/property-tax.js';
export { GiftTaxCalculator } from './calculators/gift-tax.js';
export { InheritanceTaxCalculator } from './calculators/inheritance-tax.js';
