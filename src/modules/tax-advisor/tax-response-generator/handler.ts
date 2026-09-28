/**
 * 세무 응답 생성 Lambda 핸들러
 *
 * API Gateway로부터 세무 질문 응답 생성 요청을 받아
 * TaxResponseGeneratorModule을 실행하고 결과를 반환한다.
 *
 * - POST /tax-advisor/generate: 세무 응답 생성
 * - LLM 60초 타임아웃 적용
 * - 실패 시 사용자 친화적 오류 메시지 반환
 *
 * @module TaxResponseGeneratorHandler
 * @requirements 4.8
 */

import { TaxResponseGeneratorModule } from './index.js';
import type { TaxResponseGeneratorInput } from '../interfaces/index.js';

/**
 * Lambda 이벤트 인터페이스 (API Gateway Proxy)
 */
interface APIGatewayEvent {
  httpMethod: string;
  path: string;
  body: string | null;
  headers: Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
  requestContext?: {
    requestId?: string;
  };
}

/**
 * Lambda 응답 인터페이스
 */
interface APIGatewayResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** CORS 헤더 */
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** 전체 응답 타임아웃 (밀리초) - LLM 60초 + 전후 처리 5초 */
const TOTAL_TIMEOUT_MS = 65000;

/** 모듈 싱글턴 인스턴스 (Lambda warm start 최적화) */
let moduleInstance: TaxResponseGeneratorModule | null = null;

/**
 * 모듈 인스턴스를 가져온다. (lazy initialization)
 */
async function getModuleInstance(): Promise<TaxResponseGeneratorModule> {
  if (!moduleInstance) {
    moduleInstance = new TaxResponseGeneratorModule();
    await moduleInstance.initialize({
      name: 'tax-response-generator',
      version: '1.0.0',
      enabled: true,
      config: {
        region: process.env['AWS_REGION'] || 'ap-northeast-2',
        modelId: process.env['BEDROCK_MODEL_ID'] || 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        timeoutMs: 60000,
        maxTokens: 4096,
        temperature: 0.3,
        minLength: 200,
        maxLength: 5000,
      },
    });
  }
  return moduleInstance;
}

/**
 * Lambda 핸들러 함수
 *
 * POST 요청을 처리하여 세무 응답을 생성한다.
 * 60초 LLM 타임아웃 + 전체 65초 타임아웃을 적용한다.
 *
 * @param event - API Gateway 이벤트
 * @returns API Gateway 응답
 */
export async function handler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
  // OPTIONS 요청 처리 (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  // POST 메서드만 허용
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'Method Not Allowed',
        message: 'POST 메서드만 지원합니다.',
      }),
    };
  }

  try {
    // 요청 본문 파싱
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Bad Request',
          message: '요청 본문이 비어있습니다.',
        }),
      };
    }

    const requestBody = JSON.parse(event.body) as TaxResponseGeneratorInput;

    // 입력 검증
    if (!requestBody.question || requestBody.question.trim().length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Bad Request',
          message: '질문이 비어있습니다.',
        }),
      };
    }

    if (!requestBody.searchResults) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Bad Request',
          message: '검색 결과가 필요합니다.',
        }),
      };
    }

    // 모듈 실행 (타임아웃 적용)
    const module = await getModuleInstance();

    const result = await Promise.race([
      module.execute({
        type: 'generate_tax_response',
        payload: requestBody,
        metadata: {
          requestId: event.requestContext?.requestId ?? 'unknown',
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('전체 응답 타임아웃')),
          TOTAL_TIMEOUT_MS
        )
      ),
    ]);

    if (!result.success) {
      const errorMsg = result.errors?.[0]?.message ?? '알 수 없는 오류가 발생했습니다.';
      const isTimeout = result.errors?.[0]?.code === 'LLM_TIMEOUT';

      return {
        statusCode: isTimeout ? 504 : 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: isTimeout ? 'Gateway Timeout' : 'Internal Server Error',
          message: errorMsg,
          retryable: true,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        data: result.data,
      }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('타임아웃');

    const userMessage = isTimeout
      ? '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.'
      : '일시적 오류가 발생했습니다. 다시 시도해 주세요.';

    return {
      statusCode: isTimeout ? 504 : 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: isTimeout ? 'Gateway Timeout' : 'Internal Server Error',
        message: userMessage,
        retryable: true,
      }),
    };
  }
}
