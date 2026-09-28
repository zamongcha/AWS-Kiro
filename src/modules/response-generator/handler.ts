/**
 * @fileoverview 응답 생성 Lambda 핸들러
 * @description API Gateway에서 호출되는 응답 생성 Lambda 핸들러로,
 * 사용자 질문과 검색 결과를 받아 Claude 3.5 Sonnet 기반 법률 자문 응답을 생성하여 반환한다.
 * LLM 호출 실패 또는 타임아웃 시 사용자에게 적절한 오류 안내 메시지를 반환한다.
 *
 * @requirements 4.8 - LLM 호출 실패/타임아웃 시 사용자 오류 안내 메시지 반환
 */

import { ResponseGeneratorInput } from '../../common/interfaces/response.js';
import { SearchOutput } from '../../common/interfaces/search.js';
import { ConversationEntry } from '../../common/interfaces/data-models.js';
import { ResponseGeneratorModule } from './index.js';

/**
 * API Gateway 이벤트 인터페이스
 */
export interface APIGatewayEvent {
  /** 요청 본문 (JSON 문자열) */
  body: string | null;
  /** 요청 헤더 */
  headers: Record<string, string>;
  /** HTTP 메서드 */
  httpMethod: string;
  /** 요청 경로 */
  path: string;
  /** 쿼리 스트링 파라미터 */
  queryStringParameters: Record<string, string> | null;
}

/**
 * API Gateway 응답 인터페이스
 */
export interface APIGatewayResponse {
  /** HTTP 상태 코드 */
  statusCode: number;
  /** 응답 헤더 */
  headers: Record<string, string>;
  /** 응답 본문 (JSON 문자열) */
  body: string;
}

/**
 * 응답 생성 요청 본문 인터페이스
 */
interface ResponseRequestBody {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 검색 모듈에서 반환된 검색 결과 */
  searchResults: SearchOutput;
  /** 이전 대화 컨텍스트 (후속 질문 시 참조, 선택) */
  sessionContext?: ConversationEntry[];
}

/**
 * 구조화된 로그 항목 인터페이스
 */
interface StructuredLog {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * 공통 CORS 및 JSON 헤더
 */
const RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

/** LLM 호출 타임아웃 (밀리초) */
const LLM_TIMEOUT_MS = 60000;

/**
 * 구조화된 JSON 로그를 CloudWatch로 출력한다.
 *
 * @param log - 로그 항목
 */
function logStructured(log: StructuredLog): void {
  console.log(JSON.stringify(log));
}

/**
 * 성공 응답을 생성한다.
 *
 * @param data - 응답 데이터
 * @returns API Gateway 응답
 */
function createSuccessResponse(data: unknown): APIGatewayResponse {
  return {
    statusCode: 200,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({
      success: true,
      data,
    }),
  };
}

/**
 * 에러 응답을 생성한다.
 *
 * @param statusCode - HTTP 상태 코드
 * @param message - 사용자에게 표시할 오류 메시지
 * @returns API Gateway 응답
 */
function createErrorResponse(statusCode: number, message: string): APIGatewayResponse {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({
      success: false,
      error: message,
    }),
  };
}

