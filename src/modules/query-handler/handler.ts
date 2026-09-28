/**
 * @fileoverview 질문 처리 Lambda 핸들러
 * @description 사용자 질문을 받아 전체 질문-응답 파이프라인을 조율하는 Lambda 핸들러이다.
 * POST /questions 엔드포인트로 질문을 접수하고, GET /categories 엔드포인트로
 * 자주 묻는 질문 카테고리를 제공한다.
 * 30초 전체 응답 타임아웃을 관리하며, 초과 시 안내 메시지와 재시도 옵션을 반환한다.
 *
 * @requirements 6.3 - 자주 묻는 질문 카테고리 제공 (임대차, 매매, 등기, 중개, 세금)
 * @requirements 6.4 - 30초 이내 답변 생성, 초과 시 안내 메시지 + 재시도 옵션
 * @requirements 6.5 - 30초 타임아웃 초과 시 안내 메시지 + 재시도 옵션
 */

import { InputValidator } from './input-validator.js';
import { SessionManager, StoredSessionRecord } from './session-manager.js';
import { Citation } from '../../common/interfaces/data-models.js';
import { Orchestrator } from './orchestrator.js';
import { createInitializedOrchestrator, SystemConfig } from '../index.js';

/**
 * API Gateway 이벤트 인터페이스
 */
export interface APIGatewayProxyEvent {
  /** 요청 본문 (JSON 문자열) */
  body: string | null;
  /** 요청 헤더 */
  headers: Record<string, string | undefined>;
  /** HTTP 메서드 */
  httpMethod: string;
  /** 요청 경로 */
  path: string;
  /** 리소스 경로 */
  resource: string;
  /** 쿼리 스트링 파라미터 */
  queryStringParameters: Record<string, string> | null;
  /** 경로 파라미터 */
  pathParameters: Record<string, string> | null;
  /** 요청 컨텍스트 */
  requestContext: {
    requestId: string;
    stage: string;
  };
}

/**
 * API Gateway 응답 인터페이스
 */
export interface APIGatewayProxyResult {
  /** HTTP 상태 코드 */
  statusCode: number;
  /** 응답 헤더 */
  headers: Record<string, string>;
  /** 응답 본문 (JSON 문자열) */
  body: string;
}

/**
 * 질문 요청 본문 인터페이스
 */
export interface QuestionRequestBody {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 세션 ID (선택, 후속 질문 시 사용) */
  sessionId?: string;
}

/**
 * 질문 응답 인터페이스
 */
export interface QuestionResponse {
  /** 처리 성공 여부 */
  success: boolean;
  /** 세션 ID (후속 질문에 사용) */
  sessionId: string;
  /** AI 답변 텍스트 */
  answer?: string;
  /** 인용 목록 */
  citations?: Citation[];
  /** 오류 메시지 */
  error?: string;
  /** 재시도 가능 여부 */
  retryable?: boolean;
}

/**
 * FAQ 카테고리 항목 인터페이스
 */
export interface FAQCategory {
  /** 카테고리 ID */
  id: string;
  /** 카테고리 이름 (한국어) */
  name: string;
  /** 카테고리 설명 */
  description: string;
  /** 예시 질문 목록 */
  exampleQuestions: string[];
}

/**
 * 오케스트레이터 인터페이스
 *
 * 검색 → 응답 생성 → 인용 처리 파이프라인을 조율하는 인터페이스.
 * task 12.2에서 실제 구현체가 생성되며, handler는 이 인터페이스에 의존한다.
 */
export interface QueryOrchestrator {
  /**
   * 질문-응답 파이프라인 실행
   *
   * @param query - 사용자 질문
   * @param sessionContext - 이전 대화 컨텍스트 (선택)
   * @returns 답변 텍스트 및 인용 정보
   */
  processQuestion(query: string, sessionContext?: string[]): Promise<{
    answer: string;
    citations: Citation[];
  }>;
}

/**
 * 공통 CORS 및 JSON 응답 헤더
 */
const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

/** 전체 응답 타임아웃 (밀리초): 30초 */
const RESPONSE_TIMEOUT_MS = 30000;

/**
 * 자주 묻는 질문 카테고리 목록
 *
 * @requirements 6.3 - 임대차, 매매, 등기, 중개, 세금 카테고리 제공
 */
