/**
 * @fileoverview 부동산 계산기 통합 Lambda 핸들러
 * @description API Gateway에서 전달받은 요청을 경로·메서드에 따라 라우팅하여
 * 이미 구현된 `CalculatorOrchestrator`에 위임한다. 이 핸들러는 새 계산 로직을
 * 포함하지 않으며, 입력 파싱·라우팅·응답 직렬화만 담당한다. 계산 경로(취득/양도/
 * 중개/계약서 연동)와 AI 자문 보조 경로는 오케스트레이터 수준에서 분리되어 있으며,
 * AI 채널 장애는 계산 결과에 전파되지 않는다.
 *
 * 엔드포인트:
 * - POST /calculators/acquisition:    취득비용 계산
 * - POST /calculators/transfer-tax:   양도소득세 계산
 * - POST /calculators/brokerage:      중개수수료 계산
 * - POST /calculators/from-contract:  계약서 연동 표준 스키마 기반 계산
 * - POST /calculators/ai-assist:      AI 자문 보조(계산 결과 컨텍스트 포함)
 * - GET  /calculators/rate-tables:    기준연도별 기준표 / 사용 가능 연도 조회
 *
 * 오류 응답은 표준 `ErrorResponse` 형식(code/message/severity/timestamp/context)을
 * 사용하며, 사용자 대면 메시지는 한국어로 제공한다.
 *
 * @requirements 9.1 - RESTful API 엔드포인트로 계산 기능 제공
 * @requirements 9.2 - HTTP 메서드/경로 기반 라우팅
 * @requirements 9.4 - 표준 오류 응답 형식(ErrorResponse)·한국어 사용자 대면 메시지
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  ErrorSeverity,
  type ErrorResponse,
} from '../../common/interfaces/service-module.js';
import type { CalculatorType } from './interfaces/types.js';
import type { AcquisitionCostInput } from './interfaces/acquisition-cost.js';
import type { TransferTaxInput } from './interfaces/transfer-tax.js';
import type { BrokerageFeeInput } from './interfaces/brokerage-fee.js';
import type { CalculatorInputSchema } from './interfaces/calculator-bridge.js';
import type { AiAssistInput } from './interfaces/ai-advisor.js';
import {
  CalculatorOrchestrator,
  type OrchestrationResult,
} from './orchestrator/calculator-orchestrator.js';
import type { BridgeMappingOptions } from './calculator-bridge-adapter/bridge-adapter.js';

/* ------------------------------------------------------------------ */
/* 오류 코드 (핸들러 단계)                                              */
/* ------------------------------------------------------------------ */

/** 지원하지 않는 경로/메서드 (요구사항 9.2) */
export const HANDLER_ROUTE_NOT_FOUND_CODE = 'CALC_ROUTE_NOT_FOUND';
/** 요청 본문 누락 */
export const HANDLER_MISSING_BODY_CODE = 'CALC_MISSING_BODY';
/** 요청 본문 JSON 파싱 실패 */
export const HANDLER_INVALID_JSON_CODE = 'CALC_INVALID_JSON';
/** 잘못된 요청 파라미터 */
export const HANDLER_BAD_REQUEST_CODE = 'CALC_BAD_REQUEST';
/** 서버 내부 오류 */
export const HANDLER_INTERNAL_ERROR_CODE = 'CALC_INTERNAL_ERROR';

/* ------------------------------------------------------------------ */
/* 공통 응답 보조                                                       */
/* ------------------------------------------------------------------ */

/** 공통 CORS/콘텐츠 헤더 */
const RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * 오케스트레이터는 상태 비저장 결정론적 컴포넌트이므로 컨테이너 재사용 시
 * 하나의 인스턴스를 공유한다(불변 의존성).
 */
let orchestratorSingleton: CalculatorOrchestrator | null = null;

/**
 * 공유 오케스트레이터 인스턴스를 반환한다(지연 생성).
 *
 * @returns 계산기 오케스트레이터
 */
function getOrchestrator(): CalculatorOrchestrator {
  if (orchestratorSingleton === null) {
    orchestratorSingleton = new CalculatorOrchestrator();
  }
  return orchestratorSingleton;
}

/**
 * 구조화된 로그를 출력한다.
 *
 * @param level - 로그 레벨
 * @param message - 로그 메시지
 * @param data - 부가 데이터
 */
