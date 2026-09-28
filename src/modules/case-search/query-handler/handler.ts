/**
 * @fileoverview 판례 검색 Lambda 핸들러
 * @description API Gateway로부터 요청을 수신하여 적절한 모듈에 라우팅한다.
 *
 * 지원 엔드포인트:
 * - POST /case-search/analyze: 상황 설명 기반 판례 검색 및 분석
 * - POST /case-search/follow-up: 후속 질문 처리
 * - GET /case-search/categories: 분쟁 유형 카테고리 목록
 * - GET /case-search/categories/{type}: 카테고리별 판례 목록
 * - GET /case-search/categories/{type}/subcategories: 하위 세부 분류
 * - GET /case-search/cases/{caseId}: 개별 판례 상세 분석
 * - POST /case-search/feedback: 사용자 피드백 제출
 *
 * @requirements 10.3 - API 라우팅
 * @requirements 10.5 - 오류 응답 표준 형식
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CaseSearchOrchestrator } from './orchestrator.js';
import { FeedbackHandler } from './feedback-handler.js';
import { CategoryBrowseModule } from '../category-browse/index.js';
import type { DisputeType } from '../interfaces/index.js';
import type { FeedbackInput } from './feedback-handler.js';

/** CORS 헤더 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json',
};

// 모듈 인스턴스 (Lambda Cold Start 최적화)
let orchestrator: CaseSearchOrchestrator | null = null;
let categoryBrowse: CategoryBrowseModule | null = null;
let feedbackHandler: FeedbackHandler | null = null;

function getOrchestrator(): CaseSearchOrchestrator {
  if (!orchestrator) {
    orchestrator = new CaseSearchOrchestrator();
  }
  return orchestrator;
}

function getCategoryBrowse(): CategoryBrowseModule {
  if (!categoryBrowse) {
    categoryBrowse = new CategoryBrowseModule();
  }
  return categoryBrowse;
}

function getFeedbackHandler(): FeedbackHandler {
  if (!feedbackHandler) {
    feedbackHandler = new FeedbackHandler();
  }
  return feedbackHandler;
}

/**
 * Lambda 핸들러 진입점
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // OPTIONS 요청 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return buildResponse(200, { message: 'OK' });
  }

  const path = event.path || event.resource || '';
  const method = event.httpMethod;

  console.log(`[CaseSearch] ${method} ${path}`);

  try {
    // 라우팅
    if (method === 'POST' && path.endsWith('/case-search/analyze')) {
      return await handleAnalyze(event);
    }

    if (method === 'POST' && path.endsWith('/case-search/follow-up')) {
      return await handleFollowUp(event);
    }

    if (method === 'GET' && path.match(/\/case-search\/categories\/[\w-]+\/subcategories$/)) {
      return await handleSubCategories(event);
    }

    if (method === 'GET' && path.match(/\/case-search\/categories\/[\w-]+$/)) {
      return await handleCategoryList(event);
    }

    if (method === 'GET' && path.endsWith('/case-search/categories')) {
      return handleCategories();
    }

    if (method === 'GET' && path.match(/\/case-search\/cases\/[\w-]+$/)) {
      return await handleCaseDetail(event);
    }

    if (method === 'POST' && path.endsWith('/case-search/feedback')) {
      return await handleFeedback(event);
    }

    return buildResponse(404, {
      error: 'NOT_FOUND',
      message: '요청하신 경로를 찾을 수 없습니다.',
    });
  } catch (error) {
    console.error('[CaseSearch] Unhandled error:', error);
    return buildResponse(500, {
      error: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}

/**
 * POST /case-search/analyze 핸들러
 */
