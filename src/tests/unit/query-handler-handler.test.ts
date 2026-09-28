/**
 * @fileoverview 질문 처리 Lambda 핸들러 단위 테스트
 * @description POST /questions, GET /categories, OPTIONS, 30초 타임아웃 처리를 검증한다.
 *
 * @requirements 6.3, 6.4, 6.5
 */

import {
  createHandler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  QuestionResponse,
  QueryOrchestrator,
  OrchestratorFactory,
  FAQCategory,
} from '../../modules/query-handler/handler';
import { InputValidator } from '../../modules/query-handler/input-validator';
import { SessionManager, StoredSessionRecord } from '../../modules/query-handler/session-manager';

// Mock SessionManager
jest.mock('../../modules/query-handler/session-manager');

/**
 * 테스트용 API Gateway 이벤트를 생성한다.
 */
function createEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    httpMethod: 'GET',
    path: '/categories',
    resource: '/categories',
    queryStringParameters: null,
    pathParameters: null,
    requestContext: {
      requestId: 'test-request-id',
      stage: 'test',
    },
    ...overrides,
  };
}

/**
 * 테스트용 세션 레코드를 생성한다.
 */
function createMockSession(sessionId: string = 'sess_test_123'): StoredSessionRecord {
  return {
    sessionId,
    createdAt: new Date().toISOString(),
    conversations: [],
    lastActivityAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 86400,
  };
}