/**
 * 응답 생성 Lambda 핸들러
 *
 * API Gateway에서 POST 요청으로 호출되며, 사용자 질문과 검색 결과를 기반으로
 * Claude 3.5 Sonnet LLM을 호출하여 구조화된 법률 자문 응답을 생성한다.
 *
 * 요청 본문:
 * - query (string, 필수): 사용자 질문 텍스트
 * - searchResults (SearchOutput, 필수): 검색 모듈에서 반환된 결과
 * - sessionContext (ConversationEntry[], 선택): 이전 대화 컨텍스트
 *
 * 환경 변수:
 * - AWS_REGION: AWS 리전 (기본값: 'us-east-1')
 * - BEDROCK_MODEL_ID: Bedrock 모델 ID (기본값: 'anthropic.claude-3-5-sonnet-20240620-v1:0')
 * - LLM_TIMEOUT_MS: LLM 호출 타임아웃 밀리초 (기본값: 60000)
 *
 * 응답:
 * - 200: 응답 생성 성공
 * - 400: 요청 검증 실패
 * - 500: LLM 호출 실패 또는 타임아웃
 *
 * @param event - API Gateway 이벤트
 * @returns API Gateway 응답
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayResponse> => {
  logStructured({
    level: 'INFO',
    message: '응답 생성 요청을 수신했습니다.',
    timestamp: new Date().toISOString(),
    httpMethod: event.httpMethod,
    path: event.path,
  });

  // OPTIONS 프리플라이트 요청 처리
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: RESPONSE_HEADERS,
      body: '',
    };
  }

  // 요청 본문 파싱
  let requestBody: ResponseRequestBody;
  try {
    if (!event.body) {
      return createErrorResponse(400, '요청 본문이 비어있습니다.');
    }
    requestBody = JSON.parse(event.body) as ResponseRequestBody;
  } catch {
    return createErrorResponse(400, '요청 본문의 JSON 형식이 올바르지 않습니다.');
  }

  // 필수 필드 검증: query
  if (!requestBody.query || requestBody.query.trim().length === 0) {
    return createErrorResponse(400, 'query 필드는 필수입니다.');
  }

  // 필수 필드 검증: searchResults
  if (!requestBody.searchResults) {
    return createErrorResponse(400, 'searchResults 필드는 필수입니다.');
  }

  // 환경 변수 읽기
  const awsRegion = process.env['AWS_REGION'] || 'us-east-1';
  const modelId = process.env['BEDROCK_MODEL_ID'] || undefined;
  const timeoutMs = process.env['LLM_TIMEOUT_MS']
    ? parseInt(process.env['LLM_TIMEOUT_MS'], 10)
    : LLM_TIMEOUT_MS;

  // ResponseGeneratorModule 초기화
  const responseGenerator = new ResponseGeneratorModule();
  try {
    await responseGenerator.initialize({
      name: 'response-generator',
      version: '1.0.0',
      enabled: true,
      config: {
        region: awsRegion,
        modelId,
        timeoutMs,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStructured({
      level: 'ERROR',
      message: '응답 생성 모듈 초기화에 실패했습니다.',
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
    return createErrorResponse(500, '일시적 오류가 발생했습니다. 다시 시도해 주세요.');
  }

  // 응답 생성 실행
  try {
    const generatorInput: ResponseGeneratorInput = {
      query: requestBody.query,
      searchResults: requestBody.searchResults,
      sessionContext: requestBody.sessionContext,
    };

    const result = await responseGenerator.execute({
      type: 'generate_response',
      payload: generatorInput,
      metadata: {
        region: awsRegion,
      },
    });

    if (!result.success) {
      const errorCode = result.errors?.[0]?.code || 'UNKNOWN_ERROR';
      const errorMsg = result.errors?.[0]?.message || '응답 생성 중 오류가 발생했습니다.';

      logStructured({
        level: 'ERROR',
        message: '응답 생성에 실패했습니다.',
        timestamp: new Date().toISOString(),
        errorCode,
        error: errorMsg,
      });

      // LLM 타임아웃과 일반 실패 구분
      if (errorCode === 'LLM_TIMEOUT') {
        return createErrorResponse(500, '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.');
      }

      return createErrorResponse(500, '일시적 오류가 발생했습니다. 다시 시도해 주세요.');
    }

    logStructured({
      level: 'INFO',
      message: '응답 생성이 완료되었습니다.',
      timestamp: new Date().toISOString(),
      generationTimeMs: result.metadata?.['generationTimeMs'],
      model: result.metadata?.['model'],
    });

    return createSuccessResponse(result.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('타임아웃') || errorMessage.includes('timeout');

    logStructured({
      level: 'ERROR',
      message: isTimeout
        ? 'LLM 호출 타임아웃이 발생했습니다.'
        : '응답 생성 중 예상치 못한 오류가 발생했습니다.',
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });

    if (isTimeout) {
      return createErrorResponse(500, '답변 생성에 시간이 걸리고 있습니다. 다시 시도해 주세요.');
    }

    return createErrorResponse(500, '일시적 오류가 발생했습니다. 다시 시도해 주세요.');
  }
};
