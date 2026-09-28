/**
 * @fileoverview 질문 처리 오케스트레이터 단위 테스트
 * @description Orchestrator 클래스의 전체 질문-응답 파이프라인을 검증한다.
 *
 * 테스트 범위:
 * - 입력 검증 실패 시 오류 반환
 * - 범위 외 질문 시 즉시 안내 메시지 반환
 * - 정상 파이프라인 (검색 → 응답 생성 → 인용 → 세션 저장)
 * - 30초 타임아웃 적용
 * - 후속 질문 시 세션 컨텍스트 전달
 * - 각 단계 실패 시 graceful degradation
 */

import { Orchestrator, OrchestratorInput, OrchestratorOutput } from '../../modules/query-handler/orchestrator';
import { InputValidator } from '../../modules/query-handler/input-validator';
import { SessionManager, StoredSessionRecord } from '../../modules/query-handler/session-manager';
import { SearchModule } from '../../modules/search/index';
import { ResponseGeneratorModule } from '../../modules/response-generator/index';
import { CitationModule } from '../../modules/citation/index';
import { ScopeChecker } from '../../modules/response-generator/scope-checker';
import { ModuleOutput } from '../../common/interfaces/service-module';
import { CitationType } from '../../common/interfaces/data-models';
import { SearchResultType } from '../../common/interfaces/search';

// ─── Mock 헬퍼 ──────────────────────────────────────────────────────────────

function createMockSession(overrides?: Partial<StoredSessionRecord>): StoredSessionRecord {
  return {
    sessionId: 'sess_test_abc123',
    createdAt: new Date().toISOString(),
    conversations: [],
    lastActivityAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 86400,
    ...overrides,
  };
}

function createMockSearchOutput(): ModuleOutput {
  return {
    success: true,
    data: {
      results: [
        {
          id: 'law-1',
          type: SearchResultType.LAW,
          content: '주택임대차보호법 제3조의2에 따르면 보증금 반환 기한은...',
          score: 0.85,
          source: {
            title: '주택임대차보호법 제3조의2',
            url: 'https://law.go.kr/...',
            date: '2023-01-01',
            isLowRelevance: false,
          },
        },
        {
          id: 'case-1',
          type: SearchResultType.CASE,
          content: '대법원 2020다12345 판결에서는...',
          score: 0.78,
          source: {
            title: '대법원 2020다12345',
            date: '2020-05-15',
            isLowRelevance: false,
          },
        },
      ],
      totalCount: 2,
      searchTime: 450,
    },
  };
}

function createMockResponseOutput(): ModuleOutput {
  return {
    success: true,
    data: {
      answer: {
        text: '[질문 요약] 보증금 반환 기한에 대한 질문입니다.\n\n[관련 법령 설명] 주택임대차보호법 [1]에 따르면...\n\n[관련 판례 설명] 대법원 판결 [2]에서는...\n\n[종합 의견] 임대인은 계약 종료 후...\n\n[참고 자료] 위 법령 및 판례 참조',
        sections: [
          { title: '질문 요약', content: '보증금 반환 기한에 대한 질문입니다.' },
          { title: '관련 법령 설명', content: '주택임대차보호법에 따르면...' },
          { title: '관련 판례 설명', content: '대법원 판결에서는...' },
          { title: '종합 의견', content: '임대인은 계약 종료 후...' },
          { title: '참고 자료', content: '위 법령 및 판례 참조' },
        ],
        disclaimer: '본 답변은 참고용이며 법적 효력이 없습니다.',
        confidence: 0.82,
      },
      citations: [
        { type: CitationType.LAW, source: '주택임대차보호법 제3조의2', content: '요약', confidence: 0.85 },
        { type: CitationType.CASE, source: '대법원 2020다12345', content: '요지', confidence: 0.78 },
      ],
      metadata: {
        generationTime: 2500,
        model: 'claude-3-5-sonnet',
        isOutOfScope: false,
        disclaimerIncluded: true,
      },
    },
  };
}

