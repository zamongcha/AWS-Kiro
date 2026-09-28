/**
 * @fileoverview 계약서 분석 Lambda 핸들러 및 API 라우팅
 * @description 부동산 계약서 AI 분석 시스템의 API Gateway 진입점이다.
 * 기존 서비스 핸들러(`src/modules/query-handler/handler.ts`,
 * `src/modules/tax-advisor/query-handler/handler.ts`)와 동일한 이벤트 처리·
 * 라우팅·응답 형식 패턴을 따른다.
 *
 * 각 엔드포인트는 이미 구현된 서브모듈(업로드 처리기·오케스트레이터·등기부
 * 대조기·수정제안 생성기·특약 추천기·버전 관리기·시뮬레이션 엔진·체크리스트·
 * 관리 서비스)에 위임한다. 모든 서브모듈은 표준 `ServiceModule.execute`
 * 계약(`ModuleOutput`, `ErrorResponse`)을 따르므로, 핸들러는 이를 HTTP
 * 응답으로 변환한다.
 *
 * 지원 엔드포인트:
 * - POST   /contract-analysis/upload            : 계약서 파일 업로드
 * - POST   /contract-analysis/analyze           : documentId·계약유형·관점 기반 분석
 * - POST   /contract-analysis/registry          : 등기부등본 업로드·대조
 * - POST   /contract-analysis/advise            : 조항 판단/수정 제안 (mode=suggest|judge)
 * - GET    /contract-analysis/recommendations   : 실시간 특약 추천
 * - POST   /contract-analysis/versions          : 버전 저장
 * - GET    /contract-analysis/versions/compare  : 버전 비교
 * - POST   /contract-analysis/simulate          : 협상 시나리오 시뮬레이션
 * - GET    /contract-analysis/checklist         : 첨부서류 체크리스트
 * - POST   /contract-analysis/admin/rulesets    : 관리자 룰셋/표준계약서 갱신
 * - OPTIONS *                                    : CORS 프리플라이트
 *
 * 오류 응답은 표준 `ErrorResponse` 형식을 유지하며, 사용자 대면 메시지는
 * 존댓말 한국어로 제공한다.
 *
 * @module ContractAnalysisHandler
 * @requirements 16.3
 */

import {
  ErrorSeverity,
  type ErrorResponse,
  type ModuleInput,
  type ModuleOutput,
} from '../../common/interfaces/service-module.js';
import type {
  ContractType,
  PartyPerspective,
} from './interfaces/index.js';
import type { RecognizedClause } from './interfaces/document-recognizer.js';
import type { RegistryMatchResult } from './interfaces/registry-matcher.js';
import type { MissingClause } from './interfaces/risk-detector.js';

import type { UploadHandler, UploadRequest } from './upload/upload-handler.js';
import type {
  AnalysisOrchestrator,
  AnalysisOrchestratorInput,
} from './orchestrator/analysis-orchestrator.js';
import {
  RegistryMatcherModule,
  REGISTRY_MATCHER_INPUT_TYPE,
  type RegistryMatcherExecuteInput,
} from './registry-matcher/index.js';
import {
  RevisionAdvisorModule,
  REVISION_ADVISOR_INPUT_TYPE,
} from './revision-advisor/index.js';
import type { RevisionAdvisorInput } from './interfaces/index.js';
import {
  ClauseRecommenderModule,
} from './clause-recommender/index.js';
import {
  VersionManagerModule,
  VERSION_MANAGER_INPUT_TYPE,
} from './version-manager/index.js';
import type { VersionManagerInput } from './interfaces/version-manager.js';
import {
  SimulationEngineModule,
  SIMULATION_ENGINE_INPUT_TYPE,
} from './simulation-engine/index.js';
import type { ClauseChangeRequest } from './interfaces/simulation-engine.js';
import {
  ChecklistModule,
  CHECKLIST_INPUT_TYPE,
  type ChecklistInput,
} from './checklist/index.js';
import type {
  ContractAdminService,
  ContractDataKind,
} from './admin/admin-service.js';
import type {
  ToxicRuleDocument,
  StandardFormDocument,
} from './storage/opensearch-store.js';

// ---------------------------------------------------------------------------
// API Gateway 이벤트/응답 타입 (기존 핸들러와 동일한 형태)
// ---------------------------------------------------------------------------

/**
 * API Gateway 프록시 이벤트 인터페이스
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
 * API Gateway 프록시 응답 인터페이스
 */
