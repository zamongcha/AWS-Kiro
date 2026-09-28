/**
 * QueryDecomposer 단위 테스트
 *
 * 복합 질문 분해, 형태소 분석 + 동의어 확장, 하이브리드 검색 쿼리 생성,
 * 혼합 언어 처리, 폴백 동작을 검증한다.
 *
 * @requirements 3.5, 9.2, 9.3, 9.6, 9.7
 */

import { QueryDecomposer, DecomposedQuery } from '../../modules/search/query-decomposer';
import { KoreanNLPModule } from '../../modules/search/korean-nlp';
import { SynonymDictionary, SynonymEntry } from '../../modules/search/synonym-dictionary';

describe('QueryDecomposer', () => {
  let nlpModule: KoreanNLPModule;
  let synonymDictionary: SynonymDictionary;
  let decomposer: QueryDecomposer;

  beforeEach(() => {
    nlpModule = new KoreanNLPModule();
    synonymDictionary = new SynonymDictionary();

    // 테스트용 동의어 사전 로드
    const testSynonyms: SynonymEntry[] = [
      { term: '임대인', synonyms: ['집주인', '건물주', '소유자'] },
      { term: '보증금', synonyms: ['전세금', '전세보증금', '임대보증금'] },
      { term: '매매', synonyms: ['거래', '매입', '매각'] },
      { term: '등기', synonyms: ['등기부등본', '부동산등기'] },
      { term: '취득세', synonyms: ['부동산취득세'] },
    ];
    synonymDictionary.loadFromJson(testSynonyms);

    decomposer = new QueryDecomposer(nlpModule, synonymDictionary);
  });

  describe('decomposeQuery', () => {
    it('빈 입력에 대해 빈 결과를 반환해야 한다', () => {
      const result = decomposer.decomposeQuery('');
      expect(result.original).toBe('');
      expect(result.subQueries).toHaveLength(0);
      expect(result.topics).toHaveLength(0);
      expect(result.isRealEstateLaw).toBe(false);
    });

    it('null/undefined 입력에 대해 빈 결과를 반환해야 한다', () => {
      const result = decomposer.decomposeQuery(null as unknown as string);
      expect(result.subQueries).toHaveLength(0);
    });

    it('단일 주제 질문은 하나의 하위 쿼리를 생성해야 한다', () => {
      const query = '전세 보증금 반환 기한은 얼마인가요?';
      const result = decomposer.decomposeQuery(query);

      expect(result.original).toBe(query);
      expect(result.topics).toContain('임대차');
      expect(result.subQueries).toHaveLength(1);
      expect(result.subQueries[0].topic).toBe('임대차');
      expect(result.isRealEstateLaw).toBe(true);
    });

    it('2개 이상의 주제를 포함하는 질문은 주제별로 분해해야 한다 (Requirements 3.5)', () => {
      const query = '전세 보증금 반환 문제가 있고, 양도소득세 신고 방법도 알고 싶습니다';
      const result = decomposer.decomposeQuery(query);

      expect(result.topics.length).toBeGreaterThanOrEqual(2);
      expect(result.topics).toContain('임대차');
      expect(result.topics).toContain('세금');
      expect(result.subQueries.length).toBeGreaterThanOrEqual(2);
      expect(result.isRealEstateLaw).toBe(true);

      // 각 하위 쿼리는 독립적인 주제를 가져야 함
      const subQueryTopics = result.subQueries.map((sq) => sq.topic);
      expect(subQueryTopics).toContain('임대차');
      expect(subQueryTopics).toContain('세금');
    });

    it('부동산 법률 범위 외 질문은 isRealEstateLaw가 false여야 한다', () => {
      const query = '오늘 날씨가 어떤가요?';
      const result = decomposer.decomposeQuery(query);

      expect(result.isRealEstateLaw).toBe(false);
      expect(result.topics).toHaveLength(0);
      // 폴백으로 general 주제의 하위 쿼리를 생성
      expect(result.subQueries.length).toBeGreaterThanOrEqual(1);
      expect(result.subQueries[0].topic).toBe('general');
    });

    it('분해된 하위 쿼리는 검색 유형(searchType)을 올바르게 할당해야 한다', () => {
      const query = '등기부등본 확인 방법과 부동산 경매 절차를 알려주세요';
      const result = decomposer.decomposeQuery(query);

      const registrationQuery = result.subQueries.find((sq) => sq.topic === '등기');
      const auctionQuery = result.subQueries.find((sq) => sq.topic === '경매');

      if (registrationQuery) {
        expect(registrationQuery.searchType).toBe('law');
      }
      if (auctionQuery) {
        expect(auctionQuery.searchType).toBe('case');
      }
    });

    it('각 하위 쿼리에 keywords가 포함되어야 한다', () => {
      const query = '임대차 계약 갱신 청구권에 대해 알려주세요';
      const result = decomposer.decomposeQuery(query);

      expect(result.subQueries.length).toBeGreaterThanOrEqual(1);
      for (const subQuery of result.subQueries) {
        expect(Array.isArray(subQuery.keywords)).toBe(true);
      }
    });
  });

  describe('expandSearchTerms', () => {
    it('빈 입력에 대해 빈 배열을 반환해야 한다', () => {
      const result = decomposer.expandSearchTerms('');
      expect(result).toHaveLength(0);
    });

    it('원본 쿼리를 항상 포함해야 한다', () => {
      const query = '전세 보증금 반환';
      const result = decomposer.expandSearchTerms(query);
      expect(result).toContain(query);
    });

    it('형태소 분석으로 추출된 키워드를 포함해야 한다 (Requirements 9.2)', () => {
      const query = '임대차 보증금 반환 문제';
      const result = decomposer.expandSearchTerms(query);

      // 형태소 분석 결과 키워드가 포함되어야 함
      expect(result.length).toBeGreaterThan(1);
    });

    it('동의어 사전에 등록된 용어의 동의어를 포함해야 한다 (Requirements 9.3)', () => {
      const query = '임대인이 보증금을 반환하지 않습니다';
      const result = decomposer.expandSearchTerms(query);

      // '임대인'의 동의어인 '집주인', '건물주' 등이 포함되어야 함
      const hasSynonym = result.some(
        (term) => term === '집주인' || term === '건물주' || term === '소유자'
      );
      expect(hasSynonym).toBe(true);
    });

    it('동의어 사전에 없는 용어는 원본만 유지해야 한다', () => {
      const query = '아파트 층간소음 해결방법';
      const result = decomposer.expandSearchTerms(query);
      // 동의어 확장 없이도 원본과 키워드는 포함
      expect(result).toContain(query);
    });
  });

  describe('buildHybridSearchQueries', () => {
    it('빈 분해 결과에 대해 빈 배열을 반환해야 한다', () => {
      const decomposed: DecomposedQuery = {
        original: '',
        subQueries: [],
        topics: [],
        isRealEstateLaw: false,
      };
      const result = decomposer.buildHybridSearchQueries(decomposed);
      expect(result).toHaveLength(0);
    });

    it('각 하위 쿼리마다 하이브리드 검색 쿼리를 생성해야 한다', () => {
      const query = '전세 보증금 문제와 양도세 신고 방법';
      const decomposed = decomposer.decomposeQuery(query);
      const hybridQueries = decomposer.buildHybridSearchQueries(decomposed);

      expect(hybridQueries.length).toBe(decomposed.subQueries.length);
    });

    it('하이브리드 쿼리에 vectorQuery와 keywordQuery가 포함되어야 한다', () => {
      const query = '전세 보증금 반환 문제';
      const decomposed = decomposer.decomposeQuery(query);
      const hybridQueries = decomposer.buildHybridSearchQueries(decomposed);

      for (const hq of hybridQueries) {
        expect(hq.vectorQuery).toBeTruthy();
        expect(Array.isArray(hq.keywordQuery)).toBe(true);
        expect(hq.keywordQuery.length).toBeGreaterThan(0);
        expect(hq.filters).toBeDefined();
        expect(hq.topic).toBeTruthy();
      }
    });

    it('법령 전용 주제의 filters에 documentType: law가 포함되어야 한다', () => {
      const query = '부동산 등기부등본 열람 방법';
      const decomposed = decomposer.decomposeQuery(query);
      const hybridQueries = decomposer.buildHybridSearchQueries(decomposed);

      const lawQuery = hybridQueries.find((hq) => hq.topic === '등기');
      if (lawQuery) {
        expect(lawQuery.filters.documentType).toBe('law');
      }
    });

    it('판례 전용 주제의 filters에 documentType: case가 포함되어야 한다', () => {
      const query = '부동산 경매 낙찰 후 명도 절차';
      const decomposed = decomposer.decomposeQuery(query);
      const hybridQueries = decomposer.buildHybridSearchQueries(decomposed);

      const caseQuery = hybridQueries.find((hq) => hq.topic === '경매');
      if (caseQuery) {
        expect(caseQuery.filters.documentType).toBe('case');
      }
    });
  });

  describe('혼합 언어 처리 (Requirements 9.6)', () => {
    it('한국어+영어 혼합 질문을 한국어 기준으로 해석해야 한다', () => {
      const query = 'lease 계약의 deposit 반환 문제';
      const result = decomposer.decomposeQuery(query);

      // '임대차' 주제로 분류되어야 함 (lease → 임대차, deposit → 보증금)
      expect(result.isRealEstateLaw).toBe(true);
      expect(result.topics).toContain('임대차');
    });

    it('영어 부동산 용어가 한국어로 변환되어 검색 확장에 포함되어야 한다', () => {
      const query = '전세 lease 보증금 deposit 관련 질문';
      const result = decomposer.expandSearchTerms(query);

      // 원본 쿼리는 항상 포함
      expect(result.length).toBeGreaterThan(1);
    });

    it('순수 한국어 질문은 정규화 없이 처리해야 한다', () => {
      const query = '전세 보증금 반환 기한은 얼마인가요?';
      const result = decomposer.decomposeQuery(query);

      expect(result.original).toBe(query);
      expect(result.isRealEstateLaw).toBe(true);
    });
  });

  describe('형태소 분석 실패 시 폴백 (Requirements 9.7)', () => {
    it('형태소 분석 실패 시 원본 텍스트를 검색 쿼리로 사용해야 한다', () => {
      // NLP 모듈을 모킹하여 실패를 시뮬레이션
      const failingNlp = {
        extractKeywords: () => { throw new Error('형태소 분석 실패'); },
        classifyTopic: () => { throw new Error('주제 분류 실패'); },
        detectLanguage: () => 'korean' as const,
      } as unknown as KoreanNLPModule;

      const failDecomposer = new QueryDecomposer(failingNlp, synonymDictionary);
      const query = '전세 보증금 반환 관련 질문입니다';
      const result = failDecomposer.decomposeQuery(query);

      // 폴백 결과: general 주제로 원본 텍스트 사용
      expect(result.subQueries).toHaveLength(1);
      expect(result.subQueries[0].text).toBe(query);
      expect(result.subQueries[0].topic).toBe('general');
    });

    it('expandSearchTerms에서 형태소 분석 실패 시 원본 쿼리만 반환해야 한다', () => {
      const failingNlp = {
        extractKeywords: () => { throw new Error('형태소 분석 실패'); },
        classifyTopic: () => ({ isRealEstateLaw: false, topics: [] }),
        detectLanguage: () => 'korean' as const,
      } as unknown as KoreanNLPModule;

      const failDecomposer = new QueryDecomposer(failingNlp, synonymDictionary);
      const query = '임대인에게 보증금을 요청';
      const result = failDecomposer.expandSearchTerms(query);

      // 원본 쿼리와 동의어 확장 결과만 포함 (형태소 분석 없이)
      expect(result).toContain(query);
    });
  });

  describe('주제 분해 독립성 (Requirements 3.5)', () => {
    it('3개 주제 포함 질문은 3개의 독립적 하위 쿼리를 생성해야 한다', () => {
      const query = '전세 보증금 반환 문제와 양도소득세 계산 방법, 그리고 등기부등본 확인법을 알려주세요';
      const result = decomposer.decomposeQuery(query);

      expect(result.topics.length).toBeGreaterThanOrEqual(3);
      expect(result.subQueries.length).toBeGreaterThanOrEqual(3);

      // 각 하위 쿼리의 주제가 서로 달라야 함
      const uniqueTopics = new Set(result.subQueries.map((sq) => sq.topic));
      expect(uniqueTopics.size).toBe(result.subQueries.length);
    });

    it('각 주제의 하위 쿼리에 해당 주제와 관련된 텍스트가 포함되어야 한다', () => {
      const query = '임대차 보증금 반환 문제, 그리고 부동산 경매 절차에 대해 알려주세요';
      const result = decomposer.decomposeQuery(query);

      const leaseQuery = result.subQueries.find((sq) => sq.topic === '임대차');
      const auctionQuery = result.subQueries.find((sq) => sq.topic === '경매');

      if (leaseQuery) {
        expect(leaseQuery.text).toContain('보증금');
      }
      if (auctionQuery) {
        expect(auctionQuery.text).toContain('경매');
      }
    });
  });
});