const FAQ_CATEGORIES: FAQCategory[] = [
  {
    id: 'lease',
    name: '임대차',
    description: '주택 및 상가 임대차 관련 법률 자문',
    exampleQuestions: [
      '전세보증금을 돌려받지 못할 때 어떻게 해야 하나요?',
      '임대차보호법에서 보증금 반환 기한은 어떻게 되나요?',
      '묵시적 갱신이란 무엇인가요?',
    ],
  },
  {
    id: 'sale',
    name: '매매',
    description: '부동산 매매 계약 및 거래 관련 법률 자문',
    exampleQuestions: [
      '매매 계약 해제 시 위약금은 어떻게 산정하나요?',
      '부동산 거래 신고 의무는 어떻게 되나요?',
      '매도인의 하자 담보 책임은 언제까지인가요?',
    ],
  },
  {
    id: 'registration',
    name: '등기',
    description: '부동산 등기 절차 및 효력 관련 법률 자문',
    exampleQuestions: [
      '소유권 이전 등기 절차는 어떻게 되나요?',
      '근저당권 설정과 말소 방법이 궁금합니다.',
      '가등기와 본등기의 차이는 무엇인가요?',
    ],
  },
  {
    id: 'brokerage',
    name: '중개',
    description: '부동산 중개 및 공인중개사 관련 법률 자문',
    exampleQuestions: [
      '부동산 중개수수료 상한은 어떻게 되나요?',
      '중개사의 확인 설명 의무 범위는 무엇인가요?',
      '중개 사고 시 손해배상 책임은 누구에게 있나요?',
    ],
  },
  {
    id: 'tax',
    name: '세금',
    description: '부동산 관련 세금(취득세, 양도세 등) 법률 자문',
    exampleQuestions: [
      '1가구 2주택 양도소득세 비과세 요건은 무엇인가요?',
      '부동산 취득세율은 어떻게 되나요?',
      '종합부동산세 과세 대상 기준이 궁금합니다.',
    ],
  },
];

/**
 * 구조화된 로그 출력
 */