export interface APIGatewayProxyResult {
  /** HTTP 상태 코드 */
  statusCode: number;
  /** 응답 헤더 */
  headers: Record<string, string>;
  /** 응답 본문 (JSON 문자열) */
  body: string;
}

// ---------------------------------------------------------------------------
// 공통 상수 및 유틸리티
// ---------------------------------------------------------------------------

/** 공통 CORS 및 JSON 응답 헤더 */
const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

/** 파일 업로드 최대 크기 (바이트): 20MB */
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

/** 라우팅 매칭에 사용하는 서비스 경로 접두사 */
const BASE_PATH = '/contract-analysis';

/** 허용되는 계약 유형 집합 */
const VALID_CONTRACT_TYPES: ReadonlySet<string> = new Set<ContractType>([
  'sale',
  'jeonse',
  'wolse',
  'commercial_lease',
]);

/** 허용되는 당사자 관점 집합 */
const VALID_PERSPECTIVES: ReadonlySet<string> = new Set<PartyPerspective>([
  'buyer',
  'seller',
  'landlord',
  'tenant',
]);

/**
 * 구조화된 로그 출력.
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
      service: 'contract-analysis',
      message,
      timestamp: new Date().toISOString(),
      ...data,
    }),
  );
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
 * 표준 `ErrorResponse`를 생성한다.
 *
 * 모든 사용자 대면 메시지는 존댓말 한국어로 제공한다.
 *
 * @param code - 오류 코드
 * @param message - 사용자 대면 메시지 (존댓말 한국어)
 * @param severity - 오류 심각도
 * @param context - 부가 컨텍스트
 * @returns 표준 오류 응답
 */
function buildError(
  code: string,
  message: string,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM,
  context?: Record<string, unknown>,
): ErrorResponse {
  const error: ErrorResponse = {
    code,
    message,
    severity,
    timestamp: new Date().toISOString(),
  };
  if (context) {
    error.context = context;
  }
  return error;
}

/**
 * 표준 오류 응답 본문을 담은 HTTP 응답을 생성한다.
 *
 * @param statusCode - HTTP 상태 코드
 * @param error - 표준 오류 응답
 * @returns API Gateway 응답
 */
function errorResponse(
  statusCode: number,
  error: ErrorResponse,
): APIGatewayProxyResult {
  return createResponse(statusCode, { success: false, error });
}

/**
 * 오류 심각도를 HTTP 상태 코드로 매핑한다.
 *
 * 타임아웃 코드는 504, 입력 검증 오류는 400, 그 외 심각도 HIGH/CRITICAL은
 * 500, 나머지는 400으로 처리한다.
 *
 * @param error - 표준 오류 응답
 * @returns HTTP 상태 코드
 */
function statusFromError(error: ErrorResponse): number {
  const code = error.code.toUpperCase();
  if (code.includes('TIMEOUT')) {
    return 504;
  }
  if (code.includes('INVALID_INPUT') || code.includes('INPUT_COUNT')) {
    return 400;
  }
  if (
    error.severity === ErrorSeverity.HIGH ||
    error.severity === ErrorSeverity.CRITICAL
  ) {
    return 500;
  }
  return 400;
}

/**
 * `ModuleOutput`을 HTTP 응답으로 변환한다.
 *
 * 성공 시 200과 함께 `data`를 반환하고, 실패 시 첫 번째 오류의 심각도/코드를
 * 기반으로 상태 코드를 결정하여 표준 오류 응답을 반환한다.
 *
 * @param output - 모듈 출력
 * @returns API Gateway 응답
 */
function moduleOutputToResponse(output: ModuleOutput): APIGatewayProxyResult {
  if (output.success) {
    return createResponse(200, { success: true, data: output.data });
  }
  const first =
    output.errors && output.errors.length > 0
      ? output.errors[0]!
      : buildError(
          'CONTRACT_UNKNOWN_ERROR',
          '요청 처리 중 오류가 발생했어요. 다시 시도해 주세요.',
          ErrorSeverity.HIGH,
        );
  return errorResponse(statusFromError(first), first);
}

/**
 * 요청 본문을 JSON으로 파싱한다.
 *
 * @param event - API Gateway 이벤트
 * @returns 파싱 결과 (성공 시 파싱된 객체, 실패 시 오류 응답)
 */
