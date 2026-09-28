/**
 * @fileoverview 검색 모듈 단위 테스트
 * @description SearchModule, EmbeddingClient, OpenSearchSearchClient의 핵심 기능을 테스트한다.
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 8.4
 */

import { SearchModule } from '../../modules/search/index';
import { OpenSearchSearchClient } from '../../modules/search/opensearch-client';
import { EmbeddingClient } from '../../modules/search/embedding-client';
import { SearchResultType } from '../../common/interfaces/search';
import { HealthStatusEnum } from '../../common/interfaces/service-module';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  InvokeModelCommand: jest.fn(),
}));

jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation(() => ({
    search: jest.fn(),
    cluster: { health: jest.fn() },
  })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue({ Items: [] }),
    }),
  },
  ScanCommand: jest.fn(),
}));

describe('SearchModule', () => {
  let searchModule: SearchModule;

  beforeEach(() => {
    searchModule = new SearchModule();
  });

  describe('getName()', () => {
    it('모듈 이름을 "search"로 반환한다', () => {
      expect(searchModule.getName()).toBe('search');
    });
  });

  describe('getVersion()', () => {
    it('모듈 버전을 "1.0.0"으로 반환한다', () => {
      expect(searchModule.getVersion()).toBe('1.0.0');
    });
  });

  describe('healthCheck()', () => {
    it('초기화되지 않은 상태에서는 UNHEALTHY를 반환한다', async () => {
      const health = await searchModule.healthCheck();
      expect(health.status).toBe(HealthStatusEnum.UNHEALTHY);
      expect(health.details).toHaveProperty('reason', 'Module not initialized');
    });

    it('초기화 후에는 HEALTHY를 반환한다', async () => {
      await searchModule.initialize({
        name: 'search',
        version: '1.0.0',
        enabled: true,
        config: {
          region: 'ap-northeast-2',
        },
      });

      const health = await searchModule.healthCheck();
      expect(health.status).toBe(HealthStatusEnum.HEALTHY);
      expect(health.details).toHaveProperty('initialized', true);
    });
  });

  describe('execute()', () => {
    it('초기화되지 않은 상태에서 실행하면 에러를 반환한다', async () => {
      const result = await searchModule.execute({
        type: 'search',
        payload: { query: '임대차보호법' },
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].code).toBe('MODULE_NOT_INITIALIZED');
    });

    it('초기화 후 OpenSearch 엔드포인트 없이도 빈 결과를 정상 반환한다', async () => {
      await searchModule.initialize({
        name: 'search',
        version: '1.0.0',
        enabled: true,
        config: {
          region: 'ap-northeast-2',
          openSearchEndpoint: '',
        },
      });

      // EmbeddingClient.embedQuery를 인스턴스 레벨로 모킹
      const mockVector = Array(1024).fill(0.1);
      const embedQuerySpy = jest.spyOn(EmbeddingClient.prototype, 'embedQuery').mockResolvedValue(mockVector);

      const result = await searchModule.execute({
        type: 'search',
        payload: { query: '임대차보호법 적용 조건은?' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const searchOutput = result.data as { results: unknown[]; totalCount: number };
      expect(searchOutput.results).toEqual([]);
      expect(searchOutput.totalCount).toBe(0);

      // 스파이 복원
      embedQuerySpy.mockRestore();
    });
  });
});

describe('OpenSearchSearchClient', () => {
  let mockClient: { search: jest.Mock; cluster: { health: jest.Mock } };

  beforeEach(() => {
    mockClient = {
      search: jest.fn(),
      cluster: { health: jest.fn() },
    };

    const { Client } = require('@opensearch-project/opensearch');
    Client.mockImplementation(() => mockClient);
  });

  describe('searchLaws()', () => {
    it('법령 인덱스에서 kNN 검색을 수행하고 결과를 점수 내림차순으로 반환한다', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            total: { value: 3 },
            hits: [
              {
                _id: 'law-1',
                _score: 0.95,
                _source: {
                  law_name: '주택임대차보호법',
                  article_content: '제3조 대항력',
                  effective_date: '2023-01-01',
                },
              },
              {
                _id: 'law-2',
                _score: 0.7,
                _source: {
                  law_name: '민법',
                  article_content: '제621조',
                  effective_date: '2020-01-01',
                },
              },
              {
                _id: 'law-3',
                _score: 0.3,
                _source: {
                  law_name: '부동산등기법',
                  article_content: '제1조',
                  effective_date: '2019-01-01',
                },
              },
            ],
          },
        },
      });

      const client = new OpenSearchSearchClient({
        endpoint: 'https://test-endpoint.com',
        relevanceThreshold: 0.5,
      });

      const results = await client.searchLaws(Array(1024).fill(0.1));

      // 점수 내림차순 정렬 확인
      expect(results.length).toBe(3);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);

      // 문서 유형 확인 (모두 LAW)
      results.forEach((r) => expect(r.type).toBe(SearchResultType.LAW));

      // 관련도 기준 미달 문서에 isLowRelevance: true 표시
      expect(results[0].source.isLowRelevance).toBe(false); // 0.95 >= 0.5
      expect(results[1].source.isLowRelevance).toBe(false); // 0.7 >= 0.5
      expect(results[2].source.isLowRelevance).toBe(true);  // 0.3 < 0.5
    });

    it('최대 5건 이하의 결과만 반환한다', async () => {
      const hits = Array.from({ length: 10 }, (_, i) => ({
        _id: `law-${i}`,
        _score: 1.0 - i * 0.05,
        _source: {
          law_name: `법률${i}`,
          article_content: `조항${i}`,
          effective_date: '2023-01-01',
        },
      }));

      mockClient.search.mockResolvedValue({
        body: { hits: { total: { value: 10 }, hits } },
      });

      const client = new OpenSearchSearchClient({
        endpoint: 'https://test-endpoint.com',
        defaultMaxResults: 5,
      });

      const results = await client.searchLaws(Array(1024).fill(0.1));
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('searchCases()', () => {
    it('판례 인덱스에서 kNN 검색을 수행하고 결과를 점수 내림차순으로 반환한다', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            total: { value: 2 },
            hits: [
              {
                _id: 'case-1',
                _score: 0.88,
                _source: {
                  case_number: '2023다12345',
                  chunk_content: '임대차 분쟁 관련 판결...',
                  judgment_date: '2023-06-01',
                },
              },
              {
                _id: 'case-2',
                _score: 0.4,
                _source: {
                  case_number: '2022가합9999',
                  chunk_content: '매매 계약 해제...',
                  judgment_date: '2022-03-15',
                },
              },
            ],
          },
        },
      });

      const client = new OpenSearchSearchClient({
        endpoint: 'https://test-endpoint.com',
        relevanceThreshold: 0.5,
      });

      const results = await client.searchCases(Array(1024).fill(0.1));

      // 판례 유형 확인
      results.forEach((r) => expect(r.type).toBe(SearchResultType.CASE));

      // 점수 내림차순 정렬
      expect(results[0].score).toBeGreaterThan(results[1].score);

      // 관련도 미달 표시
      expect(results[0].source.isLowRelevance).toBe(false); // 0.88 >= 0.5
      expect(results[1].source.isLowRelevance).toBe(true);  // 0.4 < 0.5
    });
  });

  describe('ping()', () => {
    it('연결 성공 시 true를 반환한다', async () => {
      mockClient.cluster.health.mockResolvedValue({ statusCode: 200 });

      const client = new OpenSearchSearchClient({
        endpoint: 'https://test-endpoint.com',
      });

      const result = await client.ping();
      expect(result).toBe(true);
    });

    it('연결 실패 시 false를 반환한다', async () => {
      mockClient.cluster.health.mockRejectedValue(new Error('Connection failed'));

      const client = new OpenSearchSearchClient({
        endpoint: 'https://test-endpoint.com',
      });

      const result = await client.ping();
      expect(result).toBe(false);
    });
  });
});

describe('EmbeddingClient', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('빈 텍스트 입력 시 에러를 발생시킨다', async () => {
    const client = new EmbeddingClient({ region: 'ap-northeast-2' });
    await expect(client.embedQuery('')).rejects.toThrow('임베딩 변환할 텍스트가 비어있습니다.');
  });

  it('공백만 있는 텍스트 입력 시 에러를 발생시킨다', async () => {
    const client = new EmbeddingClient({ region: 'ap-northeast-2' });
    await expect(client.embedQuery('   ')).rejects.toThrow('임베딩 변환할 텍스트가 비어있습니다.');
  });

  it('기본 설정값이 올바르게 적용된다', () => {
    const client = new EmbeddingClient();
    // EmbeddingClient가 기본 region으로 생성됨을 확인 (인스턴스 생성 성공)
    expect(client).toBeDefined();
  });

  it('타임아웃 설정을 사용자 지정할 수 있다', () => {
    const client = new EmbeddingClient({ timeoutMs: 5000 });
    expect(client).toBeDefined();
  });
});
