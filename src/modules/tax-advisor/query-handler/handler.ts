/**
 * @fileoverview 세무 질문 처리 Lambda 핸들러
 * @description 세무 자문 시스템의 API 엔드포인트를 처리하는 Lambda 핸들러이다.
 * POST /tax-advisor/questions: 세무 질문 처리
 * GET /tax-advisor/categories: 세무 카테고리 목록 반환
 * POST /tax-advisor/feedback: 피드백 수집
 *
 * @requirements 8.3, 8.4, 8.5, 8.9, 3.8
 */

import { TaxInputValidator } from './tax-input-validator.js';
import { TaxSessionManager } from './tax-session-manager.js';
import { TaxOrchestrator, TaxOrchestratorInput, TaxOrchestratorOutput } from './tax-orchestrator.js';

/**
 * API Gateway 이벤트 인터페이스
 */
export interface APIGatewayProxyEvent {
  body: string | null;
  headers: Record<string, string | undefined>;
  httpMethod: string;
  path: string;
  resource: string;
  queryStringParameters: Record<string, string> | null;
  pathParameters: Record<string, string> | null;
  requestContext: {
    requestId: string;
    stage: string;
  };
}

/**
 * API Gateway 응답 인터페이스
 */
export interface APIGatewayProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * 세무 질문 요청 본문
 */
export interface TaxQuestionRequestBody {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 세션 ID (선택) */
  sessionId?: string;
  /** 구조화된 수치 입력 보조 필드 */
  numericInputs?: Record<string, number>;
}

/**
 * 세무 피드백 요청 본문
 */
export interface TaxFeedbackRequestBody {
  sessionId: string;
  questionId: string;
  rating: 'helpful' | 'not_helpful';
  comment?: string;
}

/**
 * 세무 카테고리 항목
 */
export interface TaxCategory {
  id: string;
  name: string;
  description: string;
  exampleQuestions: string[];
}

/**
 * CORS 및 JSON 응답 헤더
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
 * 세무 카테고리 목록
 *
 * @requirements 8.3
 */
const TAX_CATEGORIES: TaxCategory[] = [
  {
    id: 'acquisition',
    name: '취득세',
    description: '부동산 취득 시 발생하는 세금 (매매, 신축, 증여취득 등)',
    exampleQuestions: [
      '아파트 취득세율이 어떻게 되나요?',
      '생애최초 주택 취득세 감면 조건은?',
      '다주택자 취득세 중과세율이 궁금합니다.',
    ],
  },
  {
    id: 'capital_gains',
    name: '양도소득세',
    description: '부동산 양도(매각) 시 발생하는 세금',
    exampleQuestions: [
      '1세대 1주택 양도소득세 비과세 요건은?',
      '장기보유특별공제 적용 조건을 알려주세요.',
      '다주택자 양도소득세 중과세율이 어떻게 되나요?',
    ],
  },
  {
    id: 'comprehensive_property',
    name: '종합부동산세',
    description: '고가 부동산 보유 시 부과되는 국세',
    exampleQuestions: [
      '종합부동산세 과세 기준액은 얼마인가요?',
      '1세대 1주택자 종부세 공제 혜택은?',
      '종부세 세부담 상한은 어떻게 적용되나요?',
    ],
  },
  {
    id: 'property',
    name: '재산세',
    description: '부동산 보유 중 매년 부과되는 지방세',
    exampleQuestions: [
      '재산세 납부 시기와 계산 방법은?',
      '재산세 과세표준 산정 방법이 궁금합니다.',
      '재산세 감면 대상 주택은?',
    ],
  },
  {
    id: 'gift',
    name: '증여세',
    description: '부동산 무상 이전(증여) 시 발생하는 세금',
    exampleQuestions: [
      '부모가 자녀에게 아파트 증여 시 세금은?',
      '증여세 면제 한도가 어떻게 되나요?',
      '부담부증여와 일반 증여의 세금 차이는?',
    ],
  },
  {
    id: 'inheritance',
    name: '상속세',
    description: '부동산 상속 시 발생하는 세금',
    exampleQuestions: [
      '상속세 기초공제 금액은 얼마인가요?',
      '배우자 상속 공제는 어떻게 적용되나요?',
      '상속 부동산 평가 방법을 알려주세요.',
    ],
  },
];