function parseBody<T>(
  event: APIGatewayProxyEvent,
):
  | { ok: true; value: T }
  | { ok: false; response: APIGatewayProxyResult } {
  if (!event.body) {
    return {
      ok: false,
      response: errorResponse(
        400,
        buildError(
          'CONTRACT_EMPTY_BODY',
          '요청 본문이 비어 있어요. 필요한 정보를 담아 다시 요청해 주세요.',
        ),
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(event.body) as T };
  } catch {
    return {
      ok: false,
      response: errorResponse(
        400,
        buildError(
          'CONTRACT_INVALID_JSON',
          '요청 본문의 형식(JSON)이 올바르지 않아요. 형식을 확인한 뒤 다시 요청해 주세요.',
        ),
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// 요청 본문 타입
// ---------------------------------------------------------------------------

/** 업로드 요청 본문 (파일은 base64로 전달) */
export interface UploadRequestBody {
  /** base64 인코딩된 파일 데이터 */
  fileBase64: string;
  /** 파일 MIME 타입 */
  mimeType: string;
}

/** 분석 요청 본문 */
export interface AnalyzeRequestBody {
  /** 문서 식별자 */
  documentId: string;
  /** 전체 인식 텍스트 */
  fullText: string;
  /** 문서 인식으로 분할된 조항 목록 */
  clauses: RecognizedClause[];
  /** 확정된 계약 유형 */
  contractType: ContractType;
  /** 확정된 당사자 관점 */
  perspective: PartyPerspective;
  /** 등기부 대조 결과 (선택) */
  registryResult?: RegistryMatchResult;
}

/** 관리자 룰셋/표준계약서 갱신 요청 본문 */
export interface AdminRulesetRequestBody {
  /** 대상 종류 (ruleset | standard) */
  kind: ContractDataKind;
  /** 계약 유형 */
  contractType: ContractType;
  /** 룰셋 문서 목록 (kind=ruleset) */
  rules?: ToxicRuleDocument[];
  /** 표준계약서 문서 목록 (kind=standard) */
  clauses?: StandardFormDocument[];
}

// ---------------------------------------------------------------------------
// 핸들러 의존성 (DI)
// ---------------------------------------------------------------------------

/**
 * 계약서 분석 핸들러 의존성.
 *
 * 각 모듈은 외부 인프라(S3/DynamoDB/OpenSearch/임베딩)에 의존하므로,
 * 팩토리(지연 생성)로 주입하여 테스트 가능성과 콜드 스타트 효율을 확보한다.
 * 특정 엔드포인트에 필요한 의존성이 주입되지 않으면 해당 엔드포인트는 503
 * 안내를 반환한다.
 */
export interface ContractAnalysisHandlerDeps {
  /** 업로드 처리기 팩토리 */
  uploadHandler?: () => UploadHandler;
  /** 분석 오케스트레이터 팩토리 */
  orchestrator?: () => AnalysisOrchestrator;
  /** 등기부 대조기 (미주입 시 기본 인스턴스 생성) */
  registryMatcher?: () => RegistryMatcherModule;
  /** 수정제안 생성기 (미주입 시 기본 인스턴스 생성) */
  revisionAdvisor?: () => RevisionAdvisorModule;
  /** 특약 추천기 (미주입 시 기본 인스턴스 생성) */
  clauseRecommender?: () => ClauseRecommenderModule;
  /** 버전 관리기 팩토리 (DynamoDB 의존) */
  versionManager?: () => VersionManagerModule;
  /** 시뮬레이션 엔진 팩토리 (탐지·평가기 의존) */
  simulationEngine?: () => SimulationEngineModule;
  /** 첨부서류 체크리스트 (미주입 시 기본 인스턴스 생성) */
  checklist?: () => ChecklistModule;
  /** 관리 서비스 팩토리 (임베딩·OpenSearch·메타데이터 의존) */
  adminService?: () => ContractAdminService;
}

/**
 * 의존성이 주입되지 않은 엔드포인트에 대한 503 안내 응답을 생성한다.
 *
 * @param feature - 사용 불가한 기능 이름 (한국어)
 * @returns API Gateway 응답
 */
function serviceUnavailable(feature: string): APIGatewayProxyResult {
  return errorResponse(
    503,
    buildError(
      'CONTRACT_SERVICE_UNAVAILABLE',
      `${feature} 기능이 현재 준비되지 않았어요. 잠시 후 다시 시도해 주세요.`,
      ErrorSeverity.HIGH,
      { feature },
    ),
  );
}

// ---------------------------------------------------------------------------
// 엔드포인트 처리기
// ---------------------------------------------------------------------------

/**
 * POST /contract-analysis/upload — 계약서 파일 업로드.
 *
 * base64 파일 데이터·MIME 타입·크기를 검증하고 `UploadHandler`에 위임한다.
 * 검증 실패 시 파일을 저장하지 않고 표준 오류를 반환한다.
 *
 * @requirements 16.3
 */
async function handleUpload(
  event: APIGatewayProxyEvent,
  uploadHandler: UploadHandler,
): Promise<APIGatewayProxyResult> {
  const parsed = parseBody<UploadRequestBody>(event);
  if (!parsed.ok) {
    return parsed.response;
  }
  const { fileBase64, mimeType } = parsed.value;

  if (typeof fileBase64 !== 'string' || fileBase64.length === 0) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_UPLOAD_INVALID_INPUT',
        '업로드할 파일 데이터(fileBase64)가 필요해요.',
      ),
    );
  }
  if (typeof mimeType !== 'string' || mimeType.length === 0) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_UPLOAD_INVALID_INPUT',
        '파일 형식(mimeType) 정보가 필요해요.',
      ),
    );
  }

  let body: Buffer;
  try {
    body = Buffer.from(fileBase64, 'base64');
  } catch {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_UPLOAD_INVALID_INPUT',
        '파일 데이터를 해석하지 못했어요. base64 인코딩을 확인해 주세요.',
      ),
    );
  }

  const request: UploadRequest = {
    body,
    mimeType,
    sizeBytes: body.length,
  };

  const result = await uploadHandler.handle(request);
  if (!result.success) {
    return errorResponse(statusFromError(result.error), result.error);
  }

  return createResponse(201, {
    success: true,
    data: {
      documentId: result.documentId,
      s3Key: result.s3Key,
      status: result.record.status,
    },
  });
}

