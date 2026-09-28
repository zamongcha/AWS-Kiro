/**
 * @fileoverview 검색 쿼리 빌더
 * @description 사실관계 분석 결과(핵심 사실, 법적 쟁점)를 검색 쿼리로 변환한다.
 * 기존 SynonymDictionary를 재활용하여 동의어 확장을 수행하고,
 * 분쟁 유형별 필터 조건을 생성한다.
 *
 * @requirements 1.3 - 핵심 사실관계를 검색 쿼리로 변환
 * @requirements 9.2 - 동의어 확장
 * @requirements 9.3 - 동의어 사전 재활용
 */

import type { DisputeType, SearchQuery } from '../interfaces/index.js';
import { SynonymDictionary } from '../../search/synonym-dictionary.js';

/**
 * 검색 쿼리 빌더 설정
 */
export interface SearchQueryBuilderConfig {
  /** 최대 쿼리 수 (기본값: 3) */
  maxQueries?: number;
  /** 강조 키워드 최대 수 (기본값: 5) */
  maxEmphasis?: number;
}

/**
 * 검색 쿼리 빌더 클래스
 *
 * 핵심 사실관계와 법적 쟁점을 기반으로 OpenSearch 검색 쿼리를 생성한다.
 * SynonymDictionary를 활용하여 동의어를 확장하고,
 * 분쟁 유형별 필터를 적용하여 검색 정밀도를 높인다.
 *
 * @requirements 1.3, 9.2, 9.3
 */
export class SearchQueryBuilder {
  private readonly synonymDictionary: SynonymDictionary;
  private readonly maxQueries: number;
  private readonly maxEmphasis: number;

  /**
   * SearchQueryBuilder 생성자
   *
   * @param synonymDictionary - 동의어 사전 인스턴스
   * @param config - 빌더 설정 (선택)
   */
  constructor(
    synonymDictionary: SynonymDictionary,
    config?: SearchQueryBuilderConfig,
  ) {
    this.synonymDictionary = synonymDictionary;
    this.maxQueries = config?.maxQueries ?? 3;
    this.maxEmphasis = config?.maxEmphasis ?? 5;
  }

  /**
   * 사실관계와 법적 쟁점을 검색 쿼리로 변환한다.
   *
   * 분쟁 유형별로 검색 쿼리를 생성하며, 동의어 확장을 적용한다.
   * 각 쿼리에 분쟁 유형 필터를 설정하여 관련 카테고리 우선 검색이 가능하도록 한다.
   *
   * @param keyFacts - 핵심 사실관계 목록
   * @param legalIssues - 법적 쟁점 목록
   * @param disputeTypes - 분류된 분쟁 유형 목록
   * @returns 생성된 검색 쿼리 배열
   *
   * @example
   * ```typescript
   * const builder = new SearchQueryBuilder(synonymDictionary);
   * const queries = builder.buildQueries(
   *   ['임대인이 보증금 3억을 반환하지 않음', '계약 만료 후 6개월 경과'],
   *   ['임대차보증금 반환 청구', '대항력 요건'],
   *   ['lease']
   * );
   * ```
   */
  buildQueries(
    keyFacts: string[],
    legalIssues: string[],
    disputeTypes: DisputeType[],
  ): SearchQuery[] {
    const queries: SearchQuery[] = [];

    // 분쟁 유형이 없으면 전체 유형에 대해 기본 쿼리 생성
    const targetTypes = disputeTypes.length > 0
      ? disputeTypes.slice(0, this.maxQueries)
      : ['lease' as DisputeType];

    for (const disputeType of targetTypes) {
      const query = this.buildSingleQuery(keyFacts, legalIssues, disputeType);
      queries.push(query);
    }

    return queries;
  }

  /**
   * 단일 분쟁 유형에 대한 검색 쿼리를 생성한다.
   *
   * @param keyFacts - 핵심 사실관계 목록
   * @param legalIssues - 법적 쟁점 목록
   * @param disputeType - 분쟁 유형 필터
   * @returns 생성된 SearchQuery
   */
  private buildSingleQuery(
    keyFacts: string[],
    legalIssues: string[],
    disputeType: DisputeType,
  ): SearchQuery {
    // 사실관계와 법적 쟁점을 결합하여 쿼리 텍스트 생성
    const factText = keyFacts.join(' ');
    const issueText = legalIssues.join(' ');
    const baseQueryText = `${factText} ${issueText}`.trim();

    // 동의어 확장
    const expanded = this.synonymDictionary.expandQuery(baseQueryText);
    const expandedTerms = expanded.slice(1); // 원본 쿼리 제외한 확장 동의어

    // 쿼리 텍스트 구성: 원본 + 확장 동의어
    const queryText = expandedTerms.length > 0
      ? `${baseQueryText} ${expandedTerms.join(' ')}`
      : baseQueryText;

    // 강조 키워드 추출: 법적 쟁점에서 핵심 용어 추출
    const emphasis = this.extractEmphasis(legalIssues, expandedTerms);

    return {
      queryText,
      emphasis,
      disputeTypeFilter: disputeType,
    };
  }

  /**
   * 강조 키워드를 추출한다.
   *
   * 법적 쟁점과 동의어 확장 결과에서 핵심 키워드를 추출한다.
   *
   * @param legalIssues - 법적 쟁점 목록
   * @param expandedTerms - 동의어 확장 결과
   * @returns 강조 키워드 배열 (최대 maxEmphasis 개)
   */
  private extractEmphasis(legalIssues: string[], expandedTerms: string[]): string[] {
    const emphasisSet = new Set<string>();

    // 법적 쟁점을 강조 키워드로 추가
    for (const issue of legalIssues) {
      if (emphasisSet.size >= this.maxEmphasis) break;
      emphasisSet.add(issue);
    }

    // 동의어 확장 결과도 강조 키워드로 추가
    for (const term of expandedTerms) {
      if (emphasisSet.size >= this.maxEmphasis) break;
      emphasisSet.add(term);
    }

    return Array.from(emphasisSet).slice(0, this.maxEmphasis);
  }
}
