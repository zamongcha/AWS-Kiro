/**
 * 질문 분해 및 하이브리드 검색 모듈
 *
 * 복합 질문을 주제별로 분해하고, 형태소 분석 + 동의어 확장을 통해
 * 벡터 검색과 키워드 검색을 모두 수행하는 하이브리드 검색 쿼리를 생성한다.
 *
 * 핵심 동작:
 * - 2개 이상의 서로 다른 법률 주제가 포함된 질문은 주제별로 분해하여 독립 검색
 * - 한국어 형태소 분석(KoreanNLPModule) + 동의어 확장(SynonymDictionary) 통합
 * - 혼합 언어(한국어 + 영어)를 한국어 기준으로 해석
 * - 형태소 분석 실패 시 원본 텍스트 그대로 검색
 *
 * @module QueryDecomposer
 * @requirements 3.5, 9.2, 9.3, 9.6, 9.7
 */

import { KoreanNLPModule } from './korean-nlp.js';
import { SynonymDictionary } from './synonym-dictionary.js';

/**
 * 분해된 질문 인터페이스
 *
 * 사용자의 복합 질문을 주제별 하위 쿼리로 분해한 결과를 나타낸다.
 */
export interface DecomposedQuery {
  /** 원본 질문 텍스트 */
  original: string;
  /** 주제별로 분해된 하위 쿼리 목록 */
  subQueries: SubQuery[];
  /** 감지된 주제 목록 */
  topics: string[];
  /** 부동산 법률 관련 여부 */
  isRealEstateLaw: boolean;
}

/**
 * 하위 쿼리 인터페이스
 *
 * 특정 주제에 초점을 맞춘 개별 검색 단위를 나타낸다.
 */
export interface SubQuery {
  /** 하위 쿼리 텍스트 (주제에 해당하는 문장/절) */
  text: string;
  /** 해당 주제 */
  topic: string;
  /** 검색 유형: 법령 검색, 판례 검색, 또는 둘 다 */
  searchType: 'law' | 'case' | 'both';
  /** 해당 하위 쿼리에서 추출된 키워드 */
  keywords: string[];
}

/**
 * 하이브리드 검색 쿼리 인터페이스
 *
 * 벡터 검색과 키워드 검색을 동시에 수행하기 위한 쿼리를 나타낸다.
 */
export interface HybridSearchQuery {
  /** 벡터 유사도 검색에 사용할 쿼리 텍스트 */
  vectorQuery: string;
  /** 키워드 검색에 사용할 용어 목록 */
  keywordQuery: string[];
  /** 검색 필터 (주제, 문서 유형 등) */
  filters: Record<string, unknown>;
  /** 해당 하위 쿼리의 주제 */
  topic: string;
}

/**
 * 주제별 검색 유형 매핑
 *
 * 각 부동산 법률 주제에 대해 우선 검색해야 할 문서 유형을 정의한다.
 * - 'law': 법령 문서 위주 검색
 * - 'case': 판례 문서 위주 검색
 * - 'both': 법령 및 판례 모두 검색
 */
const TOPIC_SEARCH_TYPE_MAP: Record<string, 'law' | 'case' | 'both'> = {
  임대차: 'both',
  매매: 'both',
  등기: 'law',
  중개: 'both',
  세금: 'law',
  토지이용: 'law',
  재건축: 'both',
  분양: 'both',
  경매: 'case',
  재개발: 'both',
};

