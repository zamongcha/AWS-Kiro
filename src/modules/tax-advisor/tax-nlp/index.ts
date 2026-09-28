/**
 * 세무 NLP 모듈 (TaxNLPModule)
 *
 * 세무 질문에 대한 자연어 처리 파이프라인을 통합 관리한다.
 * 형태소 분석(KoreanNLPModule), 동의어 확장(TaxSynonymDictionary),
 * 일상 용어 매핑(ColloquialMapper), 세목 분류(TaxTypeClassifier),
 * 수치 추출(NumericExtractor)을 오케스트레이션한다.
 *
 * @module TaxNLPModule
 * @requirements 11.2, 11.3, 11.6, 11.7, 3.5, 3.7
 */

import type { TaxType } from '../interfaces/tax-types.js';
import type { ExtractedNumericInfo } from '../interfaces/tax-search.js';
import { KoreanNLPModule } from '../../search/korean-nlp.js';
import { TaxSynonymDictionary, type TaxSynonymEntry } from './tax-synonym-dictionary.js';
import { ColloquialMapper, type ColloquialMapping } from './colloquial-mapper.js';
import { TaxTypeClassifier } from './tax-type-classifier.js';
import { NumericExtractor } from './numeric-extractor.js';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * NLP 처리 결과 인터페이스
 */
export interface TaxNLPResult {
  /** 추출된 키워드 (1~10개) */
  keywords: string[];
  /** 동의어 확장된 용어 */
  expandedTerms: string[];
  /** 분류된 세목 */
  taxTypes: TaxType[];
  /** 부동산 세무 관련 여부 */
  isTaxRelated: boolean;
  /** 추출된 수치 정보 */
  extractedNumerics: ExtractedNumericInfo;
  /** 감지된 언어 */
  language: 'ko' | 'mixed' | 'unknown';
}

/**
 * 세무 NLP 모듈 클래스
 *
 * 모든 NLP 서브모듈을 초기화하고 오케스트레이션하여
 * 세무 질문에 대한 종합 NLP 처리 결과를 반환한다.
 */
export class TaxNLPModule {
  private koreanNLP: KoreanNLPModule;
  private synonymDictionary: TaxSynonymDictionary;
  private colloquialMapper: ColloquialMapper;
  private taxTypeClassifier: TaxTypeClassifier;
  private numericExtractor: NumericExtractor;
  private initialized: boolean = false;

  constructor() {
    this.koreanNLP = new KoreanNLPModule();
    this.synonymDictionary = new TaxSynonymDictionary();
    this.colloquialMapper = new ColloquialMapper();
    this.taxTypeClassifier = new TaxTypeClassifier();
    this.numericExtractor = new NumericExtractor();
  }

  /**
   * 모듈을 초기화한다.
   *
   * 동의어 사전과 일상 용어 매핑 데이터를 JSON 파일에서 로드한다.
   * 이 메서드를 호출하지 않아도 processQuery 호출 시 자동 초기화된다.
   *
   * @param synonymData - 동의어 데이터 (직접 전달 시 파일 로드 생략)
   * @param colloquialData - 일상 용어 매핑 데이터 (직접 전달 시 파일 로드 생략)
   */
  initialize(
    synonymData?: TaxSynonymEntry[],
    colloquialData?: ColloquialMapping[],
  ): void {
    if (this.initialized) {
      return;
    }

    if (synonymData) {
      this.synonymDictionary.loadFromJson(synonymData);
    } else {
      // 파일에서 로드
      try {
        const dataDir = resolve(__dirname, '..', '..', '..', 'data');
        const synonymsRaw = readFileSync(resolve(dataDir, 'tax-synonyms.json'), 'utf-8');
        this.synonymDictionary.loadFromJson(JSON.parse(synonymsRaw) as TaxSynonymEntry[]);
      } catch {
        // 파일 로드 실패 시 빈 사전으로 진행
        this.synonymDictionary.loadFromJson([]);
      }
    }

    if (colloquialData) {
      this.colloquialMapper.loadFromJson(colloquialData);
    } else {
      try {
        const dataDir = resolve(__dirname, '..', '..', '..', 'data');
        const colloquialRaw = readFileSync(resolve(dataDir, 'colloquial-mappings.json'), 'utf-8');
        this.colloquialMapper.loadFromJson(JSON.parse(colloquialRaw) as ColloquialMapping[]);
      } catch {
        // 파일 로드 실패 시 빈 매핑으로 진행
        this.colloquialMapper.loadFromJson([]);
      }
    }

    this.initialized = true;
  }

