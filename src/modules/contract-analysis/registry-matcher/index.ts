/**
 * 등기부 대조기 모듈 (RegistryMatcherModule)
 *
 * 업로드된 등기부등본 파일에서 근저당 설정액·선순위 채권·소유자 정보를
 * 추출하고, 계약서상 정보(보증금·시세·임대인)와 대조하여 전세가율·선순위
 * 채권 비율·소유자 불일치를 산출하며 전세사기 위험 점수를 부여하는 표준
 * `ServiceModule` 구현체이다.
 *
 * 처리 흐름:
 *   1. `RegistryExtractor`로 파일 검증(형식/크기) 및 OCR 텍스트 파싱
 *   2. 파싱 실패 항목이 있으면 위험도 산출을 진행하지 않고 실패 항목을 안내
 *   3. 실패 항목이 없으면 `FraudScorer`로 전세가율·선순위 비율·위험 점수 산출
 *
 * 주요 규칙:
 *   - Property 15: 전세가율 = 보증금/시세*100, 선순위비율 = 선순위/시세*100
 *   - Property 16: 위험 점수는 0~100 정수
 *   - Property 17: 고위험 기준(전세가율≥80 / 선순위≥60 / 점수≥임계값) 초과 시
 *     위험도 상 경고 + exceededCriteria에 초과 항목 정확히 포함
 *   - Property 18: ownerMismatch = 등기부 소유자 !== 계약서 임대인
 *
 * 형식/크기 위반 시 파일을 처리하지 않고 표준 오류를 반환하며 기존 입력을
 * 보존한다. 외부 등기소 자동 조회는 수행하지 않고 업로드 파일만 사용한다.
 *
 * @module RegistryMatcherModule
 * @requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10
 */

import {
  ErrorSeverity,
  HealthStatusEnum,
  type ErrorResponse,
  type HealthStatus,
  type ModuleConfig,
  type ModuleInput,
  type ModuleOutput,
  type ServiceModule,
} from '../../../common/interfaces/service-module.js';
import type {
  RegistryMatcherInput,
  RegistryMatchResult,
} from '../interfaces/registry-matcher.js';
import type { FraudRiskScore } from '../interfaces/risk-evaluator.js';
import { createOcrProvider } from '../document-recognizer/providers/ocr-provider.js';
import type { OcrProvider } from '../interfaces/document-recognizer.js';
import {
  RegistryExtractor,
  type RegistryExtractionField,
} from './registry-extractor.js';
import { FraudScorer, DEFAULT_FRAUD_SCORE_THRESHOLD } from './fraud-scorer.js';

/** 등기부 대조기 입력 판별자 */
export const REGISTRY_MATCHER_INPUT_TYPE = 'registry-matcher.match';

/** 입력 스키마 불일치 오류 코드 */
export const REGISTRY_MATCHER_INVALID_INPUT_CODE = 'CONTRACT_REGISTRY_INVALID_INPUT';

/** 추출 실패로 위험도 산출을 진행하지 못한 경우의 코드 */
export const REGISTRY_EXTRACTION_INCOMPLETE_CODE = 'CONTRACT_REGISTRY_EXTRACTION_INCOMPLETE';

/** 등기부 대조 처리 실패 오류 코드 */
export const REGISTRY_MATCHER_ERROR_CODE = 'CONTRACT_REGISTRY_MATCH_FAILED';

/**
 * 등기부 대조기 실행 입력
 *
 * 표준 `RegistryMatcherInput`에 파일 크기(sizeBytes)를 추가한다. 크기 검증에
 * 필요하며 업로드 단계에서 확인된 값을 전달받는다.
 */
export interface RegistryMatcherExecuteInput extends RegistryMatcherInput {
  /** 업로드된 등기부등본 파일 크기 (바이트) */
  sizeBytes: number;
  /** 전세사기 위험 점수 임계값 (미지정 시 기본 70) */
  fraudScoreThreshold?: number;
}

/**
 * 등기부 대조기 모듈 설정
 */
export interface RegistryMatcherModuleConfig {
  /** OCR 제공자 (미지정 시 OCR_PROVIDER 환경 변수로 생성) */
  ocrProvider?: OcrProvider;
  /** 등기부 정보 추출기 (미지정 시 기본 생성) */
  extractor?: RegistryExtractor;
  /** 전세사기 위험 점수 기본 임계값 (미지정 시 70) */
  fraudScoreThreshold?: number;
}