/**
 * POST /contract-analysis/analyze — 전체 분석 파이프라인 실행.
 *
 * documentId·계약유형·당사자관점·조항 목록을 검증한 뒤 오케스트레이터에
 * 위임한다. 오케스트레이터는 타임아웃·부분 실패(Graceful Degradation)를 자체
 * 처리하며, 실패 결과는 표준 오류 형태로 변환한다.
 *
 * @requirements 16.3
 */
async function handleAnalyze(
  event: APIGatewayProxyEvent,
  orchestrator: AnalysisOrchestrator,
): Promise<APIGatewayProxyResult> {
  const parsed = parseBody<AnalyzeRequestBody>(event);
  if (!parsed.ok) {
    return parsed.response;
  }
  const bodyValue = parsed.value;

  const validationError = validateAnalyzeBody(bodyValue);
  if (validationError) {
    return errorResponse(400, validationError);
  }

  const input: AnalysisOrchestratorInput = {
    documentId: bodyValue.documentId,
    fullText: bodyValue.fullText,
    clauses: bodyValue.clauses,
    contractType: bodyValue.contractType,
    perspective: bodyValue.perspective,
    ...(bodyValue.registryResult
      ? { registryResult: bodyValue.registryResult }
      : {}),
  };

  const result = await orchestrator.analyze(input);
  if (!result.success) {
    const status = result.error.code.includes('TIMEOUT') ? 504 : 500;
    return errorResponse(
      status,
      buildError(result.error.code, result.error.message, ErrorSeverity.HIGH, {
        manualRetryAvailable: result.error.manualRetryAvailable,
        autoRetryCount: result.error.autoRetryCount,
        documentPreserved: result.error.documentPreserved,
      }),
    );
  }

  return createResponse(200, { success: true, data: result.result });
}

/**
 * 분석 요청 본문을 검증한다.
 *
 * @param body - 분석 요청 본문
 * @returns 오류가 있으면 표준 오류 응답, 없으면 null
 */
function validateAnalyzeBody(body: AnalyzeRequestBody): ErrorResponse | null {
  const invalid = (reason: string): ErrorResponse =>
    buildError(
      'CONTRACT_ANALYZE_INVALID_INPUT',
      '분석 요청 형식이 올바르지 않아요. 입력을 확인해 주세요.',
      ErrorSeverity.MEDIUM,
      { reason },
    );

  if (typeof body.documentId !== 'string' || body.documentId.length === 0) {
    return invalid('documentId가 필요합니다.');
  }
  if (typeof body.fullText !== 'string') {
    return invalid('fullText(문자열)가 필요합니다.');
  }
  if (!Array.isArray(body.clauses)) {
    return invalid('clauses 배열이 필요합니다.');
  }
  if (!VALID_CONTRACT_TYPES.has(body.contractType)) {
    return invalid('유효한 contractType이 필요합니다.');
  }
  if (!VALID_PERSPECTIVES.has(body.perspective)) {
    return invalid('유효한 perspective가 필요합니다.');
  }
  return null;
}

