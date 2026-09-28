/**
 * 세무 질문 전처리기 (TaxQueryProcessor)
 *
 * 세무 질문에 대한 NLP 전처리 파이프라인을 실행한다.
 * TaxNLPModule을 호출하여 형태소 분석, 동의어 확장, 일상 용어 매핑,
 * 세목 분류, 수치 정보 추출을 수행하고, 검색에 최적화된 질의를 생성한다.
 *
 * @module TaxQueryProcessor
 * @requirements 3.5, 3.6, 3.7, 11.6
 */

import { TaxNLPModule, type TaxNLPResult } from '../tax-nlp/index.js';
import type { TaxType, ExtractedNumericInfo } from '../interfaces/index.js';

/**
 * 전처리된 질문 결과 인터페이스
 */
export interface ProcessedQuery {
  /** 원본 질문 텍스트 */
  originalQuery: string;
  /** 확장된 검색용 질문 텍스트 (동의어 + 일상 용어 매핑 결과 포함) */
  expandedQueryText: string;
  /** 추출된 키워드 */
  keywords: string[];
  /** 동의어 확장된 용어 */
  expandedTerms: string[];
  /** 분류된 세목 목록 */
  taxTypes: TaxType[];
  /** 부동산 세무 관련 여부 */
  isTaxRelated: boolean;
  /** 추출된 수치 정보 */
  extractedNumerics: ExtractedNumericInfo;
  /** 감지된 언어 */
  language: 'ko' | 'mixed' | 'unknown';
}

/**
 * 세무 질문 전처리기 클래스
 *
 * TaxNLPModule을 오케스트레이션하여 세무 질문에 대한
 * 종합 전처리 결과를 반환한다.
 *
 * 처리 파이프라인:
 * 1. TaxNLPModule.processQuery() 호출 (키워드 + 동의어 + 일상 용어 매핑)
 * 2. TaxTypeClassifier로 세목 분류 및 복합 세목 분해
 * 3. NumericExtractor로 수치 정보 추출 (세율 계산기 전달용)
 * 4. 확장된 검색용 질문 텍스트 생성
 *
 * 검색 실패 시 원본 질문 텍스트를 보존하여 검색에 사용한다.
 *
 * @requirements 3.5, 3.6, 3.7, 11.6
 */
export class TaxQueryProcessor {
  private nlpModule: TaxNLPModule;

  constructor() {
    this.nlpModule = new TaxNLPModule();
  }

  /**
   * 세무 질문을 전처리하여 검색 최적화된 결과를 반환한다.
   *
   * NLP 전처리 실패 시 원본 질문 텍스트를 그대로 검색 쿼리로 사용한다.
   * (Property 23: NLP 실패 시 원본 보존)
   *
   * @param query - 사용자 질문 텍스트
   * @returns 전처리된 질문 결과
   *
   * @requirements 3.5, 3.6, 3.7, 11.6, 11.7
   */
  processQuery(query: string): ProcessedQuery {
    // 빈 입력 방어
    if (!query || query.trim().length === 0) {
      return {
        originalQuery: query,
        expandedQueryText: query,
        keywords: [],
        expandedTerms: [],
        taxTypes: [],
        isTaxRelated: false,
        extractedNumerics: {},
        language: 'unknown',
      };
    }

    try {
      // TaxNLPModule로 종합 NLP 처리 수행
      const nlpResult: TaxNLPResult = this.nlpModule.processQuery(query);

      // 확장된 검색용 텍스트 생성
      const expandedQueryText = this.buildExpandedQueryText(query, nlpResult);

      return {
        originalQuery: query,
        expandedQueryText,
        keywords: nlpResult.keywords,
        expandedTerms: nlpResult.expandedTerms,
        taxTypes: nlpResult.taxTypes,
        isTaxRelated: nlpResult.isTaxRelated,
        extractedNumerics: nlpResult.extractedNumerics,
        language: nlpResult.language,
      };
    } catch {
      // NLP 처리 실패 시 원본 텍스트 보존 (Property 23)
      return {
        originalQuery: query,
        expandedQueryText: query,
        keywords: [query.trim()],
        expandedTerms: [],
        taxTypes: [],
        isTaxRelated: false,
        extractedNumerics: {},
        language: 'unknown',
      };
    }
  }

  /**
   * NLP 모듈에 직접 접근한다. (테스트/확장 용도)
   */
  getNLPModule(): TaxNLPModule {
    return this.nlpModule;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * 원본 질문과 NLP 결과를 결합하여 확장된 검색 텍스트를 생성한다.
   *
   * 원본 질문에 동의어 확장 결과를 추가하여 검색 품질을 향상시킨다.
   * 단, 확장된 용어가 없으면 원본 질문 그대로 반환한다.
   *
   * @param originalQuery - 원본 질문
   * @param nlpResult - NLP 처리 결과
   * @returns 확장된 검색 텍스트
   */
  private buildExpandedQueryText(originalQuery: string, nlpResult: TaxNLPResult): string {
    if (nlpResult.expandedTerms.length === 0) {
      return originalQuery;
    }

    // 원본에 이미 포함된 용어 제외하고 확장 용어 추가
    const additionalTerms = nlpResult.expandedTerms.filter(
      (term) => !originalQuery.includes(term)
    );

    if (additionalTerms.length === 0) {
      return originalQuery;
    }

    // 원본 질문 + 확장된 세무 용어를 결합
    return `${originalQuery} ${additionalTerms.join(' ')}`;
  }
}