function createMockCitationOutput(): ModuleOutput {
  return {
    success: true,
    data: {
      finalText: '최종 답변 텍스트 (인용 포함)\n\n---\n[1] 주택임대차보호법 제3조의2\n[2] 대법원 2020다12345',
      annotatedText: '답변 본문',
      footnoteList: '\n[1] 주택임대차보호법\n[2] 대법원 2020다12345',
      citations: [],
      hasCitations: true,
    },
  };
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('Orchestrator', () => {
  let mockSessionManager: jest.Mocked<SessionManager>;
  let mockSearchModule: jest.Mocked<SearchModule>;
  let mockResponseGenerator: jest.Mocked<ResponseGeneratorModule>;
  let mockCitationModule: jest.Mocked<CitationModule>;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    // SessionManager mock
    mockSessionManager = {
      createSession: jest.fn().mockResolvedValue(createMockSession()),
      getSession: jest.fn().mockResolvedValue(createMockSession()),
      addConversation: jest.fn().mockResolvedValue(createMockSession()),
    } as unknown as jest.Mocked<SessionManager>;

    // SearchModule mock
    mockSearchModule = {
      execute: jest.fn().mockResolvedValue(createMockSearchOutput()),
      initialize: jest.fn().mockResolvedValue(undefined),
      healthCheck: jest.fn(),
      getName: jest.fn().mockReturnValue('search'),
      getVersion: jest.fn().mockReturnValue('1.0.0'),
    } as unknown as jest.Mocked<SearchModule>;

    // ResponseGeneratorModule mock
    mockResponseGenerator = {
      execute: jest.fn().mockResolvedValue(createMockResponseOutput()),
      initialize: jest.fn().mockResolvedValue(undefined),
      healthCheck: jest.fn(),
      getName: jest.fn().mockReturnValue('response-generator'),
      getVersion: jest.fn().mockReturnValue('1.0.0'),
    } as unknown as jest.Mocked<ResponseGeneratorModule>;

    // CitationModule mock
    mockCitationModule = {
      execute: jest.fn().mockResolvedValue(createMockCitationOutput()),
      initialize: jest.fn().mockResolvedValue(undefined),
      healthCheck: jest.fn(),
      getName: jest.fn().mockReturnValue('citation-module'),
      getVersion: jest.fn().mockReturnValue('1.0.0'),
    } as unknown as jest.Mocked<CitationModule>;

    orchestrator = new Orchestrator(
      { timeoutMs: 30000 },
      {
        sessionManager: mockSessionManager,
        searchModule: mockSearchModule,
        responseGenerator: mockResponseGenerator,
        citationModule: mockCitationModule,
      },
    );
  });

  describe('입력 검증', () => {
    it('10자 미만 질문은 거부한다', async () => {
      const result = await orchestrator.process({ query: '짧은질문' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('10자 이상');
    });

    it('1000자 초과 질문은 거부한다', async () => {
      const longQuery = '가'.repeat(1001);
      const result = await orchestrator.process({ query: longQuery });

      expect(result.success).toBe(false);
      expect(result.error).toContain('1000자 이하');
    });

    it('빈 문자열 질문은 거부한다', async () => {
      const result = await orchestrator.process({ query: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('입력해 주세요');
    });

    it('공백만 입력된 경우 거부한다', async () => {
      const result = await orchestrator.process({ query: '          ' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('입력해 주세요');
    });
  });

  describe('범위 판별', () => {
    it('부동산 법률 범위 외 질문은 즉시 안내 메시지를 반환한다', async () => {
      const result = await orchestrator.process({
        query: '파이썬 프로그래밍에서 리스트 정렬은 어떻게 하나요?',
      });

      expect(result.success).toBe(true);
      expect(result.isOutOfScope).toBe(true);
      expect(result.answer).toContain('부동산 법률 관련 질문만 지원합니다');
      // 검색/응답 모듈은 호출되지 않아야 함
      expect(mockSearchModule.execute).not.toHaveBeenCalled();
      expect(mockResponseGenerator.execute).not.toHaveBeenCalled();
    });

    it('범위 외 질문도 세션에 기록한다', async () => {
      const result = await orchestrator.process({
        query: '파이썬 프로그래밍에서 리스트 정렬은 어떻게 하나요?',
      });

      expect(mockSessionManager.addConversation).toHaveBeenCalled();
    });
  });

  describe('정상 파이프라인', () => {
    it('전체 파이프라인이 성공적으로 실행된다', async () => {
      const result = await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.citations).toBeDefined();
      expect(result.isOutOfScope).toBe(false);
      expect(result.sessionId).toBeDefined();
    });

    it('검색 모듈이 올바른 입력으로 호출된다', async () => {
      await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(mockSearchModule.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'search',
          payload: expect.objectContaining({
            query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
          }),
        }),
      );
    });

    it('응답 생성 모듈이 검색 결과와 함께 호출된다', async () => {
      await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(mockResponseGenerator.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'generate_response',
          payload: expect.objectContaining({
            query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
            searchResults: expect.objectContaining({
              results: expect.any(Array),
            }),
          }),
        }),
      );
    });

    it('인용 모듈이 호출된다', async () => {
      await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(mockCitationModule.execute).toHaveBeenCalled();
    });

    it('세션에 대화가 저장된다', async () => {
      await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(mockSessionManager.addConversation).toHaveBeenCalledWith(
        'sess_test_abc123',
        '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
        expect.any(String),
        expect.any(Array),
      );
    });

    it('메타데이터에 처리 시간이 포함된다', async () => {
      const result = await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata!.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata!.processingStatus).toBe('completed');
    });
  });

  describe('세션 관리', () => {
    it('sessionId가 없으면 새 세션을 생성한다', async () => {
      await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(mockSessionManager.createSession).toHaveBeenCalled();
    });

    it('sessionId가 있으면 기존 세션을 조회한다', async () => {
      await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
        sessionId: 'sess_existing_123',
      });

      expect(mockSessionManager.getSession).toHaveBeenCalledWith('sess_existing_123');
    });

    it('존재하지 않는 세션 ID이면 새 세션을 생성한다', async () => {
      mockSessionManager.getSession.mockResolvedValue(null);

      const result = await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
        sessionId: 'sess_expired_123',
      });

      expect(mockSessionManager.createSession).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('후속 질문 컨텍스트', () => {
    it('이전 대화가 있으면 세션 컨텍스트를 응답 생성기에 전달한다', async () => {
      const sessionWithHistory = createMockSession({
        conversations: [
          {
            id: 'conv_1',
            timestamp: new Date().toISOString(),
            question: '전세 계약 시 주의사항은?',
            answer: '전세 계약 시에는...',
            citations: [],
          },
        ],
      });
      mockSessionManager.getSession.mockResolvedValue(sessionWithHistory);

      await orchestrator.process({
        query: '그럼 보증금 반환이 안 되면 어떻게 해야 하나요?',
        sessionId: 'sess_with_history',
      });

      expect(mockResponseGenerator.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            sessionContext: expect.arrayContaining([
              expect.objectContaining({
                question: '전세 계약 시 주의사항은?',
              }),
            ]),
          }),
        }),
      );
    });

    it('이전 대화가 없으면 sessionContext를 전달하지 않는다', async () => {
      mockSessionManager.getSession.mockResolvedValue(createMockSession({ conversations: [] }));

      await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
        sessionId: 'sess_new',
      });

      expect(mockResponseGenerator.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            sessionContext: undefined,
          }),
        }),
      );
    });
  });

  describe('타임아웃 관리', () => {
    it('30초 초과 시 타임아웃 응답을 반환한다', async () => {
      // 짧은 타임아웃으로 설정
      const timeoutOrchestrator = new Orchestrator(
        { timeoutMs: 50 },
        {
          sessionManager: mockSessionManager,
          searchModule: mockSearchModule,
          responseGenerator: mockResponseGenerator,
          citationModule: mockCitationModule,
        },
      );

      // 검색 모듈이 타임아웃보다 오래 걸리도록 설정
      mockSearchModule.execute.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(createMockSearchOutput()), 200)),
      );

      const result = await timeoutOrchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('응답 시간이 초과되었습니다');
      expect(result.metadata?.processingStatus).toBe('timeout');
    });
  });

  describe('오류 처리', () => {
    it('검색 실패 시 안내 메시지를 반환한다', async () => {
      mockSearchModule.execute.mockResolvedValue({
        success: false,
        errors: [{ code: 'SEARCH_FAILED', message: '검색 실패', severity: 'high' as any, timestamp: '' }],
      });

      const result = await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('일시적 오류');
    });

    it('응답 생성 실패 시 오류 메시지를 반환한다', async () => {
      mockResponseGenerator.execute.mockResolvedValue({
        success: false,
        errors: [{ code: 'LLM_TIMEOUT', message: '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.', severity: 'high' as any, timestamp: '' }],
      });

      const result = await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('다시 시도해 주세요');
    });

    it('인용 처리 실패 시 원본 답변으로 대체한다 (graceful degradation)', async () => {
      mockCitationModule.execute.mockResolvedValue({
        success: false,
        errors: [{ code: 'CITATION_ERROR', message: '인용 처리 실패', severity: 'medium' as any, timestamp: '' }],
      });

      const result = await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      // 인용 처리 실패해도 전체 응답은 성공
      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      // 면책 고지가 포함됨
      expect(result.answer).toContain('법적 효력이 없습니다');
    });

    it('예외 발생 시 일반 오류 메시지를 반환한다', async () => {
      mockSessionManager.createSession.mockRejectedValue(new Error('DynamoDB connection failed'));

      const result = await orchestrator.process({
        query: '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('일시적 오류');
    });
  });

  describe('shouldShowProcessingStatus', () => {
    it('2초 미만이면 false를 반환한다', () => {
      const now = Date.now();
      expect(orchestrator.shouldShowProcessingStatus(now)).toBe(false);
    });

    it('2초 이상이면 true를 반환한다', () => {
      const twoSecondsAgo = Date.now() - 2000;
      expect(orchestrator.shouldShowProcessingStatus(twoSecondsAgo)).toBe(true);
    });
  });
});