  /**
   * 세무 질문에 대한 종합 NLP 처리를 수행한다.
   *
   * 처리 파이프라인:
   * 1. 언어 감지
   * 2. 형태소 분석 및 키워드 추출 (KoreanNLPModule)
   * 3. 동의어 확장 (TaxSynonymDictionary)
   * 4. 일상 용어 매핑 (ColloquialMapper)
   * 5. 세목 분류 (TaxTypeClassifier)
   * 6. 수치 정보 추출 (NumericExtractor)
   *
   * NLP 처리 실패 시 원본 텍스트를 보존하여 검색 쿼리로 사용한다.
   *
   * @param text - 사용자 질문 텍스트
   * @returns 종합 NLP 처리 결과
   *
   * @requirements 11.2, 11.3, 11.6, 11.7, 3.5, 3.7
   */
  processQuery(text: string): TaxNLPResult {
    // 자동 초기화
    if (!this.initialized) {
      this.initialize();
    }

    // 빈 입력 방어
    if (!text || text.trim().length === 0) {
      return {
        keywords: [],
        expandedTerms: [],
        taxTypes: [],
        isTaxRelated: false,
        extractedNumerics: {},
        language: 'unknown',
      };
    }

    // 1. 언어 감지
    const detectedLang = this.koreanNLP.detectLanguage(text);
    const language = this.mapLanguage(detectedLang);

    // 2. 키워드 추출 (형태소 분석)
    let keywords: string[];
    try {
      keywords = this.koreanNLP.extractKeywords(text);
      // 1~10개 범위 보장
      if (keywords.length === 0) {
        // NLP 실패 시 원본 보존 (Property 23)
        keywords = [text.trim()];
      }
      if (keywords.length > 10) {
        keywords = keywords.slice(0, 10);
      }
    } catch {
      // 형태소 분석 실패 시 원본 텍스트 보존 (Property 23: NLP 실패 시 원본 보존)
      keywords = [text.trim()];
    }

    // 3. 동의어 확장
    const synonymExpanded = this.synonymDictionary.expandQuery(text);

    // 4. 일상 용어 매핑
    const colloquialResult = this.colloquialMapper.mapColloquialToFormal(text);
    const colloquialTerms = colloquialResult.mappedTerms;

    // 5. 확장된 용어 통합 (동의어 + 일상 용어 매핑 결과)
    const expandedTermsSet = new Set<string>([
      ...synonymExpanded,
      ...colloquialTerms,
    ]);
    const expandedTerms = Array.from(expandedTermsSet);

    // 6. 세목 분류 (원본 + 매핑된 전문 용어 모두 고려)
    const classificationResult = this.taxTypeClassifier.classify(text);
    let taxTypes = classificationResult.taxTypes;

    // 일상 용어 매핑에서 추가 세목 감지
    if (colloquialResult.hasMappings) {
      const additionalTypes = colloquialResult.identifiedTaxTypes.filter(
        (t) => !taxTypes.includes(t)
      );
      taxTypes = [...taxTypes, ...additionalTypes];
    }

    const isTaxRelated = taxTypes.length > 0;

    // 7. 수치 정보 추출
    const extractedNumerics = this.numericExtractor.extract(text);

    return {
      keywords,
      expandedTerms,
      taxTypes,
      isTaxRelated,
      extractedNumerics,
      language,
    };
  }

  /**
   * 동의어 사전에 직접 접근한다.
   */
  getSynonymDictionary(): TaxSynonymDictionary {
    if (!this.initialized) {
      this.initialize();
    }
    return this.synonymDictionary;
  }

  /**
   * 일상 용어 매퍼에 직접 접근한다.
   */
  getColloquialMapper(): ColloquialMapper {
    if (!this.initialized) {
      this.initialize();
    }
    return this.colloquialMapper;
  }

  /**
   * 세목 분류기에 직접 접근한다.
   */
  getTaxTypeClassifier(): TaxTypeClassifier {
    return this.taxTypeClassifier;
  }

  /**
   * 수치 추출기에 직접 접근한다.
   */
  getNumericExtractor(): NumericExtractor {
    return this.numericExtractor;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * KoreanNLPModule의 언어 감지 결과를 TaxNLPResult 형식으로 매핑한다.
   */
  private mapLanguage(detected: 'korean' | 'mixed' | 'unknown'): 'ko' | 'mixed' | 'unknown' {
    switch (detected) {
      case 'korean':
        return 'ko';
      case 'mixed':
        return 'mixed';
      default:
        return 'unknown';
    }
  }
}

// Re-export submodules for direct use
export { TaxSynonymDictionary, type TaxSynonymEntry } from './tax-synonym-dictionary.js';
export { ColloquialMapper, type ColloquialMapping, type ColloquialMapResult } from './colloquial-mapper.js';
export { TaxTypeClassifier, type TaxClassificationResult } from './tax-type-classifier.js';
export { NumericExtractor } from './numeric-extractor.js';