/**
 * 등기부 대조기 모듈
 *
 * @requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10
 */
export class RegistryMatcherModule implements ServiceModule {
  private readonly extractor: RegistryExtractor;
  private readonly defaultThreshold: number;

  constructor(config: RegistryMatcherModuleConfig = {}) {
    const ocrProvider = config.ocrProvider ?? createOcrProvider();
    this.extractor = config.extractor ?? new RegistryExtractor(ocrProvider);
    this.defaultThreshold = config.fraudScoreThreshold ?? DEFAULT_FRAUD_SCORE_THRESHOLD;
  }

  /**
   * 모듈을 초기화한다. 별도 상태 준비가 필요 없으므로 즉시 완료된다.
   *
   * @param _config - 모듈 설정 (미사용)
   */
  async initialize(_config: ModuleConfig): Promise<void> {
    // 의존성은 생성자에서 주입되므로 추가 초기화가 필요하지 않다.
  }

  /**
   * 표준 `ServiceModule` 실행 진입점.
   *
   * 입력 페이로드를 검증한 뒤 등기부 대조·전세사기 스코어링을 수행하고,
   * 결과를 `ModuleOutput`으로 감싸 반환한다. 형식/크기 위반 및 추출 실패 시
   * 표준 `ErrorResponse`를 담은 실패 출력을 반환하며 입력을 변경하지 않는다.
   *
   * @param input - 모듈 입력 (payload: RegistryMatcherExecuteInput)
   * @returns 모듈 출력
   * @requirements 5.2, 5.4
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      return await this.match(validation.payload);
    } catch (error) {
      return { success: false, errors: [this.buildError(error)] };
    }
  }

  /**
   * 등기부 대조·전세사기 스코어링 핵심 로직.
   *
   * 파일 검증·추출을 수행하고, 추출 실패 항목이 있으면 위험도 산출을
   * 진행하지 않고 실패 항목을 안내하는 실패 출력을 반환한다. 실패 항목이
   * 없으면 전세가율·선순위 비율·위험 점수·소유자 불일치를 산출하여
   * `RegistryMatchResult`와 `FraudRiskScore`를 함께 담아 반환한다.
   *
   * @param payload - 등기부 대조기 실행 입력
   * @returns 모듈 출력 (성공 시 data에 대조 결과 및 fraudScore 포함)
   * @requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10
   */
  async match(payload: RegistryMatcherExecuteInput): Promise<ModuleOutput> {
    // 1) 파일 검증 + OCR 추출 + 파싱
    const extraction = await this.extractor.extract({
      documentId: payload.documentId,
      registryS3Key: payload.registryS3Key,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
    });

    // 형식/크기 위반: 파일 처리하지 않고 기존 입력 보존한 채 안내
    if (!extraction.valid) {
      return { success: false, errors: [extraction.error] };
    }

    const scorer = new FraudScorer(payload.fraudScoreThreshold ?? this.defaultThreshold);

    // 2) 추출 실패 항목이 있으면 위험도 산출을 진행하지 않는다 (요구사항 5.4)
    if (extraction.extractionFailures.length > 0) {
      const result: RegistryMatchResult = {
        extractedInfo: extraction.info,
        jeonseRatio: 0,
        seniorClaimRatio: 0,
        ownerMismatch: false,
        extractionFailures: extraction.extractionFailures,
      };
      return {
        success: false,
        data: { registryResult: result, fraudScore: null },
        errors: [this.buildExtractionIncompleteError(extraction.extractionFailures)],
      };
    }

    // 3) 위험도 산출 (전세가율/선순위 비율/점수/소유자 불일치)
    const fraudScore: FraudRiskScore = scorer.score({
      contractDeposit: payload.contractDeposit,
      marketPrice: payload.marketPrice,
      seniorClaims: extraction.info.seniorClaims,
      mortgageAmount: extraction.info.mortgageAmount,
      registryOwnerName: extraction.info.ownerName,
      contractLandlordName: payload.contractLandlordName,
    });

    const registryResult: RegistryMatchResult = {
      extractedInfo: extraction.info,
      jeonseRatio: fraudScore.jeonseRatio,
      seniorClaimRatio: fraudScore.seniorClaimRatio,
      ownerMismatch: fraudScore.ownerMismatch,
      extractionFailures: [],
    };

    return {
      success: true,
      data: {
        registryResult,
        fraudScore,
        isHighRisk: scorer.isHighRisk(fraudScore),
      },
    };
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 필수 필드(documentId/registryS3Key/mimeType/
   * contractDeposit/marketPrice/contractLandlordName/sizeBytes)의 존재 및 타입을
   * 확인한다. 위반 시 표준 오류 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: RegistryMatcherExecuteInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: REGISTRY_MATCHER_INVALID_INPUT_CODE,
        message: '등기부 대조 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== REGISTRY_MATCHER_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<RegistryMatcherExecuteInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (typeof payload.documentId !== 'string' || payload.documentId.length === 0) {
      return invalid('documentId가 필요합니다.');
    }
    if (typeof payload.registryS3Key !== 'string' || payload.registryS3Key.length === 0) {
      return invalid('registryS3Key가 필요합니다.');
    }
    if (typeof payload.mimeType !== 'string') {
      return invalid('mimeType이 필요합니다.');
    }
    if (typeof payload.contractDeposit !== 'number' || !Number.isFinite(payload.contractDeposit)) {
      return invalid('contractDeposit(숫자)이 필요합니다.');
    }
    if (typeof payload.marketPrice !== 'number' || !Number.isFinite(payload.marketPrice)) {
      return invalid('marketPrice(숫자)가 필요합니다.');
    }
    if (typeof payload.contractLandlordName !== 'string') {
      return invalid('contractLandlordName이 필요합니다.');
    }
    if (typeof payload.sizeBytes !== 'number' || !Number.isFinite(payload.sizeBytes)) {
      return invalid('sizeBytes(숫자)가 필요합니다.');
    }