/**
 * 구조화된 로그 출력
 */
function logStructured(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: Record<string, unknown>): void {
  console.log(JSON.stringify({
    level,
    service: 'tax-advisor',
    message,
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

/**
 * JSON 응답 생성
 */
function createResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * POST /tax-advisor/questions 엔드포인트 처리
 */
async function handlePostQuestions(
  event: APIGatewayProxyEvent,
  orchestrator: TaxOrchestrator,
): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return createResponse(400, {
      success: false,
      error: '요청 본문이 비어있습니다.',
    });
  }

  let requestBody: TaxQuestionRequestBody;
  try {
    requestBody = JSON.parse(event.body) as TaxQuestionRequestBody;
  } catch {
    return createResponse(400, {
      success: false,
      error: '요청 본문의 JSON 형식이 올바르지 않습니다.',
    });
  }

  if (requestBody.query === undefined || requestBody.query === null) {
    return createResponse(400, {
      success: false,
      error: 'query 필드는 필수입니다.',
    });
  }

  // 오케스트레이터를 통한 전체 처리 (30초 타임아웃 내장)
  const orchestratorInput: TaxOrchestratorInput = {
    query: requestBody.query,
    sessionId: requestBody.sessionId,
    numericInputs: requestBody.numericInputs,
  };

  const result = await orchestrator.process(orchestratorInput);

  if (!result.success) {
    // 타임아웃
    if (result.metadata?.processingStatus === 'timeout') {
      logStructured('WARN', '세무 질문 처리 타임아웃 (30초 초과)', {
        sessionId: result.sessionId,
      });
      return createResponse(504, {
        success: false,
        sessionId: result.sessionId,
        error: '응답 시간이 초과되었습니다. 다시 시도해 주세요.',
        retryable: true,
      });
    }

    // 입력 검증 오류
    if (result.error?.includes('10자') || result.error?.includes('1000자') || result.error?.includes('입력해')) {
      return createResponse(400, {
        success: false,
        error: result.error,
      });
    }

    // 기타 오류
    logStructured('ERROR', '세무 질문 처리 중 오류', {
      sessionId: result.sessionId,
      error: result.error,
    });
    return createResponse(500, {
      success: false,
      sessionId: result.sessionId,
      error: result.error || '질문 처리 중 오류가 발생했습니다.',
      retryable: result.retryable ?? true,
    });
  }

  logStructured('INFO', '세무 질문 처리 완료', {
    sessionId: result.sessionId,
    isOutOfScope: result.isOutOfScope,
    totalTimeMs: result.metadata?.totalTimeMs,
    detectedTaxTypes: result.metadata?.detectedTaxTypes,
  });

  return createResponse(200, {
    success: true,
    sessionId: result.sessionId,
    answer: result.answer,
    citations: result.citations,
    calculationResult: result.calculationResult,
    taxSavingTips: result.taxSavingTips,
    isOutOfScope: result.isOutOfScope,
  });
}

/**
 * GET /tax-advisor/categories 엔드포인트 처리
 */
function handleGetCategories(): APIGatewayProxyResult {
  return createResponse(200, {
    success: true,
    categories: TAX_CATEGORIES,
  });
}

/**
 * POST /tax-advisor/feedback 엔드포인트 처리
 */
function handlePostFeedback(event: APIGatewayProxyEvent): APIGatewayProxyResult {
  if (!event.body) {
    return createResponse(400, {
      success: false,
      error: '요청 본문이 비어있습니다.',
    });
  }

  let requestBody: TaxFeedbackRequestBody;
  try {
    requestBody = JSON.parse(event.body) as TaxFeedbackRequestBody;
  } catch {
    return createResponse(400, {
      success: false,
      error: '요청 본문의 JSON 형식이 올바르지 않습니다.',
    });
  }

  if (!requestBody.sessionId || !requestBody.rating) {
    return createResponse(400, {
      success: false,
      error: 'sessionId와 rating은 필수입니다.',
    });
  }

  logStructured('INFO', '세무 피드백 수집', {
    sessionId: requestBody.sessionId,
    questionId: requestBody.questionId,
    rating: requestBody.rating,
    hasComment: !!requestBody.comment,
  });

  return createResponse(200, {
    success: true,
    message: '피드백이 저장되었습니다. 감사합니다.',
  });
}

/**
 * OPTIONS 프리플라이트 요청 처리
 */
function handleOptions(): APIGatewayProxyResult {
  return { statusCode: 200, headers: CORS_HEADERS, body: '' };
}

/**
 * 오케스트레이터 팩토리 인터페이스 (테스트/DI용)
 */
export interface TaxOrchestratorFactory {
  create(): TaxOrchestrator;
}

/** 캐시된 오케스트레이터 인스턴스 */
let cachedOrchestrator: TaxOrchestrator | null = null;

/**
 * 오케스트레이터 싱글턴을 가져온다 (Lambda 실행 환경 재사용).
 */
function getOrCreateOrchestrator(): TaxOrchestrator {
  if (!cachedOrchestrator) {
    cachedOrchestrator = new TaxOrchestrator({
      timeoutMs: RESPONSE_TIMEOUT_MS,
      region: process.env['AWS_REGION'] || 'ap-northeast-2',
      sessionsTableName: process.env['SESSIONS_TABLE'] || 'Sessions',
    });
  }
  return cachedOrchestrator;
}

/**
 * Lambda 핸들러 생성 팩토리
 *
 * @param deps - 선택적 의존성 주입
 */
export function createTaxHandler(deps?: {
  orchestratorFactory?: TaxOrchestratorFactory;
}): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    logStructured('INFO', '세무 자문 요청 수신', {
      httpMethod: event.httpMethod,
      path: event.path,
      requestId: event.requestContext?.requestId,
    });

    // OPTIONS 프리플라이트
    if (event.httpMethod === 'OPTIONS') {
      return handleOptions();
    }

    const method = event.httpMethod.toUpperCase();
    const path = event.path;

    // POST /tax-advisor/questions
    if (method === 'POST' && (path.endsWith('/questions') || path.includes('/tax-advisor/questions'))) {
      const orchestrator = deps?.orchestratorFactory
        ? deps.orchestratorFactory.create()
        : getOrCreateOrchestrator();
      return handlePostQuestions(event, orchestrator);
    }

    // GET /tax-advisor/categories
    if (method === 'GET' && (path.endsWith('/categories') || path.includes('/tax-advisor/categories'))) {
      return handleGetCategories();
    }

    // POST /tax-advisor/feedback
    if (method === 'POST' && (path.endsWith('/feedback') || path.includes('/tax-advisor/feedback'))) {
      return handlePostFeedback(event);
    }

    return createResponse(404, {
      success: false,
      error: `지원하지 않는 경로입니다: ${method} ${path}`,
    });
  };
}

/**
 * Lambda 핸들러 함수 (메인 진입점)
 *
 * 환경 변수:
 * - AWS_REGION: AWS 리전 (기본값: ap-northeast-2)
 * - SESSIONS_TABLE: DynamoDB 세션 테이블 이름
 *
 * 엔드포인트:
 * - POST /tax-advisor/questions: 세무 질문 처리
 * - GET /tax-advisor/categories: 세무 카테고리 목록
 * - POST /tax-advisor/feedback: 피드백 수집
 * - OPTIONS *: CORS 프리플라이트
 */
export const handler = createTaxHandler();