describe('Query Handler Lambda', () => {
  let mockSessionManager: jest.Mocked<SessionManager>;
  let inputValidator: InputValidator;

  beforeEach(() => {
    jest.clearAllMocks();

    inputValidator = new InputValidator();

    mockSessionManager = {
      createSession: jest.fn(),
      getSession: jest.fn(),
      addConversation: jest.fn(),
    } as unknown as jest.Mocked<SessionManager>;

    mockSessionManager.createSession.mockResolvedValue(createMockSession());
    mockSessionManager.addConversation.mockResolvedValue(createMockSession());
  });

  describe('OPTIONS - CORS 프리플라이트', () => {
    it('OPTIONS 요청에 CORS 헤더와 200 응답을 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({ httpMethod: 'OPTIONS', path: '/questions' });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('GET');
      expect(response.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    });
  });

  describe('GET /categories', () => {
    it('FAQ 카테고리 목록을 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({ httpMethod: 'GET', path: '/categories' });
      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.categories).toBeDefined();
      expect(Array.isArray(body.categories)).toBe(true);
    });

    it('임대차, 매매, 등기, 중개, 세금 카테고리를 포함한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({ httpMethod: 'GET', path: '/categories' });
      const response = await handler(event);
      const body = JSON.parse(response.body);

      const categoryIds = body.categories.map((c: FAQCategory) => c.id);
      expect(categoryIds).toContain('lease');
      expect(categoryIds).toContain('sale');
      expect(categoryIds).toContain('registration');
      expect(categoryIds).toContain('brokerage');
      expect(categoryIds).toContain('tax');
    });

    it('각 카테고리에 이름, 설명, 예시 질문이 포함된다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({ httpMethod: 'GET', path: '/categories' });
      const response = await handler(event);
      const body = JSON.parse(response.body);

      body.categories.forEach((category: FAQCategory) => {
        expect(category.id).toBeDefined();
        expect(category.name).toBeDefined();
        expect(category.description).toBeDefined();
        expect(category.exampleQuestions).toBeDefined();
        expect(category.exampleQuestions.length).toBeGreaterThan(0);
      });
    });

    it('CORS 헤더를 포함한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({ httpMethod: 'GET', path: '/categories' });
      const response = await handler(event);

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Content-Type']).toContain('application/json');
    });
  });

  describe('POST /questions - 입력 검증', () => {
    it('body가 없으면 400 오류를 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: null,
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('비어있습니다');
    });

    it('잘못된 JSON 형식이면 400 오류를 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: 'invalid json',
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('JSON');
    });

    it('query 필드가 없으면 400 오류를 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({}),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('query');
    });

    it('10자 미만 질문이면 400 오류를 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({ query: '짧은질문' }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('10자');
    });

    it('1000자 초과 질문이면 400 오류를 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const longQuery = '가'.repeat(1001);
      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({ query: longQuery }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('1000자');
    });
  });

  describe('POST /questions - 세션 관리', () => {
    it('sessionId 없이 요청 시 새 세션을 생성하고 sessionId를 반환한다', async () => {
      const mockOrchestrator: QueryOrchestrator = {
        processQuestion: jest.fn().mockResolvedValue({
          answer: '임대차보호법 관련 답변입니다.',
          citations: [],
        }),
      };

      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => mockOrchestrator },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({ query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?' }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as QuestionResponse;
      expect(body.success).toBe(true);
      expect(body.sessionId).toBeDefined();
      expect(mockSessionManager.createSession).toHaveBeenCalled();
    });

    it('유효한 sessionId로 요청 시 기존 세션을 사용한다', async () => {
      const existingSession = createMockSession('sess_existing_123');
      mockSessionManager.getSession.mockResolvedValue(existingSession);

      const mockOrchestrator: QueryOrchestrator = {
        processQuestion: jest.fn().mockResolvedValue({
          answer: '후속 질문에 대한 답변입니다.',
          citations: [],
        }),
      };

      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => mockOrchestrator },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({
          query: '그러면 보증금 반환을 받기 위한 절차는 어떻게 되나요?',
          sessionId: 'sess_existing_123',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as QuestionResponse;
      expect(body.sessionId).toBe('sess_existing_123');
      expect(mockSessionManager.getSession).toHaveBeenCalledWith('sess_existing_123');
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('만료된 sessionId로 요청 시 새 세션을 생성한다', async () => {
      mockSessionManager.getSession.mockResolvedValue(null);

      const mockOrchestrator: QueryOrchestrator = {
        processQuestion: jest.fn().mockResolvedValue({
          answer: '새 세션으로 답변합니다.',
          citations: [],
        }),
      };

      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => mockOrchestrator },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({
          query: '부동산 매매 계약 해제 시 위약금은 어떻게 산정하나요?',
          sessionId: 'sess_expired_123',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as QuestionResponse;
      expect(body.sessionId).toBeDefined();
      expect(mockSessionManager.createSession).toHaveBeenCalled();
    });
  });

  describe('POST /questions - 성공 응답', () => {
    it('오케스트레이터 응답을 올바르게 반환한다', async () => {
      const mockOrchestrator: QueryOrchestrator = {
        processQuestion: jest.fn().mockResolvedValue({
          answer: '주택임대차보호법 제3조의2에 따르면, 임대차 기간이 끝난 후 보증금을 반환받지 못한 임차인은 임차주택에 대해 우선변제권을 행사할 수 있습니다.',
          citations: [
            { type: 'law', source: '주택임대차보호법', content: '제3조의2', confidence: 0.95 },
          ],
        }),
      };

      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => mockOrchestrator },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({
          query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as QuestionResponse;
      expect(body.success).toBe(true);
      expect(body.answer).toContain('주택임대차보호법');
      expect(body.citations).toBeDefined();
      expect(body.citations!.length).toBeGreaterThan(0);
    });

    it('응답에 CORS 헤더를 포함한다', async () => {
      const mockOrchestrator: QueryOrchestrator = {
        processQuestion: jest.fn().mockResolvedValue({
          answer: '답변입니다.',
          citations: [],
        }),
      };

      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => mockOrchestrator },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({
          query: '부동산 등기 이전 절차에 대해 알려주세요.',
        }),
      });

      const response = await handler(event);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('POST /questions - 30초 타임아웃 처리', () => {
    it('30초 타임아웃 초과 시 504 응답과 안내 메시지를 반환한다', async () => {
      const slowOrchestrator: QueryOrchestrator = {
        processQuestion: jest.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            // 31초 후 응답 (타임아웃 초과)
            setTimeout(() => resolve({ answer: '늦은 답변', citations: [] }), 31000);
          });
        }),
      };

      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => slowOrchestrator },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({
          query: '전세보증금을 돌려받지 못할 때 어떻게 해야 하나요?',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(504);

      const body = JSON.parse(response.body) as QuestionResponse;
      expect(body.success).toBe(false);
      expect(body.error).toBe('응답 시간이 초과되었습니다. 다시 시도해 주세요.');
      expect(body.retryable).toBe(true);
      expect(body.sessionId).toBeDefined();
    }, 35000);

    it('오케스트레이터 오류 시 500 응답과 재시도 옵션을 반환한다', async () => {
      const failingOrchestrator: QueryOrchestrator = {
        processQuestion: jest.fn().mockRejectedValue(new Error('LLM 호출 실패')),
      };

      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => failingOrchestrator },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({
          query: '부동산 취득세율은 어떻게 되나요?',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body) as QuestionResponse;
      expect(body.success).toBe(false);
      expect(body.retryable).toBe(true);
      expect(body.sessionId).toBeDefined();
    });
  });

  describe('POST /questions - 오케스트레이터 미연결', () => {
    it('오케스트레이터가 null일 때 플레이스홀더 응답을 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
        orchestratorFactory: { create: () => null },
      });

      const event = createEvent({
        httpMethod: 'POST',
        path: '/questions',
        body: JSON.stringify({
          query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body) as QuestionResponse;
      expect(body.success).toBe(true);
      expect(body.sessionId).toBeDefined();
      expect(body.answer).toBeDefined();
    });
  });

  describe('라우팅 - 지원하지 않는 경로', () => {
    it('지원하지 않는 경로에 404를 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({ httpMethod: 'GET', path: '/unknown' });
      const response = await handler(event);

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('지원하지 않는');
    });

    it('지원하지 않는 메서드에 404를 반환한다', async () => {
      const handler = createHandler({
        inputValidator,
        sessionManager: mockSessionManager,
      });

      const event = createEvent({ httpMethod: 'DELETE', path: '/questions' });
      const response = await handler(event);

      expect(response.statusCode).toBe(404);
    });
  });
});