/**
 * POST /contract-analysis/registry — 등기부등본 업로드·대조.
 *
 * 등기부등본 S3 키·MIME 타입·크기·계약 정보를 등기부 대조기에 위임한다.
 * 형식/크기 위반 및 추출 실패는 대조기가 표준 오류로 처리한다.
 *
 * @requirements 16.3
 */
async function handleRegistry(
  event: APIGatewayProxyEvent,
  registryMatcher: RegistryMatcherModule,
): Promise<APIGatewayProxyResult> {
  const parsed = parseBody<Partial<RegistryMatcherExecuteInput>>(event);
  if (!parsed.ok) {
    return parsed.response;
  }

  const moduleInput: ModuleInput = {
    type: REGISTRY_MATCHER_INPUT_TYPE,
    payload: parsed.value,
  };

  const output = await registryMatcher.execute(moduleInput);
  return moduleOutputToResponse(output);
}

/**
 * POST /contract-analysis/advise — 조항 판단/수정 제안.
 *
 * mode=suggest는 위험 조항에 대한 수정 문안을, mode=judge는 조항 문구의 법적
 * 유효성·유불리·주의사항 판단을 생성한다. 수정제안 생성기에 위임한다.
 *
 * @requirements 16.3
 */
async function handleAdvise(
  event: APIGatewayProxyEvent,
  revisionAdvisor: RevisionAdvisorModule,
): Promise<APIGatewayProxyResult> {
  const parsed = parseBody<RevisionAdvisorInput>(event);
  if (!parsed.ok) {
    return parsed.response;
  }

  const moduleInput: ModuleInput = {
    type: REVISION_ADVISOR_INPUT_TYPE,
    payload: parsed.value,
  };

  const output = await revisionAdvisor.execute(moduleInput);
  return moduleOutputToResponse(output);
}

/**
 * GET /contract-analysis/recommendations — 실시간 특약 추천.
 *
 * 쿼리 스트링에서 계약 유형·당사자 관점을 읽어 특약 추천기에 위임한다.
 * 누락 특약은 JSON 문자열(missingClauses)로 선택 전달할 수 있다.
 *
 * @requirements 16.3
 */
async function handleRecommendations(
  event: APIGatewayProxyEvent,
  clauseRecommender: ClauseRecommenderModule,
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters ?? {};
  const contractType = query['contractType'];
  const perspective = query['perspective'];

  if (!contractType || !VALID_CONTRACT_TYPES.has(contractType)) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_RECOMMEND_INVALID_INPUT',
        '유효한 contractType 쿼리 파라미터가 필요해요.',
      ),
    );
  }
  if (!perspective || !VALID_PERSPECTIVES.has(perspective)) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_RECOMMEND_INVALID_INPUT',
        '유효한 perspective 쿼리 파라미터가 필요해요.',
      ),
    );
  }

  let missingClauses: MissingClause[] | undefined;
  if (query['missingClauses']) {
    try {
      missingClauses = JSON.parse(query['missingClauses']) as MissingClause[];
    } catch {
      return errorResponse(
        400,
        buildError(
          'CONTRACT_RECOMMEND_INVALID_INPUT',
          'missingClauses 파라미터의 형식(JSON)이 올바르지 않아요.',
        ),
      );
    }
  }

  try {
    const output = await clauseRecommender.recommend({
      contractType: contractType as ContractType,
      perspective: perspective as PartyPerspective,
      ...(missingClauses ? { missingClauses } : {}),
    });
    return createResponse(200, { success: true, data: output });
  } catch (error) {
    return errorResponse(
      500,
      buildError(
        'CONTRACT_RECOMMEND_FAILED',
        '특약 추천 중 오류가 발생했어요. 다시 시도해 주세요.',
        ErrorSeverity.HIGH,
        { reason: error instanceof Error ? error.message : String(error) },
      ),
    );
  }
}

/**
 * POST /contract-analysis/versions — 버전 저장.
 *
 * documentId·수정본 내용을 버전 관리기(action=save)에 위임한다.
 *
 * @requirements 16.3
 */