/**
 * 주제별 핵심 키워드 매핑
 *
 * 각 주제를 식별하기 위한 핵심 키워드 목록.
 * 문장 분할 시 해당 키워드가 포함된 문장/절을 해당 주제의 하위 쿼리로 할당한다.
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  임대차: [
    '임대차', '임대', '임차', '전세', '월세', '보증금', '임대인', '임차인',
    '세입자', '집주인', '임대료', '차임', '전세금', '반전세', '임대차보호법',
    '계약갱신', '갱신청구권', '대항력', '확정일자', '우선변제', '최우선변제',
    '소액임차인', '전월세', '퇴거', '명도', '보증금반환',
  ],
  매매: [
    '매매', '매수', '매도', '매입', '매각', '계약금', '중도금', '잔금',
    '매매계약', '부동산거래', '거래신고', '실거래가', '매매대금', '소유권이전',
    '잔금지급', '계약해제', '위약금', '해약금',
  ],
  등기: [
    '등기', '소유권', '근저당', '저당권', '등기부', '등기부등본', '등기사항',
    '소유권이전등기', '보존등기', '말소등기', '가등기', '본등기',
    '전세권등기', '지상권등기', '가압류', '압류',
  ],
  중개: [
    '중개', '공인중개사', '중개수수료', '중개보수', '중개업', '중개사무소',
    '공인중개사법', '중개대상물', '중개계약', '전속중개', '일반중개',
  ],
  세금: [
    '세금', '취득세', '양도세', '양도소득세', '재산세', '종합부동산세', '종부세',
    '증여세', '상속세', '등록세', '인지세', '세율', '과세', '비과세', '감면',
  ],
  토지이용: [
    '토지', '토지이용', '용도지역', '용도지구', '건폐율', '용적률',
    '지목', '토지이용계획', '개발행위', '개발허가', '건축허가', '농지전용',
  ],
  재건축: [
    '재건축', '정비사업', '조합', '조합원', '정비구역', '관리처분',
    '분담금', '재건축초과이익', '안전진단', '정비계획', '매도청구',
  ],
  분양: [
    '분양', '분양권', '분양가', '분양계약', '청약', '청약통장',
    '당첨', '특별공급', '일반공급', '분양가상한제', '전매', '전매제한',
  ],
  경매: [
    '경매', '공매', '낙찰', '유찰', '입찰', '감정가', '매각',
    '배당', '배당요구', '경매개시', '임의경매', '강제경매',
  ],
  재개발: [
    '재개발', '도시재개발', '주택재개발', '재개발구역', '재개발조합',
    '이주대책', '세입자대책', '관리처분계획',
  ],
};

/**
 * 문장 분리에 사용되는 구분자 패턴
 * 한국어 문장 종결 또는 접속 표현을 기준으로 분리한다.
 */
const SENTENCE_DELIMITERS = /[.?!。]\s*|,\s*그리고\s*|,\s*또한\s*|,\s*그런데\s*|,\s*그래서\s*|\s+그리고\s+|\s+또한\s+|\s+그런데\s+|\s+그래서\s+|\s+그리고\s+|\s+한편\s+|\s+아울러\s+|\s+또\s+/;

/**
 * 질문 분해 및 하이브리드 검색 모듈 클래스
 *
 * 사용자의 복합 질문을 주제별로 분해하고, 각 하위 쿼리에 대해
 * 형태소 분석 + 동의어 확장 기반의 하이브리드 검색 쿼리를 생성한다.
 *
 * - 2개 이상의 서로 다른 법률 주제가 포함된 질문은 주제별로 분해하여 독립적으로 검색한다.
 * - 한국어와 영어가 혼합된 질문은 한국어 기준으로 해석하여 처리한다.
 * - 형태소 분석이 실패하면 원본 텍스트를 그대로 검색 쿼리로 사용한다.
 *
 * @requirements 3.5, 9.2, 9.3, 9.6, 9.7
 */
export class QueryDecomposer {
  private nlpModule: KoreanNLPModule;
  private synonymDictionary: SynonymDictionary;

  /**
   * @param nlpModule - 한국어 NLP 모듈 인스턴스
   * @param synonymDictionary - 동의어 사전 인스턴스
   */
  constructor(nlpModule: KoreanNLPModule, synonymDictionary: SynonymDictionary) {
    this.nlpModule = nlpModule;
    this.synonymDictionary = synonymDictionary;
  }

