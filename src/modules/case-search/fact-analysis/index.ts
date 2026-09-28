/**
 * @fileoverview 사실관계 분석 모듈
 * @description 사용자 상황 설명으로부터 사실관계를 분석하는 모듈의 진입점이다.
 * FactExtractor, DisputeClassifier, SearchQueryBuilder를 조합하여
 * 사실관계 분석 파이프라인을 제공한다.
 *
 * @requirements 1.2 - 사실관계 추출 (분쟁유형, 당사자관계, 핵심사실, 법적쟁점)
 * @requirements 1.3 - 핵심 사실관계를 검색 쿼리로 변환
 * @requirements 1.4 - LLM 기반 구조화된 법적 요소 추출
 * @requirements 1.6 - 부동산 관련 분쟁이 아닌 경우 감지
 * @requirements 9.2 - Bedrock Claude 3.5 Sonnet 활용
 * @requirements 9.3 - 동의어 사전 재활용
 */

import type { FactAnalysisInput, FactAnalysisOutput } from '../interfaces/index.js';
import { FactExtractor, FactExtractorConfig } from './fact-extractor.js';
import { DisputeClassifier } from './dispute-classifier.js';
import { SearchQueryBuilder, SearchQueryBuilderConfig } from './search-query-builder.js';
import { SynonymDictionary } from '../../search/synonym-dictionary.js';

/**
 * 사실관계 분석 모듈 설정
 */
export interface FactAnalysisModuleConfig {
  /** FactExtractor 설정 */
  extractorConfig?: FactExtractorConfig;
  /** SearchQueryBuilder 설정 */
  queryBuilderConfig?: SearchQueryBuilderConfig;
  /** 동의어 사전 DynamoDB 테이블 이름 */
  synonymTableName?: string;
}

/**
 * 사실관계 분석 모듈 클래스
 *
 * 사용자 상황 설명을 받아 사실관계를 분석하는 통합 모듈이다.
 * 내부적으로 FactExtractor, DisputeClassifier, SearchQueryBuilder를 조합한다.
 *
 * 처리 흐름:
 * 1. 사용자 상황에서 LLM 기반 사실관계 추출
 * 2. 키워드 기반 분쟁 유형 분류 보강
 * 3. 동의어 확장을 포함한 검색 쿼리 생성
 * 4. 부동산 분쟁 해당 여부 판별
 *
 * @requirements 1.2, 1.3, 1.4, 1.6, 9.2, 9.3
 */
export class FactAnalysisModule {
  private readonly factExtractor: FactExtractor;
  private readonly disputeClassifier: DisputeClassifier;
  private initialized = false;

  /**
   * FactAnalysisModule 생성자
   *
   * @param config - 모듈 설정
   * @param deps - 의존 모듈 주입 (테스트용)
   */
  constructor(
    config?: FactAnalysisModuleConfig,
    deps?: {
      factExtractor?: FactExtractor;
      disputeClassifier?: DisputeClassifier;
      synonymDictionary?: SynonymDictionary;
    },
  ) {
    this.disputeClassifier = deps?.disputeClassifier ?? new DisputeClassifier();

    const synonymDictionary = deps?.synonymDictionary ?? new SynonymDictionary();
    const searchQueryBuilder = new SearchQueryBuilder(synonymDictionary, config?.queryBuilderConfig);

    this.factExtractor = deps?.factExtractor ?? new FactExtractor(
      config?.extractorConfig,
      {
        disputeClassifier: this.disputeClassifier,
        searchQueryBuilder,
        synonymDictionary,
      },
    );

    this.initialized = true;
  }

  /**
   * 사실관계 분석을 수행한다.
   *
   * @param input - 사실관계 분석 입력 (상황 설명 + 선택적 세션 컨텍스트)
   * @returns 사실관계 분석 결과
   *
   * @example
   * ```typescript
   * const module = new FactAnalysisModule();
   * const result = await module.analyze({
   *   situationDescription: "임대인이 계약 만료 후 보증금을 반환하지 않습니다.",
   *   sessionContext: [],
   * });
   * ```
   */
  async analyze(input: FactAnalysisInput): Promise<FactAnalysisOutput> {
    if (!this.initialized) {
      throw new Error('사실관계 분석 모듈이 초기화되지 않았습니다.');
    }

    return this.factExtractor.extract(
      input.situationDescription,
      input.sessionContext,
    );
  }

  /**
   * 부동산 분쟁 여부를 빠르게 판별한다.
   *
   * LLM 호출 없이 키워드 기반으로만 판별하여 빠른 응답이 필요한 경우 사용한다.
   *
   * @param text - 사용자 상황 설명
   * @returns 부동산 분쟁 해당 여부
   */
  quickCheckRealEstateDispute(text: string): boolean {
    const result = this.disputeClassifier.classify(text);
    return result.isRealEstateDispute;
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'fact-analysis';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { FactExtractor } from './fact-extractor.js';
export { DisputeClassifier } from './dispute-classifier.js';
export { SearchQueryBuilder } from './search-query-builder.js';
export type { FactExtractorConfig } from './fact-extractor.js';
export type { SearchQueryBuilderConfig } from './search-query-builder.js';
export type { ClassificationResult } from './dispute-classifier.js';