function logStructured(
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  data?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...data,
    }),
  );
}

/**
 * 성공 응답을 생성한다.
 *
 * @param data - 응답 데이터
 * @param statusCode - HTTP 상태 코드 (기본 200)
 * @returns API Gateway 프록시 응답
 */
function successResponse(data: unknown, statusCode = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({ success: true, data }),
  };
}

/**
 * 표준 `ErrorResponse`를 생성한다(한국어 사용자 대면 메시지).
 *
 * @param code - 오류 코드
 * @param message - 사용자 안내 메시지 (한국어)
 * @param severity - 오류 심각도
 * @param context - 오류 컨텍스트
 * @returns 표준 오류 응답
 */
function buildError(
  code: string,
  message: string,
  severity: ErrorSeverity,
  context?: Record<string, unknown>,
): ErrorResponse {
  return {
    code,
    message,
    severity,
    timestamp: new Date().toISOString(),
    ...(context ? { context } : {}),
  };
}

/**
 * 표준 오류 응답 봉투를 생성한다.
 *
 * 응답 본문은 `{ success: false, error: ErrorResponse }` 형식을 사용한다.
 *
 * @param error - 표준 오류 응답
 * @param statusCode - HTTP 상태 코드
 * @returns API Gateway 프록시 응답
 */
function errorResponse(error: ErrorResponse, statusCode: number): APIGatewayProxyResult {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify({ success: false, error }),
  };
}

/**
 * 오케스트레이션 실패의 오류 코드를 HTTP 상태 코드로 매핑한다.
 *
 * @param code - 오케스트레이터 오류 코드
 * @returns HTTP 상태 코드
 */
function orchestrationStatus(code: string): number {
  switch (code) {
    case 'CALC_VALIDATION_FAILED':
    case 'CALC_BRIDGE_MISSING_FIELDS':
      return 400;
    case 'CALC_RATE_TABLE_NOT_FOUND':
    case 'CALC_CALCULATION_FAILED':
      return 422;
    default:
      return 400;
  }
}

/**
 * 오케스트레이션 결과를 API Gateway 응답으로 변환한다.
 *
 * 성공 시 계산 결과를 200으로 반환하고, 실패 시 오케스트레이터가 반환한 표준
 * 오류를 오류 코드에 대응하는 상태 코드로 반환한다(입력 보존 컨텍스트 유지).
 *
 * @param result - 오케스트레이션 결과
 * @returns API Gateway 프록시 응답
 */
function toResponse<T>(result: OrchestrationResult<T>): APIGatewayProxyResult {
  if (result.ok) {
    return successResponse(result.result);
  }
  return errorResponse(result.error, orchestrationStatus(result.error.code));
}

/**
 * 요청 본문을 JSON 객체로 파싱한다.
 *
 * 본문 누락 시 `MISSING_BODY`, JSON 파싱 실패 시 `INVALID_JSON` 표준 오류를 담은
 * 실패 응답을 반환한다.
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns 파싱 성공 시 payload, 실패 시 오류 응답
 */
