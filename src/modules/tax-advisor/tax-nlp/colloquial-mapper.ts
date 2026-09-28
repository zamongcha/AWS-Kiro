/**
 * 일상 용어→세무 전문 용어 매핑 모듈
 *
 * 사용자가 일상적으로 사용하는 표현을 세무 전문 용어로 변환한다.
 * 예: "집 팔 때 세금" → "양도소득세"
 *
 * @module ColloquialMapper
 * @requirements 11.6, 3.5
 */

import type { TaxType } from '../interfaces/index.js';

/**
 * 일상 용어 매핑 엔트리 인터페이스
 */
export interface ColloquialMapping {
  /** 일상 용어 표현 */
  colloquial: string;
  /** 대응 세무 전문 용어 */
  formal: string;
  /** 관련 세목 */
  taxType: TaxType;
}

/**
 * 매핑 결과 인터페이스
 */
export interface ColloquialMapResult {
  /** 원본 텍스트 */
  originalText: string;
  /** 매핑된 전문 용어 목록 */
  mappedTerms: string[];
  /** 식별된 세목 목록 */
  identifiedTaxTypes: TaxType[];
  /** 매핑이 하나라도 발생했는지 여부 */
  hasMappings: boolean;
}

/**
 * 일상 용어 매퍼 클래스
 *
 * 사용자의 일상적 표현을 세무 전문 용어로 변환하여
 * 검색 품질을 향상시킨다.
 */
export class ColloquialMapper {
  private mappings: ColloquialMapping[] = [];
  /** 길이 내림차순 정렬된 매핑 (최장 일치 적용) */
  private sortedMappings: ColloquialMapping[] = [];

  /**
   * JSON 데이터에서 매핑 사전을 로드한다.
   *
   * @param data - ColloquialMapping 배열 형태의 매핑 데이터
   */
  loadFromJson(data: ColloquialMapping[]): void {
    this.mappings = data;
    // 긴 표현부터 매칭 (최장 일치 우선)
    this.sortedMappings = [...data].sort(
      (a, b) => b.colloquial.length - a.colloquial.length
    );
  }

  /**
   * 일상 용어를 세무 전문 용어로 매핑한다.
   *
   * 질문 텍스트에 등록된 일상 용어가 포함되어 있으면,
   * 대응하는 세무 전문 용어를 반환한다.
   *
   * @param text - 사용자 입력 텍스트
   * @returns 매핑 결과 (매핑된 전문 용어와 식별된 세목)
   *
   * @requirements 11.6, 3.5
   */
  mapColloquialToFormal(text: string): ColloquialMapResult {
    if (!text || text.trim().length === 0) {
      return {
        originalText: text ?? '',
        mappedTerms: [],
        identifiedTaxTypes: [],
        hasMappings: false,
      };
    }

    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const mappedTerms: Set<string> = new Set();
    const identifiedTaxTypes: Set<TaxType> = new Set();

    for (const mapping of this.sortedMappings) {
      if (normalizedText.includes(mapping.colloquial)) {
        mappedTerms.add(mapping.formal);
        identifiedTaxTypes.add(mapping.taxType);
      }
    }

    return {
      originalText: text,
      mappedTerms: Array.from(mappedTerms),
      identifiedTaxTypes: Array.from(identifiedTaxTypes),
      hasMappings: mappedTerms.size > 0,
    };
  }

  /**
   * 텍스트 내의 일상 용어를 세무 전문 용어로 치환한 검색 쿼리를 생성한다.
   *
   * 원본 텍스트에 매핑된 전문 용어를 추가하여
   * 확장된 검색 쿼리를 생성한다.
   *
   * @param text - 원본 텍스트
   * @returns 전문 용어가 추가된 확장 쿼리 문자열
   */
  buildExpandedQuery(text: string): string {
    const result = this.mapColloquialToFormal(text);
    if (!result.hasMappings) {
      return text;
    }

    // 원본 텍스트 + 매핑된 전문 용어를 결합
    const formalTerms = result.mappedTerms.join(' ');
    return `${text} ${formalTerms}`;
  }

  /**
   * 텍스트에서 감지된 일상 용어 목록을 반환한다.
   *
   * 등록된 일상 용어 중 텍스트에 포함된 것들을 반환한다.
   * 최장 일치 순으로 정렬된 결과를 반환한다.
   *
   * @param text - 분석할 텍스트
   * @returns 감지된 일상 용어 문자열 배열
   */
  detectColloquialTerms(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const detected: string[] = [];

    for (const mapping of this.sortedMappings) {
      if (normalizedText.includes(mapping.colloquial)) {
        detected.push(mapping.colloquial);
      }
    }

    return detected;
  }

  /**
   * 현재 로드된 매핑 수를 반환한다.
   */
  getMappingCount(): number {
    return this.mappings.length;
  }

  /**
   * 모든 매핑을 반환한다.
   */
  getAllMappings(): ColloquialMapping[] {
    return [...this.mappings];
  }
}