  /**
   * 복합 질문을 주제별 하위 쿼리로 분해한다.
   *
   * 1. 혼합 언어 감지 및 한국어 기준 정규화
   * 2. KoreanNLPModule.classifyTopic()을 사용하여 질문에 포함된 주제를 감지
   * 3. 2개 이상 주제가 감지되면 문장/절 단위로 분할하여 주제별 하위 쿼리 생성
   * 4. 단일 주제이면 전체 텍스트를 하나의 하위 쿼리로 구성
   *
   * @param query - 사용자 질문 텍스트
   * @returns 분해된 질문 결과
   *
   * @requirements 3.5, 9.6
   */
  decomposeQuery(query: string): DecomposedQuery {
    if (!query || query.trim().length === 0) {
      return {
        original: query || '',
        subQueries: [],
        topics: [],
        isRealEstateLaw: false,
      };
    }

    const trimmedQuery = query.trim();

    // 혼합 언어 처리: 한국어 기준으로 해석 (Requirements 9.6)
    const normalizedQuery = this.normalizeForKorean(trimmedQuery);

    // 주제 분류 수행
    let classificationResult;
    try {
      classificationResult = this.nlpModule.classifyTopic(normalizedQuery);
    } catch {
      // 형태소 분석 실패 시 원본 텍스트 그대로 사용 (Requirements 9.7)
      return this.buildFallbackResult(trimmedQuery);
    }

    const { isRealEstateLaw, topics } = classificationResult;

    // 주제가 감지되지 않은 경우: 원본 쿼리를 하나의 하위 쿼리로 반환
    if (topics.length === 0) {
      const keywords = this.safeExtractKeywords(normalizedQuery);
      return {
        original: trimmedQuery,
        subQueries: [{
          text: trimmedQuery,
          topic: 'general',
          searchType: 'both',
          keywords,
        }],
        topics: [],
        isRealEstateLaw: false,
      };
    }

    // 단일 주제: 전체 텍스트를 하나의 하위 쿼리로 구성
    if (topics.length === 1) {
      const topic = topics[0];
      const searchType = TOPIC_SEARCH_TYPE_MAP[topic] || 'both';
      const keywords = this.safeExtractKeywords(normalizedQuery);
      return {
        original: trimmedQuery,
        subQueries: [{
          text: trimmedQuery,
          topic,
          searchType,
          keywords,
        }],
        topics,
        isRealEstateLaw,
      };
    }

    // 2개 이상 주제: 주제별로 분해하여 독립적 하위 쿼리 생성
    const subQueries = this.splitByTopics(trimmedQuery, normalizedQuery, topics);

    return {
      original: trimmedQuery,
      subQueries,
      topics,
      isRealEstateLaw,
    };
  }

  /**
   * 검색 용어를 확장한다.
   *
   * 형태소 분석을 통해 키워드를 추출하고, 동의어 사전을 활용하여
   * 원본 질문 + 키워드 + 동의어를 통합한 확장된 검색 용어 목록을 반환한다.
   *
   * - KoreanNLPModule.extractKeywords()로 형태소 분석 기반 키워드 추출
   * - SynonymDictionary.expandQuery()로 동의어 확장
   * - 원본 + 키워드 + 동의어를 결합하여 중복 제거 후 반환
   *
   * @param query - 원본 검색 쿼리
   * @returns 확장된 검색 용어 배열
   *
   * @requirements 9.2, 9.3, 9.7
   */
  expandSearchTerms(query: string): string[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmedQuery = query.trim();
    const expandedTerms: Set<string> = new Set();

    // 1. 원본 쿼리를 항상 포함
    expandedTerms.add(trimmedQuery);

    // 2. 혼합 언어 정규화
    const normalizedQuery = this.normalizeForKorean(trimmedQuery);
    if (normalizedQuery !== trimmedQuery) {
      expandedTerms.add(normalizedQuery);
    }

    // 3. 형태소 분석으로 키워드 추출 (실패 시 빈 배열 - Requirements 9.7)
    const keywords = this.safeExtractKeywords(normalizedQuery);
    for (const keyword of keywords) {
      expandedTerms.add(keyword);
    }

    // 4. 동의어 확장 (원본 쿼리에 대해 - Requirements 9.3)
    const synonymExpanded = this.safeExpandSynonyms(normalizedQuery);
    for (const term of synonymExpanded) {
      expandedTerms.add(term);
    }

    // 5. 각 키워드에 대해서도 동의어 확장 수행
    for (const keyword of keywords) {
      const keywordSynonyms = this.safeExpandSynonyms(keyword);
      for (const syn of keywordSynonyms) {
        expandedTerms.add(syn);
      }
    }

    return Array.from(expandedTerms);
  }