function parseBody(
  event: APIGatewayProxyEvent,
): { ok: true; payload: Record<string, unknown> } | { ok: false; response: APIGatewayProxyResult } {
  if (event.body === null || event.body === undefined || event.body.trim() === '') {
    return {
      ok: false,
      response: errorResponse(
        buildError(
          HANDLER_MISSING_BODY_CODE,
          '요청 본문이 비어 있습니다. 계산에 필요한 입력값을 JSON 형식으로 전달해 주세요.',
          ErrorSeverity.MEDIUM,
        ),
        400,
      ),
    };
  }

  try {
    const parsed = JSON.parse(event.body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        response: errorResponse(
          buildError(
            HANDLER_INVALID_JSON_CODE,
            '요청 본문은 JSON 객체 형식이어야 합니다.',
            ErrorSeverity.MEDIUM,
          ),
          400,
        ),
      };
    }
    return { ok: true, payload: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: errorResponse(
        buildError(
          HANDLER_INVALID_JSON_CODE,
          '요청 본문의 JSON 형식이 올바르지 않습니다. 다시 확인해 주세요.',
          ErrorSeverity.MEDIUM,
        ),
        400,
      ),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Lambda 핸들러                                                        */
/* ------------------------------------------------------------------ */

/**
 * 부동산 계산기 통합 Lambda 핸들러.
 *
 * API Gateway REST API로부터 호출되며, HTTP 메서드·경로에 따라 계산 오케스트레이터의
 * 해당 경로로 위임한다. 라우트 미매칭·본문 누락·JSON 파싱 실패·메서드 불일치 시
 * 한국어 메시지를 담은 표준 `ErrorResponse`를 반환한다(요구사항 9.4).
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  logStructured('INFO', '계산기 API 요청을 수신했습니다.', { method, path });

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: '' };
  }

  try {
    // POST 계산 경로
    if (path.endsWith('/calculators/acquisition')) {
      return requirePost(method, path, () => handleAcquisition(event));
    }
    if (path.endsWith('/calculators/transfer-tax')) {
      return requirePost(method, path, () => handleTransferTax(event));
    }
    if (path.endsWith('/calculators/brokerage')) {
      return requirePost(method, path, () => handleBrokerage(event));
    }
    if (path.endsWith('/calculators/from-contract')) {
      return requirePost(method, path, () => handleFromContract(event));
    }
    if (path.endsWith('/calculators/ai-assist')) {
      return requirePost(method, path, () => handleAiAssist(event));
    }

    // GET 조회 경로
    if (path.endsWith('/calculators/rate-tables')) {
      if (method !== 'GET') {
        return methodNotAllowed(method, path, 'GET');
      }
      return handleRateTables(event);
    }

    // 라우트 미매칭
    return errorResponse(
      buildError(
        HANDLER_ROUTE_NOT_FOUND_CODE,
        `지원하지 않는 요청입니다: ${method} ${path}`,
        ErrorSeverity.LOW,
        { method, path },
      ),
      404,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStructured('ERROR', '계산기 API 요청 처리 중 오류가 발생했습니다.', {
      error: message,
      method,
      path,
    });
    return errorResponse(
      buildError(
        HANDLER_INTERNAL_ERROR_CODE,
        '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        ErrorSeverity.HIGH,
      ),
      500,
    );
  }
};

/**
 * POST 전용 경로에서 메서드를 확인하고, 일치하면 핸들러를 실행한다.
 *
 * @param method - 요청 메서드
 * @param path - 요청 경로
 * @param handle - 실제 처리 함수
 * @returns API Gateway 프록시 응답
 */
async function requirePost(
  method: string,
  path: string,
  handle: () => Promise<APIGatewayProxyResult>,
): Promise<APIGatewayProxyResult> {
  if (method !== 'POST') {
    return methodNotAllowed(method, path, 'POST');
  }
  return handle();
}

/**
 * 메서드 불일치 시 표준 오류 응답을 반환한다(405).
 *
 * @param method - 요청 메서드
 * @param path - 요청 경로
 * @param expected - 허용 메서드
 * @returns API Gateway 프록시 응답
 */
function methodNotAllowed(
  method: string,
  path: string,
  expected: string,
): APIGatewayProxyResult {
  return errorResponse(
    buildError(
      HANDLER_ROUTE_NOT_FOUND_CODE,
      `허용되지 않은 메서드입니다: ${method} ${path}. 이 경로는 ${expected} 메서드만 지원합니다.`,
      ErrorSeverity.LOW,
      { method, path, expected },
    ),
    405,
  );
}

/* ------------------------------------------------------------------ */
/* 경로별 핸들러                                                        */
/* ------------------------------------------------------------------ */

/**
 * POST /calculators/acquisition - 취득비용 계산.
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
async function handleAcquisition(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(event);
  if (!parsed.ok) {
    return parsed.response;
  }
  const input = parsed.payload as unknown as AcquisitionCostInput;
  const result = getOrchestrator().calculateAcquisition(input);
  return toResponse(result);
}

/**
 * POST /calculators/transfer-tax - 양도소득세 계산.
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
async function handleTransferTax(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(event);
  if (!parsed.ok) {
    return parsed.response;
  }
  const input = parsed.payload as unknown as TransferTaxInput;
  const result = getOrchestrator().calculateTransferTax(input);
  return toResponse(result);
}

/**
 * POST /calculators/brokerage - 중개수수료 계산.
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
async function handleBrokerage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(event);
  if (!parsed.ok) {
    return parsed.response;
  }
  const input = parsed.payload as unknown as BrokerageFeeInput;
  const result = getOrchestrator().calculateBrokerage(input);
  return toResponse(result);
}

/**
 * POST /calculators/from-contract - 계약서 연동 표준 스키마 기반 계산.
 *
 * 요청 본문은 `{ schema: CalculatorInputSchema, options?: BridgeMappingOptions }`
 * 형식을 사용한다. 하위 호환을 위해 최상위에 스키마 필드가 직접 전달된 경우에도
 * 스키마로 취급한다.
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
async function handleFromContract(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(event);
  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.payload;
  const rawSchema = 'schema' in body ? body['schema'] : body;
  if (typeof rawSchema !== 'object' || rawSchema === null) {
    return errorResponse(
      buildError(
        HANDLER_BAD_REQUEST_CODE,
        '계약서 연동 계산에는 표준 입력 스키마(schema)가 필요합니다.',
        ErrorSeverity.MEDIUM,
      ),
      400,
    );
  }

  const schema = rawSchema as unknown as CalculatorInputSchema;
  const options = ('options' in body ? body['options'] : {}) as BridgeMappingOptions;

  const result = getOrchestrator().processFromContract(schema, options ?? {});
  return toResponse(result);
}

/**
 * POST /calculators/ai-assist - AI 자문 보조(계산 결과 컨텍스트 포함).
 *
 * AI 보조 경로는 계산 경로와 분리된 별도 채널이다. AI 호출 실패/타임아웃은
 * `AiAssistOutput.isAvailable=false`로 표현되며 예외를 던지지 않으므로, 이미
 * 확정된 계산 결과에 영향을 주지 않는다. 따라서 AI 응답은 항상 200으로 반환한다.
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
async function handleAiAssist(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(event);
  if (!parsed.ok) {
    return parsed.response;
  }

  const body = parsed.payload;
  if (
    typeof body['question'] !== 'string' ||
    typeof body['calculatorType'] !== 'string' ||
    typeof body['calculationContext'] !== 'object' ||
    body['calculationContext'] === null
  ) {
    return errorResponse(
      buildError(
        HANDLER_BAD_REQUEST_CODE,
        'AI 자문 보조에는 계산기 유형(calculatorType), 질문(question), 계산 컨텍스트(calculationContext)가 필요합니다.',
        ErrorSeverity.MEDIUM,
      ),
      400,
    );
  }

  const input = body as unknown as AiAssistInput;
  const output = await getOrchestrator().assist(input);
  return successResponse(output);
}

/**
 * GET /calculators/rate-tables - 기준연도별 기준표 / 사용 가능 연도 조회.
 *
 * 쿼리 파라미터 `type`(acquisition/transfer_tax/brokerage)으로 계산기 유형을
 * 지정한다. 미지정 시 전체 유형의 사용 가능 기준연도 목록을 반환한다. 유형이
 * 지정되면 해당 유형의 사용 가능 기준연도 목록을 반환한다.
 *
 * @param event - API Gateway 프록시 이벤트
 * @returns API Gateway 프록시 응답
 */
async function handleRateTables(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const orchestrator = getOrchestrator();
  const typeParam = event.queryStringParameters?.['type'];

  const allTypes: CalculatorType[] = ['acquisition', 'transfer_tax', 'brokerage'];

  if (typeParam !== undefined && typeParam !== null && typeParam !== '') {
    if (!allTypes.includes(typeParam as CalculatorType)) {
      return errorResponse(
        buildError(
          HANDLER_BAD_REQUEST_CODE,
          `지원하지 않는 계산기 유형입니다: ${typeParam}. 사용 가능한 유형: ${allTypes.join(', ')}`,
          ErrorSeverity.LOW,
          { type: typeParam, supportedTypes: allTypes },
        ),
        400,
      );
    }
    const type = typeParam as CalculatorType;
    return successResponse({
      type,
      availableBaseYears: orchestrator.getAvailableBaseYears(type),
    });
  }

  // 유형 미지정 시 전체 유형의 사용 가능 기준연도 목록 반환
  const availableBaseYears: Record<CalculatorType, number[]> = {
    acquisition: orchestrator.getAvailableBaseYears('acquisition'),
    transfer_tax: orchestrator.getAvailableBaseYears('transfer_tax'),
    brokerage: orchestrator.getAvailableBaseYears('brokerage'),
  };

  return successResponse({ availableBaseYears });
}