function logStructured(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

/**
 * 타임아웃이 적용된 Promise를 반환한다.
 *
 * @param promise - 실행할 Promise
 * @param timeoutMs - 타임아웃 (밀리초)
 * @returns 원본 Promise 결과 또는 타임아웃 에러
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('TIMEOUT'));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * JSON 응답을 생성한다.
 *
 * @param statusCode - HTTP 상태 코드
 * @param body - 응답 본문 객체
 * @returns API Gateway 응답
 */
function createResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * POST /questions 엔드포인트 처리
 *
 * 사용자 질문을 받아 입력 검증 → 세션 관리 → 오케스트레이터 호출을 수행하고
 * 답변을 반환한다. 전체 처리가 30초를 초과하면 타임아웃 안내를 반환한다.
 *
 * @param event - API Gateway 이벤트
 * @param inputValidator - 입력 검증기 인스턴스
 * @param sessionManager - 세션 관리자 인스턴스
 * @param orchestrator - 질문 오케스트레이터 (선택, null이면 플레이스홀더 응답)
 * @returns API Gateway 응답
 *
 * @requirements 6.4, 6.5
 */
async function handlePostQuestions(
  event: APIGatewayProxyEvent,
  inputValidator: InputValidator,
  sessionManager: SessionManager,
  orchestrator: QueryOrchestrator | null,
): Promise<APIGatewayProxyResult> {
  // 요청 본문 파싱
  if (!event.body) {
    return createResponse(400, {
      success: false,
      error: '요청 본문이 비어있습니다.',
    });
  }

  let requestBody: QuestionRequestBody;
  try {
    requestBody = JSON.parse(event.body) as QuestionRequestBody;
  } catch {
    return createResponse(400, {
      success: false,
      error: '요청 본문의 JSON 형식이 올바르지 않습니다.',
    });
  }

  // 질문 필드 존재 여부 확인
  if (requestBody.query === undefined || requestBody.query === null) {
    return createResponse(400, {
      success: false,
      error: 'query 필드는 필수입니다.',
    });
  }

  // 입력 검증
  const validationResult = inputValidator.validate(requestBody.query);
  if (!validationResult.valid) {
    return createResponse(400, {
      success: false,
      error: validationResult.error,
    });
  }

  const query = requestBody.query.trim();

  // 세션 관리: 기존 세션 조회 또는 새 세션 생성
  let session: StoredSessionRecord;
  if (requestBody.sessionId) {
    const existingSession = await sessionManager.getSession(requestBody.sessionId);
    if (existingSession) {
      session = existingSession;
    } else {
      // 세션이 만료되었거나 존재하지 않으면 새 세션 생성
      session = await sessionManager.createSession();
    }
  } else {
    session = await sessionManager.createSession();
  }

  // 이전 대화 컨텍스트 추출 (후속 질문 시 사용)
  const sessionContext = session.conversations.map(
    (conv) => `Q: ${conv.question}\nA: ${conv.answer}`,
  );

  // 오케스트레이터를 통한 질문-응답 파이프라인 실행 (30초 타임아웃)
  try {
    if (!orchestrator) {
      // 오케스트레이터가 아직 연결되지 않은 경우 (개발 중)
      logStructured('WARN', '오케스트레이터가 연결되지 않았습니다. 플레이스홀더 응답을 반환합니다.');

      // 세션에 대화 기록 저장
      const placeholderAnswer = '현재 시스템 준비 중입니다. 잠시 후 다시 시도해 주세요.';
      await sessionManager.addConversation(session.sessionId, query, placeholderAnswer, []);

      return createResponse(200, {
        success: true,
        sessionId: session.sessionId,
        answer: placeholderAnswer,
        citations: [],
      } as QuestionResponse);
    }

    const result = await withTimeout(
      orchestrator.processQuestion(query, sessionContext),
      RESPONSE_TIMEOUT_MS,
    );

    // 세션에 대화 기록 저장
    await sessionManager.addConversation(
      session.sessionId,
      query,
      result.answer,
      result.citations,
    );

    logStructured('INFO', '질문 처리가 완료되었습니다.', {
      sessionId: session.sessionId,
      queryLength: query.length,
      answerLength: result.answer.length,
      citationCount: result.citations.length,
    });

    return createResponse(200, {
      success: true,
      sessionId: session.sessionId,
      answer: result.answer,
      citations: result.citations,
    } as QuestionResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 30초 타임아웃 처리
    if (errorMessage === 'TIMEOUT') {
      logStructured('WARN', '질문 처리 타임아웃 (30초 초과)', {
        sessionId: session.sessionId,
        queryLength: query.length,
      });

      return createResponse(504, {
        success: false,
        sessionId: session.sessionId,
        error: '응답 시간이 초과되었습니다. 다시 시도해 주세요.',
        retryable: true,
      } as QuestionResponse);
    }

    // 기타 오류
    logStructured('ERROR', '질문 처리 중 오류 발생', {
      sessionId: session.sessionId,
      error: errorMessage,
    });

    return createResponse(500, {
      success: false,
      sessionId: session.sessionId,
      error: '질문 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
    } as QuestionResponse);
  }
}

/**
 * GET /categories 엔드포인트 처리
 *
 * 자주 묻는 질문 카테고리 목록을 반환한다.
 *
 * @returns API Gateway 응답
 *
 * @requirements 6.3
 */
function handleGetCategories(): APIGatewayProxyResult {
  return createResponse(200, {
    success: true,
    categories: FAQ_CATEGORIES,
  });
}

/**
 * OPTIONS 프리플라이트 요청 처리
 *
 * @returns CORS 헤더를 포함한 빈 200 응답
 */
function handleOptions(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: '',
  };
}

/**
 * 오케스트레이터 팩토리 인터페이스
 *
 * 테스트 및 DI를 위해 오케스트레이터 생성 로직을 분리한다.
 */
export interface OrchestratorFactory {
  create(): QueryOrchestrator | null;
}

/**
 * 초기화된 Orchestrator 인스턴스 캐시
 *
 * Lambda 실행 환경에서 컨테이너 재사용 시 초기화 비용을 절감하기 위해
 * 한 번 생성된 Orchestrator를 캐시한다.
 */
let cachedOrchestrator: Orchestrator | null = null;
let orchestratorInitPromise: Promise<Orchestrator> | null = null;

/**
 * Orchestrator 싱글턴을 가져오거나, 아직 초기화되지 않았으면 초기화한다.
 * Lambda cold start 시 한 번만 초기화되고, warm start에서는 캐시를 재사용한다.
 */
async function getOrCreateOrchestrator(): Promise<Orchestrator> {
  if (cachedOrchestrator) {
    return cachedOrchestrator;
  }

  if (!orchestratorInitPromise) {
    orchestratorInitPromise = createInitializedOrchestrator().then((orch) => {
      cachedOrchestrator = orch;
      return orch;
    });
  }

  return orchestratorInitPromise;
}

/**
 * QueryOrchestrator 인터페이스를 구현하는 어댑터
 *
 * 실제 Orchestrator.process()를 QueryOrchestrator.processQuestion()으로 변환한다.
 */
class OrchestratorAdapter implements QueryOrchestrator {
  constructor(private readonly orchestrator: Orchestrator) {}

  async processQuestion(query: string, sessionContext?: string[]): Promise<{
    answer: string;
    citations: Citation[];
  }> {
    const result = await this.orchestrator.process({ query });

    if (!result.success) {
      throw new Error(result.error || '질문 처리 중 오류가 발생했습니다.');
    }

    return {
      answer: result.answer || '',
      citations: result.citations || [],
    };
  }
}

/**
 * 기본 오케스트레이터 팩토리
 *
 * 실제 Orchestrator를 초기화하고 QueryOrchestrator 인터페이스로 래핑하여 반환한다.
 * Lambda cold start 시에는 초기화에 시간이 걸릴 수 있으므로,
 * handler 레벨에서 null을 반환하고 비동기 초기화를 시도한다.
 *
 * 참고: createHandler 내부에서 비동기 초기화를 처리하므로,
 * 이 팩토리는 동기적으로 null을 반환하고 핸들러가 직접 비동기 초기화를 수행한다.
 */
const defaultOrchestratorFactory: OrchestratorFactory = {
  create(): QueryOrchestrator | null {
    // 캐시된 인스턴스가 있으면 즉시 반환
    if (cachedOrchestrator) {
      return new OrchestratorAdapter(cachedOrchestrator);
    }
    // 아직 초기화되지 않은 경우 null 반환 (핸들러에서 비동기 초기화 수행)
    return null;
  },
};

/**
 * Lambda 핸들러 생성 팩토리
 *
 * 의존성 주입을 지원하여 테스트 가능한 핸들러를 생성한다.
 * 기본 팩토리 사용 시 Lambda cold start에서 비동기 초기화를 수행한다.
 *
 * @param deps - 선택적 의존성 주입
 * @returns Lambda 핸들러 함수
 */
export function createHandler(deps?: {
  inputValidator?: InputValidator;
  sessionManager?: SessionManager;
  orchestratorFactory?: OrchestratorFactory;
}): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  const inputValidator = deps?.inputValidator || new InputValidator();
  const region = process.env['AWS_REGION'] || 'ap-northeast-2';
  const sessionsTableName = process.env['SESSIONS_TABLE'] || 'Sessions';
  const sessionManager = deps?.sessionManager || new SessionManager(region, sessionsTableName);
  const orchestratorFactory = deps?.orchestratorFactory || defaultOrchestratorFactory;

  // Lambda cold start 시 백그라운드에서 Orchestrator 초기화 시작
  if (!deps?.orchestratorFactory) {
    getOrCreateOrchestrator().catch((err) => {
      logStructured('ERROR', 'Orchestrator 백그라운드 초기화 실패', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    logStructured('INFO', '요청 수신', {
      httpMethod: event.httpMethod,
      path: event.path,
      requestId: event.requestContext?.requestId,
    });

    // OPTIONS 프리플라이트 요청 처리
    if (event.httpMethod === 'OPTIONS') {
      return handleOptions();
    }

    // 라우팅
    const method = event.httpMethod.toUpperCase();
    const path = event.path;

    // POST /questions
    if (method === 'POST' && (path === '/questions' || path.endsWith('/questions'))) {
      // 동기 팩토리에서 먼저 시도, 없으면 비동기 초기화 시도
      let orchestrator = orchestratorFactory.create();

      if (!orchestrator && !deps?.orchestratorFactory) {
        try {
          const orch = await getOrCreateOrchestrator();
          orchestrator = new OrchestratorAdapter(orch);
        } catch (err) {
          logStructured('ERROR', 'Orchestrator 초기화 실패', {
            error: err instanceof Error ? err.message : String(err),
          });
          // orchestrator가 null인 채로 진행 (플레이스홀더 응답)
        }
      }

      return handlePostQuestions(event, inputValidator, sessionManager, orchestrator);
    }

    // GET /categories
    if (method === 'GET' && (path === '/categories' || path.endsWith('/categories'))) {
      return handleGetCategories();
    }

    // 지원하지 않는 경로
    return createResponse(404, {
      success: false,
      error: `지원하지 않는 경로입니다: ${method} ${path}`,
    });
  };
}

/**
 * Lambda 핸들러 함수
 *
 * API Gateway REST API에서 호출되는 메인 진입점이다.
 * 환경 변수:
 * - AWS_REGION: AWS 리전 (기본값: ap-northeast-2)
 * - SESSIONS_TABLE: DynamoDB 세션 테이블 이름 (기본값: Sessions)
 *
 * 엔드포인트:
 * - POST /questions: 사용자 질문 처리
 * - GET /categories: FAQ 카테고리 목록 반환
 * - OPTIONS *: CORS 프리플라이트 처리
 *
 * @param event - API Gateway Proxy 이벤트
 * @returns API Gateway Proxy 응답
 */
export const handler = createHandler();