    return { valid: true, payload: payload as RegistryMatcherExecuteInput };
  }

  /**
   * 추출 실패 항목으로 위험도 산출을 진행하지 못한 경우의 안내 오류를 만든다.
   *
   * @param failures - 파싱하지 못한 항목 목록
   * @returns 표준 오류 응답
   * @requirements 5.4
   */
  private buildExtractionIncompleteError(
    failures: RegistryExtractionField[],
  ): ErrorResponse {
    const labelMap: Record<RegistryExtractionField, string> = {
      mortgageAmount: '근저당 설정액',
      seniorClaims: '선순위 채권',
      ownerName: '소유자 정보',
    };
    const failedLabels = failures.map((f) => labelMap[f]).join(', ');
    return {
      code: REGISTRY_EXTRACTION_INCOMPLETE_CODE,
      message: `등기부등본에서 ${failedLabels} 항목을 확인하지 못해 전세사기 위험도를 산출하지 못했습니다. 등기부등본을 다시 확인하거나 재업로드해 주세요.`,
      severity: ErrorSeverity.MEDIUM,
      timestamp: new Date().toISOString(),
      context: { extractionFailures: failures },
    };
  }

  /**
   * 처리 실패를 표준 오류 응답으로 변환한다.
   *
   * OCR 등 외부 의존성 실패는 심각도 HIGH로 분류하며, 입력 데이터는 변경하지
   * 않는다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildError(error: unknown): ErrorResponse {
    return {
      code: REGISTRY_MATCHER_ERROR_CODE,
      message: '등기부 대조 중 오류가 발생했습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        retryRequested: true,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 등기부 대조기는 외부 저장소 상태를 별도로 폴링하지 않으므로 정상 상태를
   * 즉시 반환한다.
   *
   * @returns 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    return {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * 모듈 이름을 반환한다.
   */
  getName(): string {
    return 'registry-matcher';
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export {
  RegistryExtractor,
  ERROR_CODE_REGISTRY_INVALID_FILE,
} from './registry-extractor.js';
export type {
  RegistryExtractionInput,
  RegistryExtractionResult,
  RegistryExtractionField,
} from './registry-extractor.js';
export {
  FraudScorer,
  JEONSE_RATIO_THRESHOLD,
  SENIOR_CLAIM_RATIO_THRESHOLD,
  DEFAULT_FRAUD_SCORE_THRESHOLD,
} from './fraud-scorer.js';
export type { FraudScoringInput } from './fraud-scorer.js';