async function handleAnalyze(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  if (!body || !body['situationDescription']) {
    return buildResponse(400, {
      error: 'INVALID_INPUT',
      message: '분쟁 상황 설명(situationDescription)을 입력해 주세요.',
    });
  }

  try {
    const result = await getOrchestrator().process({
      situationDescription: body['situationDescription'] as string,
      sessionId: body['sessionId'] as string | undefined,
    });

    return buildResponse(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.';
    const statusCode = message.includes('20자 이상') || message.includes('2000자') ? 400 : 500;
    return buildResponse(statusCode, { error: 'ANALYSIS_ERROR', message });
  }
}

/**
 * POST /case-search/follow-up 핸들러
 */
async function handleFollowUp(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  if (!body || !body['sessionId'] || !body['question']) {
    return buildResponse(400, {
      error: 'INVALID_INPUT',
      message: '세션 ID(sessionId)와 후속 질문(question)을 입력해 주세요.',
    });
  }

  try {
    const result = await getOrchestrator().processFollowUp(
      body['sessionId'] as string,
      body['question'] as string,
    );
    return buildResponse(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '후속 질문 처리 중 오류가 발생했습니다.';
    return buildResponse(500, { error: 'FOLLOW_UP_ERROR', message });
  }
}

/**
 * GET /case-search/categories 핸들러
 */
function handleCategories(): APIGatewayProxyResult {
  const categories = getCategoryBrowse().getCategories();
  return buildResponse(200, { categories });
}

/**
 * GET /case-search/categories/{type} 핸들러
 */
async function handleCategoryList(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const type = extractPathParam(event.path, 'categories');
  if (!type || !isValidDisputeType(type)) {
    return buildResponse(400, {
      error: 'INVALID_TYPE',
      message: '유효한 분쟁 유형을 지정해 주세요. (lease, sale, registration, brokerage, redevelopment)',
    });
  }

  const page = parseInt(event.queryStringParameters?.page || '1', 10);
  const pageSize = parseInt(event.queryStringParameters?.pageSize || '20', 10);

  const result = await getCategoryBrowse().getCasesByCategory({
    disputeType: type as DisputeType,
    page,
    pageSize,
  });

  return buildResponse(200, result);
}

/**
 * GET /case-search/categories/{type}/subcategories 핸들러
 */
async function handleSubCategories(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const type = extractPathParam(event.path, 'categories');
  if (!type || !isValidDisputeType(type)) {
    return buildResponse(400, {
      error: 'INVALID_TYPE',
      message: '유효한 분쟁 유형을 지정해 주세요.',
    });
  }

  const subCategories = await getCategoryBrowse().getSubCategories(type as DisputeType);
  return buildResponse(200, { disputeType: type, subCategories });
}

/**
 * GET /case-search/cases/{caseId} 핸들러
 */
async function handleCaseDetail(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caseId = extractPathParam(event.path, 'cases');
  if (!caseId) {
    return buildResponse(400, {
      error: 'INVALID_INPUT',
      message: '판례 ID(caseId)를 지정해 주세요.',
    });
  }

  const result = await getCategoryBrowse().getCaseById({ caseId });
  if (!result) {
    return buildResponse(404, {
      error: 'NOT_FOUND',
      message: '해당 판례를 찾을 수 없습니다.',
    });
  }

  return buildResponse(200, result);
}

/**
 * POST /case-search/feedback 핸들러
 */
async function handleFeedback(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event.body);
  if (!body || !body['sessionId'] || !body['questionId'] || !body['rating']) {
    return buildResponse(400, {
      error: 'INVALID_INPUT',
      message: '세션 ID, 질문 ID, 평가(helpful/not_helpful)를 입력해 주세요.',
    });
  }

  try {
    const feedbackInput: FeedbackInput = {
      sessionId: body['sessionId'] as string,
      questionId: body['questionId'] as string,
      rating: body['rating'] as 'helpful' | 'not_helpful',
      disputeType: body['disputeType'] as DisputeType | undefined,
    };
    await getFeedbackHandler().submitFeedback(feedbackInput);
    return buildResponse(200, { message: '피드백이 제출되었습니다. 감사합니다.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '피드백 제출 중 오류가 발생했습니다.';
    return buildResponse(500, { error: 'FEEDBACK_ERROR', message });
  }
}

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

function buildResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function parseBody(body: string | null): Record<string, unknown> | null {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function extractPathParam(path: string, segment: string): string | null {
  const parts = path.split('/');
  const segIndex = parts.indexOf(segment);
  if (segIndex >= 0 && segIndex + 1 < parts.length) {
    return parts[segIndex + 1];
  }
  return null;
}

function isValidDisputeType(type: string): boolean {
  return ['lease', 'sale', 'registration', 'brokerage', 'redevelopment'].includes(type);
}
