/**
 * @fileoverview 검색 Lambda 핸들러
 * @description API Gateway에서 호출되는 검색 Lambda 핸들러로,
 * 사용자 질문을 받아 벡터 검색 및 하이브리드 검색을 수행하고 결과를 반환한다.
 * 검색 실패 시 오류 메시지를 반환하며, 질문 텍스트를 보존한다.
 * 5초 이내에 결과를 반환해야 하며, 타임아웃 초과 시 적절한 오류를 반환한다.
 *
 * @requirements 3.2 - 5초 이내 결과 반환
 * @requirements 3.6 - 검색 실패 시 오류 메시지 반환 및 질문 텍스트 보존
 * @requirements 3.7 - 검색 로그 DynamoDB 기록
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { validateQueryInput, sanitizeInput } from '../../common/utils/index.js';
import { SearchInput, SearchOutput } from '../../common/interfaces/index.js';
import { SearchModule } from './index.js';

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
 * 검색 요청 본문 인터페이스
 */
interface SearchRequestBody {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 검색 필터 (선택) */
  filters?: {
    lawType?: string[];
    dateRange?: { from?: string; to?: string };
    court?: string[];
  };
  /** 검색 옵션 (선택) */
  options?: {
    maxResults?: number;
    threshold?: number;
    includeRelated?: boolean;
  };
}

/**
 * 검색 로그 레코드 인터페이스
 */
