/**
 * @fileoverview 응답 생성 Lambda 핸들러 단위 테스트
 * @description handler.ts의 입력 검증, 에러 처리, CORS 헤더 동작을 검증한다.
 */

import { handler, APIGatewayEvent, APIGatewayResponse } from '../../modules/response-generator/handler.js';
import { ResponseGeneratorModule } from '../../modules/response-generator/index.js';
import { SearchOutput, SearchResultType } from '../../common/interfaces/search.js';

// Mock ResponseGeneratorModule
jest.mock('../../modules/response-generator/index.js');

const MockResponseGeneratorModule = ResponseGeneratorModule as jest.MockedClass<typeof ResponseGeneratorModule>;

function createEvent(overrides: Partial<APIGatewayEvent> = {}): APIGatewayEvent {
  return {
    body: null,
    headers: { 'Content-Type': 'application/json' },
    httpMethod: 'POST',
    path: '/response',
    queryStringParameters: null,
    ...overrides,
  };
}

function createValidSearchResults(): SearchOutput {
  return {
    results: [
      {
        id: 'law-1',
        type: SearchResultType.LAW,
        content: '주택임대차보호법 제3조 ...',
        score: 0.92,
        source: { title: '주택임대차보호법 제3조' },
      },
    ],
    totalCount: 1,
    searchTime: 120,
  };
}

function createValidBody() {
  return JSON.stringify({
    query: '임대차 보증금 반환에 대한 법적 권리는 무엇인가요?',
    searchResults: createValidSearchResults(),
  });
}

describe('응답 생성 Lambda 핸들러', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockResponseGeneratorModule.prototype.initialize = jest.fn().mockResolvedValue(undefined);
  });

  describe('CORS 및 프리플라이트', () => {
    it('OPTIONS 요청에 대해 200과 CORS 헤더를 반환해야 한다', async () => {
      const event = createEvent({ httpMethod: 'OPTIONS' });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toBe('POST,OPTIONS');
      expect(response.headers['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
    });

    it('모든 응답에 CORS 헤더가 포함되어야 한다', async () => {
      const event = createEvent({ body: createValidBody() });
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockResolvedValue({
        success: true,
        data: { answer: { text: '테스트 답변입니다.' } },
      });

      const response = await handler(event);

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('입력 검증', () => {
    it('빈 요청 본문에 대해 400을 반환해야 한다', async () => {
      const event = createEvent({ body: null });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('요청 본문이 비어있습니다');
    });

    it('잘못된 JSON에 대해 400을 반환해야 한다', async () => {
      const event = createEvent({ body: 'invalid json{' });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('JSON 형식');
    });

    it('query가 없으면 400을 반환해야 한다', async () => {
      const event = createEvent({
        body: JSON.stringify({ searchResults: createValidSearchResults() }),
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('query 필드는 필수');
    });

    it('빈 query에 대해 400을 반환해야 한다', async () => {
      const event = createEvent({
        body: JSON.stringify({ query: '   ', searchResults: createValidSearchResults() }),
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('query 필드는 필수');
    });

    it('searchResults가 없으면 400을 반환해야 한다', async () => {
      const event = createEvent({
        body: JSON.stringify({ query: '임대차 보증금 반환에 대해 알려주세요.' }),
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('searchResults 필드는 필수');
    });
  });

  describe('성공 응답', () => {
    it('정상 요청에 대해 200과 생성된 응답을 반환해야 한다', async () => {
      const mockOutput = {
        answer: { text: '임대차 보증금에 대한 답변입니다.', sections: [] },
        citations: [],
        metadata: { generationTime: 2500, model: 'claude-3.5-sonnet' },
      };

      MockResponseGeneratorModule.prototype.execute = jest.fn().mockResolvedValue({
        success: true,
        data: mockOutput,
        metadata: { generationTimeMs: '2500', model: 'claude-3.5-sonnet' },
      });

      const event = createEvent({ body: createValidBody() });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(mockOutput);
    });

    it('sessionContext가 포함된 요청도 처리해야 한다', async () => {
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockResolvedValue({
        success: true,
        data: { answer: { text: '후속 답변입니다.' } },
      });

      const event = createEvent({
        body: JSON.stringify({
          query: '그러면 보증금 증액 시에는?',
          searchResults: createValidSearchResults(),
          sessionContext: [{
            id: 'conv-1',
            timestamp: new Date().toISOString(),
            question: '임대차 보증금 반환에 대해 알려주세요.',
            answer: '보증금 반환은...',
            citations: [],
          }],
        }),
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('LLM 타임아웃 처리', () => {
    it('모듈이 LLM_TIMEOUT 에러를 반환하면 타임아웃 메시지를 반환해야 한다', async () => {
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockResolvedValue({
        success: false,
        errors: [{
          code: 'LLM_TIMEOUT',
          message: '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.',
          severity: 'high',
          timestamp: new Date().toISOString(),
        }],
      });

      const event = createEvent({ body: createValidBody() });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe('답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.');
    });

    it('예외로 타임아웃이 발생해도 타임아웃 메시지를 반환해야 한다', async () => {
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockRejectedValue(
        new Error('LLM 호출 타임아웃: 60초 이내에 응답하지 못했습니다.')
      );

      const event = createEvent({ body: createValidBody() });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.');
    });
  });

  describe('LLM 호출 실패 처리', () => {
    it('모듈이 일반 에러를 반환하면 일시적 오류 메시지를 반환해야 한다', async () => {
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockResolvedValue({
        success: false,
        errors: [{
          code: 'RESPONSE_GENERATION_FAILED',
          message: 'Bedrock 서비스 장애',
          severity: 'medium',
          timestamp: new Date().toISOString(),
        }],
      });

      const event = createEvent({ body: createValidBody() });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('일시적 오류가 발생했습니다. 다시 시도해 주세요.');
    });

    it('예외가 발생해도 일시적 오류 메시지를 반환해야 한다', async () => {
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockRejectedValue(
        new Error('네트워크 연결 실패')
      );

      const event = createEvent({ body: createValidBody() });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('일시적 오류가 발생했습니다. 다시 시도해 주세요.');
    });

    it('모듈 초기화 실패 시 일시적 오류 메시지를 반환해야 한다', async () => {
      MockResponseGeneratorModule.prototype.initialize = jest.fn().mockRejectedValue(
        new Error('Bedrock 클라이언트 초기화 실패')
      );

      const event = createEvent({ body: createValidBody() });
      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('일시적 오류가 발생했습니다. 다시 시도해 주세요.');
    });
  });

  describe('CloudWatch 로그 출력', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('요청 수신 시 INFO 로그를 출력해야 한다', async () => {
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockResolvedValue({
        success: true,
        data: { answer: { text: '답변' } },
      });

      const event = createEvent({ body: createValidBody() });
      await handler(event);

      const calls = consoleSpy.mock.calls;
      const firstLog = JSON.parse(calls[0][0]);
      expect(firstLog.level).toBe('INFO');
      expect(firstLog.message).toContain('요청을 수신');
    });

    it('에러 발생 시 ERROR 로그를 출력해야 한다', async () => {
      MockResponseGeneratorModule.prototype.execute = jest.fn().mockRejectedValue(
        new Error('테스트 에러')
      );

      const event = createEvent({ body: createValidBody() });
      await handler(event);

      const calls = consoleSpy.mock.calls;
      const errorLogs = calls
        .map(c => JSON.parse(c[0]))
        .filter((l: { level: string }) => l.level === 'ERROR');

      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs[0].error).toContain('테스트 에러');
    });
  });
});