async function handleVersionSave(
  event: APIGatewayProxyEvent,
  versionManager: VersionManagerModule,
): Promise<APIGatewayProxyResult> {
  const parsed = parseBody<{ documentId?: string; revisedContent?: string }>(
    event,
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  const payload: VersionManagerInput = {
    action: 'save',
    documentId: parsed.value.documentId as string,
    revisedContent: parsed.value.revisedContent as string,
  };

  const output = await versionManager.execute({
    type: VERSION_MANAGER_INPUT_TYPE,
    payload,
  });
  return moduleOutputToResponse(output);
}

/**
 * GET /contract-analysis/versions/compare — 버전 비교.
 *
 * 쿼리 스트링에서 documentId·versionA·versionB를 읽어 버전 관리기
 * (action=compare)에 위임한다.
 *
 * @requirements 16.3
 */
async function handleVersionCompare(
  event: APIGatewayProxyEvent,
  versionManager: VersionManagerModule,
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters ?? {};
  const documentId = query['documentId'];
  const versionA = Number(query['versionA']);
  const versionB = Number(query['versionB']);

  if (!documentId) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_VERSION_INVALID_INPUT',
        'documentId 쿼리 파라미터가 필요해요.',
      ),
    );
  }
  if (!Number.isInteger(versionA) || !Number.isInteger(versionB)) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_VERSION_INVALID_INPUT',
        '정수형 versionA·versionB 쿼리 파라미터가 필요해요.',
      ),
    );
  }

  const payload: VersionManagerInput = {
    action: 'compare',
    documentId,
    versionA,
    versionB,
  };

  const output = await versionManager.execute({
    type: VERSION_MANAGER_INPUT_TYPE,
    payload,
  });
  return moduleOutputToResponse(output);
}

/**
 * POST /contract-analysis/simulate — 협상 시나리오 시뮬레이션.
 *
 * documentId·조항 변경안(1~20개)을 시뮬레이션 엔진에 위임한다. 개수 검증 및
 * 원본 무변경 보장은 엔진이 담당한다.
 *
 * @requirements 16.3
 */
async function handleSimulate(
  event: APIGatewayProxyEvent,
  simulationEngine: SimulationEngineModule,
): Promise<APIGatewayProxyResult> {
  const parsed = parseBody<{
    documentId?: string;
    clauseChanges?: ClauseChangeRequest[];
  }>(event);
  if (!parsed.ok) {
    return parsed.response;
  }

  const output = await simulationEngine.execute({
    type: SIMULATION_ENGINE_INPUT_TYPE,
    payload: {
      documentId: parsed.value.documentId,
      clauseChanges: parsed.value.clauseChanges,
    },
  });
  return moduleOutputToResponse(output);
}

/**
 * GET /contract-analysis/checklist — 첨부서류 체크리스트.
 *
 * 쿼리 스트링에서 계약 유형을 읽어 체크리스트 모듈에 위임한다.
 *
 * @requirements 16.3
 */
async function handleChecklist(
  event: APIGatewayProxyEvent,
  checklist: ChecklistModule,
): Promise<APIGatewayProxyResult> {
  const query = event.queryStringParameters ?? {};
  const contractType = query['contractType'];

  if (!contractType || !VALID_CONTRACT_TYPES.has(contractType)) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_CHECKLIST_INVALID_INPUT',
        '유효한 contractType 쿼리 파라미터가 필요해요.',
      ),
    );
  }

  const payload: ChecklistInput = {
    contractType: contractType as ContractType,
  };

  const output = await checklist.execute({
    type: CHECKLIST_INPUT_TYPE,
    payload,
  });
  return moduleOutputToResponse(output);
}

/**
 * POST /contract-analysis/admin/rulesets — 관리자 룰셋/표준계약서 갱신.
 *
 * kind=ruleset이면 독소조항 룰셋을, kind=standard이면 표준계약서 조항을
 * 임베딩하여 적재한다. 부분 실패 시에도 결과(failedPatterns)를 그대로 반환한다.
 *
 * @requirements 16.3
 */