interface SearchLogRecord {
  /** 로그 ID (질문 해시 + 타임스탬프) */
  logId: string;
  /** 사용자 질문 텍스트 */
  query: string;
  /** 검색 성공 여부 */
  success: boolean;
  /** 검색 결과 수 */
  resultCount: number;
  /** 검색 소요 시간 (밀리초) */
  searchTimeMs: number;
  /** 에러 메시지 (실패 시) */
  errorMessage?: string;
  /** 기록 시각 (ISO 8601) */
  timestamp: string;
  /** TTL (DynamoDB 자동 만료용, 30일 후) */
  ttl: number;
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

/** 검색 타임아웃 (밀리초) */
const SEARCH_TIMEOUT_MS = 5000;

/**
 * 구조화된 JSON 로그 출력
 */
function logStructured(log: StructuredLog): void {
  console.log(JSON.stringify(log));
}

/**
 * 검색 로그를 DynamoDB에 기록한다.
 *
 * @param docClient - DynamoDB Document 클라이언트
 * @param tableName - 테이블 이름
 * @param record - 검색 로그 레코드
 */
async function writeSearchLog(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  record: SearchLogRecord,
): Promise<void> {
  try {
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: record,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStructured({
      level: 'WARN',
      message: '검색 로그 기록에 실패했습니다.',
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }
}

/**
 * 성공 응답을 생성한다.
 *
 * @param data - 응답 데이터
 * @returns API Gateway 응답
 */
function createSuccessResponse(data: SearchOutput & { query: string }): APIGatewayResponse {
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
 * @param message - 오류 메시지
 * @param query - 원본 질문 텍스트 (보존)
 * @returns API Gateway 응답
 */
function createErrorResponse(
  statusCode: number,
  message: string,
  query?: string,
): APIGatewayResponse {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({
      success: false,
      error: message,
      ...(query !== undefined && { query }),
    }),
  };
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
      reject(new Error(`검색 타임아웃: ${timeoutMs}ms 이내에 결과를 반환하지 못했습니다.`));
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
 * 검색 Lambda 핸들러
 *
 * API Gateway에서 POST 요청으로 호출되며, 사용자 질문에 대해
 * 벡터 검색 및 하이브리드 검색을 수행하여 관련 법령/판례를 반환한다.
 *
 * 환경 변수:
 * - OPENSEARCH_ENDPOINT: OpenSearch Serverless 엔드포인트 URL
 * - AWS_REGION: AWS 리전
 * - DYNAMODB_TABLE: 검색 로그 DynamoDB 테이블 이름
 *
 * @param event - API Gateway 이벤트
 * @returns API Gateway 응답 (200 성공, 400 검증 실패, 500 내부 오류)
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayResponse> => {
  const startTime = Date.now();

  logStructured({
    level: 'INFO',
    message: '검색 요청을 수신했습니다.',
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
  let requestBody: SearchRequestBody;
  try {
    if (!event.body) {
      return createErrorResponse(400, '요청 본문이 비어있습니다.');
    }
    requestBody = JSON.parse(event.body) as SearchRequestBody;
  } catch {
    return createErrorResponse(400, '요청 본문의 JSON 형식이 올바르지 않습니다.');
  }

  // 질문 텍스트 추출 및 검증
  const rawQuery = requestBody.query;
  if (rawQuery === undefined || rawQuery === null) {
    return createErrorResponse(400, 'query 필드는 필수입니다.');
  }

  // 입력 검증 (validateQueryInput 사용)
  const validationResult = validateQueryInput(rawQuery);
  if (!validationResult.valid) {
    logStructured({
      level: 'WARN',
      message: '입력 검증에 실패했습니다.',
      timestamp: new Date().toISOString(),
      errors: validationResult.errors,
      query: rawQuery,
    });
    return createErrorResponse(400, validationResult.errors.join('; '), rawQuery);
  }

  // 입력 정화
  const sanitizedQuery = sanitizeInput(rawQuery);

  // 환경 변수 읽기
  const openSearchEndpoint = process.env['OPENSEARCH_ENDPOINT'] || '';
  const awsRegion = process.env['AWS_REGION'] || 'ap-northeast-2';
  const dynamoDbTable = process.env['DYNAMODB_TABLE'] || '';

  // DynamoDB 클라이언트 초기화 (검색 로그 기록용)
  const dynamoClient = new DynamoDBClient({ region: awsRegion });
  const docClient = DynamoDBDocumentClient.from(dynamoClient);

  // SearchModule 초기화
  const searchModule = new SearchModule();
  try {
    await searchModule.initialize({
      name: 'search',
      version: '1.0.0',
      enabled: true,
      config: {
        openSearchEndpoint,
        region: awsRegion,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStructured({
      level: 'ERROR',
      message: '검색 모듈 초기화에 실패했습니다.',
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
    return createErrorResponse(500, '검색 서비스를 초기화할 수 없습니다.', sanitizedQuery);
  }

  // 검색 실행 (5초 타임아웃 적용)
  try {
    const searchInput: SearchInput = {
      query: sanitizedQuery,
      filters: requestBody.filters,
      options: requestBody.options,
    };

    const searchOutput = await withTimeout(
      searchModule.execute({
        type: 'search',
        payload: searchInput,
        metadata: {
          region: awsRegion,
          openSearchEndpoint,
        },
      }),
      SEARCH_TIMEOUT_MS,
    );

    const elapsedMs = Date.now() - startTime;

    if (!searchOutput.success) {
      const errorMsg = searchOutput.errors?.[0]?.message || '검색 중 오류가 발생했습니다.';

      logStructured({
        level: 'ERROR',
        message: '검색 실행에 실패했습니다.',
        timestamp: new Date().toISOString(),
        error: errorMsg,
        elapsedMs,
      });

      // 검색 로그 기록 (실패)
      if (dynamoDbTable) {
        await writeSearchLog(docClient, dynamoDbTable, {
          logId: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          query: sanitizedQuery,
          success: false,
          resultCount: 0,
          searchTimeMs: elapsedMs,
          errorMessage: errorMsg,
          timestamp: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        });
      }

      return createErrorResponse(500, errorMsg, sanitizedQuery);
    }

    const searchResult = searchOutput.data as SearchOutput;

    logStructured({
      level: 'INFO',
      message: '검색이 완료되었습니다.',
      timestamp: new Date().toISOString(),
      resultCount: searchResult.totalCount,
      searchTimeMs: searchResult.searchTime,
      elapsedMs,
    });

    // 검색 로그 기록 (성공)
    if (dynamoDbTable) {
      await writeSearchLog(docClient, dynamoDbTable, {
        logId: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        query: sanitizedQuery,
        success: true,
        resultCount: searchResult.totalCount,
        searchTimeMs: elapsedMs,
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      });
    }

    // 성공 응답 반환 (질문 텍스트 보존)
    return createSuccessResponse({
      ...searchResult,
      query: sanitizedQuery,
    });
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('타임아웃');

    logStructured({
      level: 'ERROR',
      message: isTimeout ? '검색 타임아웃이 발생했습니다.' : '검색 중 예상치 못한 오류가 발생했습니다.',
      timestamp: new Date().toISOString(),
      error: errorMessage,
      elapsedMs,
    });

    // 검색 로그 기록 (실패)
    if (dynamoDbTable) {
      await writeSearchLog(docClient, dynamoDbTable, {
        logId: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        query: sanitizedQuery,
        success: false,
        resultCount: 0,
        searchTimeMs: elapsedMs,
        errorMessage,
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      });
    }

    return createErrorResponse(
      500,
      isTimeout
        ? '검색 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
        : '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      sanitizedQuery,
    );
  }
};
