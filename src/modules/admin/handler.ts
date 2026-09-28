/**
 * @fileoverview 관리 Lambda 핸들러
 * @description API Gateway에서 전달받은 요청을 처리하여 데이터 현황 조회 및
 * 피드백 수집 기능을 제공한다.
 *
 * 엔드포인트:
 * - GET /admin/status: 데이터 현황 조회 (법령 수, 판례 수, 벡터 적재 상태)
 * - POST /feedback: 사용자 피드백 제출
 *
 * @requirements 7.1 - 수집된 법령 수, 판례 수 조회
 * @requirements 7.2 - 최종 갱신 일시 조회
 * @requirements 7.3 - 벡터 적재 상태 조회
 * @requirements 3.7 - 검색 로그 저장
 * @requirements 3.8 - 피드백 수집 및 검색 품질 관리
 */

import { AdminModule } from './index.js';
import { FeedbackSubmission } from './feedback-collector.js';

/**
 * API Gateway 프록시 이벤트 인터페이스
 */
export interface APIGatewayProxyEvent {
  /** HTTP 메서드 */
  httpMethod: string;
  /** 리소스 경로 */
  path: string;
  /** 요청 바디 (JSON 문자열) */
  body: string | null;
  /** 쿼리 문자열 파라미터 */
  queryStringParameters: Record<string, string> | null;
  /** 경로 파라미터 */
  pathParameters: Record<string, string> | null;
  /** 요청 헤더 */
  headers: Record<string, string>;
}

/**
 * API Gateway 프록시 응답 인터페이스
 */
export interface APIGatewayProxyResult {
  /** HTTP 상태 코드 */
  statusCode: number;
  /** 응답 헤더 */
  headers: Record<string, string>;
  /** 응답 바디 (JSON 문자열) */
  body: string;
}

/**
 * 공통 CORS 헤더
 */
const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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
 * 성공 응답 생성
 */
function successResponse(data: unknown, statusCode = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}

/**
 * 에러 응답 생성
 */
function errorResponse(message: string, statusCode = 500): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: false,
      error: { message },
    }),
  };
}

/**
 * 관리 Lambda 핸들러
 *
 * API Gateway REST API로부터 호출되며, 경로와 HTTP 메서드에 따라
 * 적절한 관리 기능을 실행한다.
 *
 * 환경 변수:
 * - DATA_MANAGEMENT_TABLE: DataManagement DynamoDB 테이블 이름
 * - FEEDBACK_TABLE: Feedback DynamoDB 테이블 이름
 * - AWS_REGION: AWS 리전
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logStructured('INFO', '관리 API 요청을 수신했습니다.', {
    method: event.httpMethod,
    path: event.path,
  });

  // OPTIONS 요청 처리 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  // AdminModule 초기화
  const adminModule = new AdminModule();
  await adminModule.initialize({
    name: 'admin',
    version: '1.0.0',
    enabled: true,
    config: {
      dataManagementTable: process.env['DATA_MANAGEMENT_TABLE'] || 'DataManagement',
      feedbackTable: process.env['FEEDBACK_TABLE'] || 'Feedback',
      region: process.env['AWS_REGION'] || 'ap-northeast-2',
    },
  });

  try {
    // 라우팅
    if (event.httpMethod === 'GET' && event.path.endsWith('/admin/status')) {
      return await handleGetStatus(adminModule);
    }

    if (event.httpMethod === 'POST' && event.path.endsWith('/feedback')) {
      return await handlePostFeedback(adminModule, event);
    }

    // 지원하지 않는 경로
    return errorResponse(`지원하지 않는 요청입니다: ${event.httpMethod} ${event.path}`, 404);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStructured('ERROR', '관리 API 요청 처리 중 오류가 발생했습니다.', {
      error: errorMessage,
    });
    return errorResponse('서버 내부 오류가 발생했습니다. 다시 시도해 주세요.', 500);
  }
};

/**
 * GET /admin/status 핸들러
 *
 * 데이터 현황 조회: 법령 수, 판례 수, 최종 갱신 일시, 벡터 적재 상태
 */
async function handleGetStatus(adminModule: AdminModule): Promise<APIGatewayProxyResult> {
  const output = await adminModule.execute({
    type: 'getStatus',
    payload: {},
  });

  if (!output.success) {
    logStructured('ERROR', '데이터 현황 조회 실패', { errors: output.errors });
    return errorResponse('데이터 현황 조회에 실패했습니다.', 500);
  }

  logStructured('INFO', '데이터 현황 조회 성공');
  return successResponse(output.data);
}

/**
 * POST /feedback 핸들러
 *
 * 사용자 피드백 제출: sessionId, questionId, rating 필수
 */
async function handlePostFeedback(
  adminModule: AdminModule,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  // 요청 바디 파싱
  if (!event.body) {
    return errorResponse('요청 본문이 비어있습니다.', 400);
  }

  let feedbackInput: FeedbackSubmission;
  try {
    feedbackInput = JSON.parse(event.body) as FeedbackSubmission;
  } catch {
    return errorResponse('유효하지 않은 JSON 형식입니다.', 400);
  }

  // 필수 필드 검증
  if (!feedbackInput.sessionId || !feedbackInput.questionId || !feedbackInput.rating) {
    return errorResponse('sessionId, questionId, rating은 필수 항목입니다.', 400);
  }

  if (feedbackInput.rating !== 'helpful' && feedbackInput.rating !== 'not_helpful') {
    return errorResponse("rating은 'helpful' 또는 'not_helpful'이어야 합니다.", 400);
  }

  const output = await adminModule.execute({
    type: 'submitFeedback',
    payload: feedbackInput,
  });

  if (!output.success) {
    logStructured('ERROR', '피드백 제출 실패', { errors: output.errors });
    return errorResponse('피드백 제출에 실패했습니다.', 500);
  }

  logStructured('INFO', '피드백 제출 성공', {
    feedbackId: output.metadata?.['feedbackId'],
  });
  return successResponse(output.data, 201);
}