async function handleAdminRulesets(
  event: APIGatewayProxyEvent,
  adminService: ContractAdminService,
): Promise<APIGatewayProxyResult> {
  const parsed = parseBody<AdminRulesetRequestBody>(event);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.value;

  if (!VALID_CONTRACT_TYPES.has(body.contractType)) {
    return errorResponse(
      400,
      buildError(
        'CONTRACT_ADMIN_INVALID_INPUT',
        '유효한 contractType이 필요해요.',
      ),
    );
  }

  try {
    if (body.kind === 'ruleset') {
      if (!Array.isArray(body.rules)) {
        return errorResponse(
          400,
          buildError(
            'CONTRACT_ADMIN_INVALID_INPUT',
            'kind=ruleset 요청에는 rules 배열이 필요해요.',
          ),
        );
      }
      const result = await adminService.updateRuleSet(
        body.contractType,
        body.rules,
      );
      return createResponse(200, { success: result.success, data: result });
    }

    if (body.kind === 'standard') {
      if (!Array.isArray(body.clauses)) {
        return errorResponse(
          400,
          buildError(
            'CONTRACT_ADMIN_INVALID_INPUT',
            'kind=standard 요청에는 clauses 배열이 필요해요.',
          ),
        );
      }
      const result = await adminService.updateStandardForm(
        body.contractType,
        body.clauses,
      );
      return createResponse(200, { success: result.success, data: result });
    }

    return errorResponse(
      400,
      buildError(
        'CONTRACT_ADMIN_INVALID_INPUT',
        'kind는 ruleset 또는 standard여야 해요.',
      ),
    );
  } catch (error) {
    return errorResponse(
      500,
      buildError(
        'CONTRACT_ADMIN_FAILED',
        '룰셋/표준계약서 갱신 중 오류가 발생했어요. 다시 시도해 주세요.',
        ErrorSeverity.HIGH,
        { reason: error instanceof Error ? error.message : String(error) },
      ),
    );
  }
}

/**
 * OPTIONS 프리플라이트 요청을 처리한다.
 *
 * @returns CORS 헤더를 포함한 빈 200 응답
 */
function handleOptions(): APIGatewayProxyResult {
  return { statusCode: 200, headers: CORS_HEADERS, body: '' };
}

// ---------------------------------------------------------------------------
// 라우팅 유틸리티
// ---------------------------------------------------------------------------

/**
 * 요청 경로가 지정한 서비스 하위 경로와 일치하는지 확인한다.
 *
 * 스테이지 접두사(예: `/prod`)가 붙어도 매칭되도록 접미사 비교를 함께 사용한다.
 *
 * @param path - 요청 경로
 * @param suffix - `/contract-analysis` 이하 하위 경로 (예: `/upload`)
 * @returns 일치 여부
 */
function matchPath(path: string, suffix: string): boolean {
  const full = `${BASE_PATH}${suffix}`;
  return path === full || path.endsWith(full);
}

// ---------------------------------------------------------------------------
// 지연 생성 팩토리 (기본 의존성)
// ---------------------------------------------------------------------------

/**
 * 지연 생성기를 만든다. 최초 호출 시 인스턴스를 생성하고 이후 재사용한다.
 *
 * @param create - 인스턴스 생성 함수
 * @returns 캐시된 인스턴스를 반환하는 함수
 */
function lazy<T>(create: () => T): () => T {
  let cached: T | undefined;
  return () => {
    if (cached === undefined) {
      cached = create();
    }
    return cached;
  };
}

/**
 * 기본 의존성을 구성한다.
 *
 * 외부 인프라 의존성이 없는 모듈(등기부 대조기·수정제안 생성기·특약 추천기·
 * 체크리스트)은 기본 인스턴스를 지연 생성한다. 외부 인프라 의존성이 필수인
 * 모듈(업로드·오케스트레이터·버전 관리기·시뮬레이션·관리)은 주입되지 않으면
 * 해당 엔드포인트에서 503 안내를 반환한다.
 *
 * @param deps - 주입된 의존성 (선택)
 * @returns 완성된 의존성 집합
 */
function resolveDeps(
  deps?: ContractAnalysisHandlerDeps,
): Required<Pick<
  ContractAnalysisHandlerDeps,
  'registryMatcher' | 'revisionAdvisor' | 'clauseRecommender' | 'checklist'
>> &
  ContractAnalysisHandlerDeps {
  return {
    ...deps,
    registryMatcher:
      deps?.registryMatcher ?? lazy(() => new RegistryMatcherModule()),
    revisionAdvisor:
      deps?.revisionAdvisor ?? lazy(() => new RevisionAdvisorModule()),
    clauseRecommender:
      deps?.clauseRecommender ?? lazy(() => new ClauseRecommenderModule()),
    checklist: deps?.checklist ?? lazy(() => new ChecklistModule()),
  };
}

// ---------------------------------------------------------------------------
// 핸들러 팩토리 및 진입점
// ---------------------------------------------------------------------------

