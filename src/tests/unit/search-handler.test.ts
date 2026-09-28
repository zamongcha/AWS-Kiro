/**
 * @fileoverview 검색 Lambda 핸들러 단위 테스트
 * @description handler.ts의 핵심 기능을 검증한다:
 * - POST 요청 처리 및 검색 실행
 * - 입력 검증 (빈 입력, 형식 오류)
 * - 검색 실패 시 오류 메시지 반환 및 질문 텍스트 보존
 * - 5초 타임아웃 적용
 * - DynamoDB 검색 로그 기록
 * - CORS 헤더 포함
 *
 * @requirements 3.2, 3.6, 3.7
 */

import { handler, APIGatewayEvent } from '../../modules/search/handler';

// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

const mockSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: (...args: unknown[]) => mockSend(...args),
    }),
  },
  PutCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

// Mock SearchModule
const mockExecute = jest.fn();
const mockInitialize = jest.fn().mockResolvedValue(undefined);
jest.mock('../../modules/search/index', () => ({
  SearchModule: jest.fn().mockImplementation(() => ({
    initialize: (...args: unknown[]) => mockInitialize(...args),
    execute: (...args: unknown[]) => mockExecute(...args),
  })),
}));

describe('검색 Lambda 핸들러', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['OPENSEARCH_ENDPOINT'] = 'https://test-opensearch.com';
    process.env['AWS_REGION'] = 'ap-northeast-2';
    process.env['DYNAMODB_TABLE'] = 'SearchLogs';
  });

  afterEach(() => {
    delete process.env['OPENSEARCH_ENDPOINT'];
    delete process.env['AWS_REGION'];
    delete process.env['DYNAMODB_TABLE'];
  });

  function createEvent(body: unknown, method = 'POST'): APIGatewayEvent {
    return {
      body: body !== null ? JSON.stringify(body) : null,
      headers: { 'Content-Type': 'application/json' },
      httpMethod: method,
      path: '/search',
      queryStringParameters: null,
    };
  }

  describe('OPTIONS 요청 처리', () => {
    it('OPTIONS 프리플라이트 요청에 200을 반환한다', async () => {
      const event = createEvent(null, 'OPTIONS');
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
    });
  });

  describe('입력 검증', () => {
    it('요청 본문이 비어 있으면 400을 반환한다', async () => {
      const event: APIGatewayEvent = {
        body: null,
        headers: {},
        httpMethod: 'POST',
        path: '/search',
        queryStringParameters: null,
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('비어있습니다');
    });

    it('JSON 형식이 올바르지 않으면 400을 반환한다', async () => {
      const event: APIGatewayEvent = {
        body: 'invalid json{{{',
        headers: {},
        httpMethod: 'POST',
        path: '/search',
        queryStringParameters: null,
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('JSON');
    });

    it('query 필드가 없으면 400을 반환한다', async () => {
      const event = createEvent({ noQuery: 'test' });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('query');
    });

    it('빈 query 문자열은 400을 반환한다', async () => {
      const event = createEvent({ query: '' });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('공백만 있는 query 문자열은 400을 반환한다', async () => {
      const event = createEvent({ query: '   ' });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });

  describe('검색 성공 시', () => {
    it('유효한 질문에 대해 200과 검색 결과를 반환한다', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'doc-1',
              type: 'law',
              content: '주택임대차보호법 제3조',
              score: 0.85,
              source: { title: '주택임대차보호법', isLowRelevance: false },
            },
          ],
          totalCount: 1,
          searchTime: 120,
          metadata: { topics: ['임대차'], isRealEstateLaw: true },
        },
      });

      const event = createEvent({ query: '임대차보호법 적용 조건이 무엇인가요?' });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.results).toHaveLength(1);
      expect(body.data.totalCount).toBe(1);
    });

    it('응답에 원본 질문 텍스트가 포함된다', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: {
          results: [],
          totalCount: 0,
          searchTime: 50,
        },
      });

      const event = createEvent({ query: '부동산 등기 절차를 알려주세요' });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data.query).toBeDefined();
    });

    it('CORS 헤더가 포함된다', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: { results: [], totalCount: 0, searchTime: 10 },
      });

      const event = createEvent({ query: '전세보증금 반환 절차를 알려주세요' });
      const response = await handler(event);

      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('검색 실패 시 오류 처리 (Requirement 3.6)', () => {
    it('SearchModule.execute() 실패 시 500과 오류 메시지를 반환하며 질문 텍스트를 보존한다', async () => {
      mockExecute.mockResolvedValue({
        success: false,
        errors: [{
          code: 'SEARCH_FAILED',
          message: 'OpenSearch 연결 실패',
          severity: 'high',
          timestamp: new Date().toISOString(),
        }],
      });

      const event = createEvent({ query: '임대차 계약 해지 조건이 뭔가요?' });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      // 질문 텍스트 보존 검증 (Requirement 3.6)
      expect(body.query).toBeDefined();
    });

    it('SearchModule 초기화 실패 시 500과 질문 텍스트를 보존한다', async () => {
      mockInitialize.mockRejectedValueOnce(new Error('초기화 실패'));

      const event = createEvent({ query: '매매계약서에 필수 포함 사항은?' });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.query).toBeDefined();
    });

    it('예외 발생 시 500 에러를 반환하며 질문 텍스트를 보존한다', async () => {
      mockExecute.mockRejectedValue(new Error('예상치 못한 오류'));

      const event = createEvent({ query: '부동산 중개수수료 기준이 어떻게 되나요?' });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.query).toBeDefined();
    });
  });

  describe('5초 타임아웃 관리 (Requirement 3.2)', () => {
    it('검색이 5초를 초과하면 타임아웃 에러를 반환한다', async () => {
      // 6초 지연
      mockExecute.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 6000))
      );

      const event = createEvent({ query: '임대차보호법의 적용 범위를 알려주세요' });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('시간');
      // 타임아웃 시에도 질문 텍스트 보존
      expect(body.query).toBeDefined();
    }, 10000);

    it('검색이 5초 이내에 완료되면 성공 응답을 반환한다', async () => {
      mockExecute.mockImplementation(
        () => new Promise((resolve) =>
          setTimeout(() => resolve({
            success: true,
            data: { results: [], totalCount: 0, searchTime: 2000 },
          }), 2000)
        )
      );

      const event = createEvent({ query: '등기부등본 확인 방법을 알려주세요' });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    }, 10000);
  });

  describe('DynamoDB 검색 로그 기록 (Requirement 3.7)', () => {
    it('검색 성공 시 DynamoDB에 성공 로그를 기록한다', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: { results: [], totalCount: 0, searchTime: 100 },
      });

      const event = createEvent({ query: '전세권 설정 절차가 어떻게 되나요?' });
      await handler(event);

      // DynamoDB PutCommand가 호출되었는지 확인
      expect(mockSend).toHaveBeenCalled();
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.TableName).toBe('SearchLogs');
      expect(putCall.input.Item.success).toBe(true);
      expect(putCall.input.Item.query).toBeDefined();
    });

    it('검색 실패 시 DynamoDB에 실패 로그를 기록한다', async () => {
      mockExecute.mockResolvedValue({
        success: false,
        errors: [{ code: 'SEARCH_FAILED', message: '검색 오류', severity: 'high', timestamp: '' }],
      });

      const event = createEvent({ query: '공인중개사법 위반 사례를 알려주세요' });
      await handler(event);

      expect(mockSend).toHaveBeenCalled();
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.success).toBe(false);
      expect(putCall.input.Item.errorMessage).toBeDefined();
    });

    it('검색 로그에 TTL 값이 30일로 설정된다', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: { results: [], totalCount: 0, searchTime: 50 },
      });

      const event = createEvent({ query: '재건축 조합 설립 요건이 무엇인가요?' });
      await handler(event);

      expect(mockSend).toHaveBeenCalled();
      const putCall = mockSend.mock.calls[0][0];
      const item = putCall.input.Item;

      // TTL은 현재 시간 + 30일
      const nowInSeconds = Math.floor(Date.now() / 1000);
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      expect(item.ttl).toBeGreaterThanOrEqual(nowInSeconds + thirtyDaysInSeconds - 5);
      expect(item.ttl).toBeLessThanOrEqual(nowInSeconds + thirtyDaysInSeconds + 5);
    });

    it('DynamoDB 로그 기록 실패해도 검색 응답은 정상 반환된다', async () => {
      mockExecute.mockResolvedValue({
        success: true,
        data: { results: [], totalCount: 0, searchTime: 50 },
      });
      mockSend.mockRejectedValueOnce(new Error('DynamoDB 쓰기 실패'));

      const event = createEvent({ query: '토지이용계획 확인 방법을 알려주세요' });
      const response = await handler(event);

      // DynamoDB 실패에도 불구하고 검색 응답은 정상
      expect(response.statusCode).toBe(200);
    });

    it('DYNAMODB_TABLE 환경 변수가 없으면 로그 기록을 건너뛴다', async () => {
      delete process.env['DYNAMODB_TABLE'];

      mockExecute.mockResolvedValue({
        success: true,
        data: { results: [], totalCount: 0, searchTime: 50 },
      });

      const event = createEvent({ query: '임대차 보증금 보호 범위가 어떻게 되나요?' });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      // DynamoDB 쓰기가 호출되지 않음
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