  /**
   * 분해된 질문에 대한 하이브리드 검색 쿼리를 생성한다.
   *
   * 각 하위 쿼리에 대해 벡터 검색용 쿼리와 키워드 검색용 쿼리를 모두 생성한다.
   * - 벡터 검색: 원본 텍스트를 그대로 사용하여 의미적 유사도 검색
   * - 키워드 검색: 형태소 분석 + 동의어 확장을 통해 구체적 용어 기반 검색
   *
   * 혼합 언어(한국어 + 영어) 처리:
   * - 한국어 기준으로 해석하여 검색 쿼리 생성 (Requirements 9.6)
   *
   * 형태소 분석 실패 시:
   * - 원본 텍스트를 그대로 검색 쿼리로 사용 (Requirements 9.7)
   *
   * @param decomposed - 분해된 질문
   * @returns 하이브리드 검색 쿼리 배열 (각 하위 쿼리당 1개)
   *
   * @requirements 3.5, 9.2, 9.3, 9.6, 9.7
   */
  buildHybridSearchQueries(decomposed: DecomposedQuery): HybridSearchQuery[] {
    if (!decomposed || decomposed.subQueries.length === 0) {
      return [];
    }

    return decomposed.subQueries.map((subQuery) => {
      // 벡터 검색 쿼리: 원본 텍스트를 사용 (의미적 유사도 검색에 최적)
      const vectorQuery = subQuery.text;

      // 키워드 검색 쿼리: 형태소 분석 + 동의어 확장
      const keywordQuery = this.expandSearchTerms(subQuery.text);

      // 필터 생성: 주제와 검색 유형에 따른 문서 필터링
      const filters: Record<string, unknown> = {
        topic: subQuery.topic,
        searchType: subQuery.searchType,
      };

      // 검색 유형에 따라 문서 유형 필터 추가
      if (subQuery.searchType === 'law') {
        filters.documentType = 'law';
      } else if (subQuery.searchType === 'case') {
        filters.documentType = 'case';
      }
      // 'both'인 경우 필터 없음 (모든 문서 유형 검색)

      return {
        vectorQuery,
        keywordQuery,
        filters,
        topic: subQuery.topic,
      };
    });
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * 혼합 언어 질문을 한국어 기준으로 정규화한다.
   *
   * - 영어 법률 용어를 한국어 대응 용어로 매핑 (알려진 매핑만)
   * - 나머지 영어 텍스트는 그대로 유지 (검색 시 활용)
   * - 한국어가 주 언어이므로 전체 해석 기준은 한국어
   *
   * @param query - 원본 질문 텍스트
   * @returns 한국어 기준으로 정규화된 텍스트
   *
   * @requirements 9.6
   */
  private normalizeForKorean(query: string): string {
    const language = this.nlpModule.detectLanguage(query);

    // 순수 한국어면 그대로 반환
    if (language === 'korean') {
      return query;
    }

    // 혼합 언어(mixed) 또는 미인식(unknown): 알려진 영어 법률 용어를 한국어로 변환
    let normalized = query;

    for (const [english, korean] of ENGLISH_KOREAN_LEGAL_TERMS) {
      // 대소문자 무시하고 매칭
      const regex = new RegExp(english, 'gi');
      normalized = normalized.replace(regex, korean);
    }

    return normalized;
  }

  /**
   * 복합 질문을 주제별로 분할한다.
   *
   * 문장/절 단위로 텍스트를 분리하고, 각 문장/절이 어떤 주제에 해당하는지
   * 키워드 기반으로 판별하여 주제별 하위 쿼리를 생성한다.
   *
   * 분할 전략:
   * 1. 문장 구분자(마침표, 접속사 등)로 문장을 분리
   * 2. 각 문장에 포함된 주제 키워드로 주제 할당
   * 3. 특정 주제에 할당되지 않은 문장은 모든 주제에 컨텍스트로 포함
   *
   * @param originalQuery - 원본 질문
   * @param normalizedQuery - 정규화된 질문
   * @param topics - 감지된 주제 목록
   * @returns 주제별 하위 쿼리 배열
   */
  private splitByTopics(
    originalQuery: string,
    normalizedQuery: string,
    topics: string[]
  ): SubQuery[] {
    // 문장/절 단위로 분리
    const segments = this.splitIntoSegments(normalizedQuery);

    // 각 세그먼트를 주제에 할당
    const topicSegments: Map<string, string[]> = new Map();
    const unassignedSegments: string[] = [];

    for (const topic of topics) {
      topicSegments.set(topic, []);
    }

    for (const segment of segments) {
      const trimmedSegment = segment.trim();
      if (trimmedSegment.length === 0) continue;

      const assignedTopics = this.assignSegmentToTopics(trimmedSegment, topics);

      if (assignedTopics.length === 0) {
        // 어떤 주제에도 할당되지 않은 세그먼트는 공통 컨텍스트
        unassignedSegments.push(trimmedSegment);
      } else {
        for (const topic of assignedTopics) {
          topicSegments.get(topic)!.push(trimmedSegment);
        }
      }
    }

    // 주제별 하위 쿼리 생성
    const subQueries: SubQuery[] = [];

    for (const topic of topics) {
      const topicSegs = topicSegments.get(topic) || [];
      const searchType = TOPIC_SEARCH_TYPE_MAP[topic] || 'both';

      let queryText: string;
      if (topicSegs.length > 0) {
        // 주제에 할당된 세그먼트 + 공통 컨텍스트
        const allSegments = [...topicSegs, ...unassignedSegments];
        queryText = allSegments.join(' ');
      } else {
        // 주제에 직접 할당된 세그먼트가 없으면 전체 질문 사용
        queryText = originalQuery;
      }

      const keywords = this.safeExtractKeywords(queryText);

      subQueries.push({
        text: queryText,
        topic,
        searchType,
        keywords,
      });
    }

    return subQueries;
  }

  /**
   * 텍스트를 문장/절 단위 세그먼트로 분리한다.
   *
   * 마침표, 물음표, 접속사 등을 기준으로 분리한다.
   * 분리 후 빈 세그먼트는 제거한다.
   *
   * @param text - 분리할 텍스트
   * @returns 세그먼트 배열
   */
  private splitIntoSegments(text: string): string[] {
    const segments = text.split(SENTENCE_DELIMITERS);
    return segments.filter((s) => s.trim().length > 0);
  }

  /**
   * 세그먼트가 어떤 주제에 해당하는지 판별한다.
   *
   * 세그먼트 내에 해당 주제의 키워드가 포함되어 있는지 확인한다.
   *
   * @param segment - 판별할 텍스트 세그먼트
   * @param topics - 판별 대상 주제 목록
   * @returns 할당된 주제 배열
   */
  private assignSegmentToTopics(segment: string, topics: string[]): string[] {
    const assignedTopics: string[] = [];

    for (const topic of topics) {
      const keywords = TOPIC_KEYWORDS[topic];
      if (!keywords) continue;

      const hasTopicKeyword = keywords.some((keyword) =>
        segment.includes(keyword)
      );

      if (hasTopicKeyword) {
        assignedTopics.push(topic);
      }
    }

    return assignedTopics;
  }

  /**
   * 안전하게 키워드를 추출한다.
   * 형태소 분석 실패 시 빈 배열을 반환한다 (Requirements 9.7).
   *
   * @param text - 키워드를 추출할 텍스트
   * @returns 추출된 키워드 배열
   */
  private safeExtractKeywords(text: string): string[] {
    try {
      return this.nlpModule.extractKeywords(text);
    } catch {
      // 형태소 분석 실패 시 원본 텍스트의 어절 중 2글자 이상을 대체 키워드로 사용
      return this.extractFallbackKeywords(text);
    }
  }

  /**
   * 안전하게 동의어를 확장한다.
   * 동의어 확장 실패 시 빈 배열을 반환한다.
   *
   * @param query - 확장할 쿼리
   * @returns 동의어 확장 결과 (원본 포함)
   */
  private safeExpandSynonyms(query: string): string[] {
    try {
      const expanded = this.synonymDictionary.expandQuery(query);
      // expandQuery는 원본을 첫 번째로 포함하므로 원본 제외하고 반환
      return expanded.slice(1);
    } catch {
      return [];
    }
  }

  /**
   * 형태소 분석 실패 시 대체 키워드를 추출한다.
   *
   * 공백으로 분리 후 2글자 이상인 어절을 최대 10개까지 반환한다.
   *
   * @param text - 원본 텍스트
   * @returns 대체 키워드 배열
   */
  private extractFallbackKeywords(text: string): string[] {
    const words = text.split(/\s+/).filter((w) => w.length >= 2);
    return words.slice(0, 10);
  }

  /**
   * 형태소 분석 실패 시 폴백 결과를 생성한다.
   *
   * 원본 텍스트를 그대로 단일 하위 쿼리로 반환한다 (Requirements 9.7).
   *
   * @param query - 원본 질문 텍스트
   * @returns 폴백 분해 결과
   */
  private buildFallbackResult(query: string): DecomposedQuery {
    const keywords = this.extractFallbackKeywords(query);
    return {
      original: query,
      subQueries: [{
        text: query,
        topic: 'general',
        searchType: 'both',
        keywords,
      }],
      topics: [],
      isRealEstateLaw: false,
    };
  }
}

/**
 * 영어 법률 용어 → 한국어 대응 용어 매핑
 *
 * 혼합 언어 질문에서 영어 법률 용어를 한국어로 변환하여
 * 한국어 기준 해석을 지원한다.
 */
const ENGLISH_KOREAN_LEGAL_TERMS: [string, string][] = [
  ['lease', '임대차'],
  ['leasehold', '임차권'],
  ['tenant', '임차인'],
  ['landlord', '임대인'],
  ['deposit', '보증금'],
  ['rent', '임대료'],
  ['contract', '계약'],
  ['real estate', '부동산'],
  ['property', '부동산'],
  ['mortgage', '저당권'],
  ['registration', '등기'],
  ['tax', '세금'],
  ['capital gains tax', '양도소득세'],
  ['acquisition tax', '취득세'],
  ['property tax', '재산세'],
  ['auction', '경매'],
  ['foreclosure', '경매'],
  ['zoning', '용도지역'],
  ['broker', '중개사'],
  ['brokerage', '중개'],
  ['reconstruction', '재건축'],
  ['redevelopment', '재개발'],
  ['pre-sale', '분양'],
  ['eviction', '퇴거'],
  ['sublease', '전대'],
  ['easement', '지역권'],
  ['lien', '유치권'],
  ['title', '소유권'],
  ['deed', '등기'],
];