/**
 * 계약서 분석 Lambda 핸들러를 생성한다.
 *
 * 의존성 주입을 지원하여 테스트 가능한 핸들러를 만든다. 외부 인프라가 필요한
 * 엔드포인트(업로드·분석·버전·시뮬레이션·관리)는 해당 의존성이 주입된 경우에만
 * 동작하며, 미주입 시 503 안내를 반환한다.
 *
 * @param rawDeps - 선택적 의존성 주입
 * @returns Lambda 핸들러 함수
 *
 * @requirements 16.3
 */
export function createContractAnalysisHandler(
  rawDeps?: ContractAnalysisHandlerDeps,
): (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult> {
  const deps = resolveDeps(rawDeps);

  return async (
    event: APIGatewayProxyEvent,
  ): Promise<APIGatewayProxyResult> => {
    logStructured('INFO', '계약서 분석 요청 수신', {
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

    try {
      // POST /contract-analysis/upload
      if (method === 'POST' && matchPath(path, '/upload')) {
        if (!deps.uploadHandler) {
          return serviceUnavailable('파일 업로드');
        }
        return await handleUpload(event, deps.uploadHandler());
      }

      // POST /contract-analysis/analyze
      if (method === 'POST' && matchPath(path, '/analyze')) {
        if (!deps.orchestrator) {
          return serviceUnavailable('계약서 분석');
        }
        return await handleAnalyze(event, deps.orchestrator());
      }

      // POST /contract-analysis/registry
      if (method === 'POST' && matchPath(path, '/registry')) {
        return await handleRegistry(event, deps.registryMatcher());
      }

      // POST /contract-analysis/advise
      if (method === 'POST' && matchPath(path, '/advise')) {
        return await handleAdvise(event, deps.revisionAdvisor());
      }

      // GET /contract-analysis/recommendations
      if (method === 'GET' && matchPath(path, '/recommendations')) {
        return await handleRecommendations(event, deps.clauseRecommender());
      }

      // GET /contract-analysis/versions/compare (버전 비교, /versions 보다 먼저 매칭)
      if (method === 'GET' && matchPath(path, '/versions/compare')) {
        if (!deps.versionManager) {
          return serviceUnavailable('버전 비교');
        }
        return await handleVersionCompare(event, deps.versionManager());
      }

      // POST /contract-analysis/versions (버전 저장)
      if (method === 'POST' && matchPath(path, '/versions')) {
        if (!deps.versionManager) {
          return serviceUnavailable('버전 저장');
        }
        return await handleVersionSave(event, deps.versionManager());
      }

      // POST /contract-analysis/simulate
      if (method === 'POST' && matchPath(path, '/simulate')) {
        if (!deps.simulationEngine) {
          return serviceUnavailable('협상 시나리오 시뮬레이션');
        }
        return await handleSimulate(event, deps.simulationEngine());
      }

      // GET /contract-analysis/checklist
      if (method === 'GET' && matchPath(path, '/checklist')) {
        return await handleChecklist(event, deps.checklist());
      }

      // POST /contract-analysis/admin/rulesets
      if (method === 'POST' && matchPath(path, '/admin/rulesets')) {
        if (!deps.adminService) {
          return serviceUnavailable('관리자 룰셋/표준계약서 갱신');
        }
        return await handleAdminRulesets(event, deps.adminService());
      }

      // 지원하지 않는 경로
      return errorResponse(
        404,
        buildError(
          'CONTRACT_NOT_FOUND',
          `지원하지 않는 경로예요: ${method} ${path}`,
        ),
      );
    } catch (error) {
      logStructured('ERROR', '계약서 분석 요청 처리 중 예기치 못한 오류', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(
        500,
        buildError(
          'CONTRACT_INTERNAL_ERROR',
          '요청 처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
          ErrorSeverity.HIGH,
        ),
      );
    }
  };
}

/**
 * Lambda 핸들러 함수 (메인 진입점).
 *
 * API Gateway REST API에서 호출된다. 기본 팩토리로 생성되며, 외부 인프라
 * 의존성(업로드·분석·버전·시뮬레이션·관리)은 배포 환경에서 별도 초기화 후
 * `createContractAnalysisHandler`로 주입하는 것을 권장한다.
 *
 * @param event - API Gateway Proxy 이벤트
 * @returns API Gateway Proxy 응답
 *
 * @requirements 16.3
 */
export const handler = createContractAnalysisHandler();
