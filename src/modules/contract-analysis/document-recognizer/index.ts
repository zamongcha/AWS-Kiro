/**
 * @fileoverview 문서 인식기 모듈 (DocumentRecognizerModule)
 * @description 업로드된 계약서 파일을 OCR 제공자(Gemini Vision / Textract / Mock)로
 * 텍스트 인식하고, 조항 단위로 분할하여 위치 정보를 부여한 뒤 인식 결과를 반환한다.
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다.
 *
 * 처리 흐름:
 *   1. OCR 제공자로 텍스트 추출 (120초 타임아웃 적용)
 *   2. 파일 손상/타임아웃 감지 시 오류 반환 (부분 결과 미저장)
 *   3. 인식 텍스트 20자 미만이면 recognitionStatus=failed
 *   4. ClauseSplitter로 최대 1000개 조항 분할 (위치 정보 부여)
 *   5. Textract 좌표(blocks) 존재 시 hasCoordinates=true
 *   6. 인식 결과를 S3(contract-data/recognized/)에 저장
 *
 * @requirements 1.3 - Gemini Vision 멀티모달 텍스트 추출
 * @requirements 1.4 - 최대 1000개 조항 분할, 조항 식별자·위치 정보 부여
 * @requirements 1.5 - 처리 진행 상태 표시(상태 전이)
 * @requirements 1.8 - 손상 파일 감지 시 오류 반환 및 재업로드 옵션
 * @requirements 1.9 - 120초 타임아웃 시 시간 초과 오류 및 재시도 옵션
 * @requirements 1.10 - 인식 텍스트 20자 미만이면 recognitionStatus=failed
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../../common/interfaces/service-module.js';
import type {
  DocumentRecognizerInput,
  DocumentRecognizerOutput,
  OcrProvider,
  OcrResult,
} from '../interfaces/document-recognizer.js';
import { createOcrProvider, resolveOcrProviderKind } from './providers/ocr-provider.js';
import { ClauseSplitter } from './clause-splitter.js';
import {
  RecognitionValidator,
  RECOGNITION_TIMEOUT_MS,
  type RecognitionValidationFailure,
} from './recognition-validator.js';
import { ContractS3Store } from '../storage/s3-store.js';

/**
 * 문서 인식기 모듈 입력 페이로드
 */
export interface DocumentRecognizerPayload {
  /** 수행 작업 (현재 recognize만 지원) */
  action?: 'recognize';
  /** 문서 인식 입력 (documentId, s3Key, mimeType, ocrMode) */
  request: DocumentRecognizerInput;
}

/**
 * 문서 인식기 모듈 설정 값
 */
export interface DocumentRecognizerModuleConfig {
  /** OCR 처리 제한 시간 (밀리초, 기본 120000) */
  timeoutMs?: number;
  /** 인식 결과를 S3에 저장할지 여부 (기본 true) */
  persistToS3?: boolean;
}

/**
 * 문서 인식기 모듈
 *
 * ServiceModule 인터페이스를 구현하며, OCR 제공자·조항 분할기·검증기·S3 저장소를
 * 조합하여 문서 인식 파이프라인을 수행한다.
 */
export class DocumentRecognizerModule implements ServiceModule {
  private config: ModuleConfig | null = null;
  private ocrProvider: OcrProvider | null = null;
  private clauseSplitter: ClauseSplitter | null = null;
  private validator: RecognitionValidator | null = null;
  private s3Store: ContractS3Store | null = null;
  private timeoutMs: number = RECOGNITION_TIMEOUT_MS;
  private persistToS3 = true;
  private initialized = false;

  constructor(
    private readonly deps: {
      ocrProvider?: OcrProvider;
      clauseSplitter?: ClauseSplitter;
      validator?: RecognitionValidator;
      s3Store?: ContractS3Store;
    } = {},
  ) {}

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    this.timeoutMs = (config.config['timeoutMs'] as number | undefined) ?? RECOGNITION_TIMEOUT_MS;
    this.persistToS3 = (config.config['persistToS3'] as boolean | undefined) ?? true;

    // OCR 제공자는 OCR_PROVIDER 환경 변수 또는 config.ocrProviderKind로 결정한다.
    const providerOverride = config.config['ocrProviderKind'] as string | undefined;
    this.ocrProvider =
      this.deps.ocrProvider ??
      createOcrProvider(providerOverride ? resolveOcrProviderKind(providerOverride) : undefined);

    this.clauseSplitter = this.deps.clauseSplitter ?? new ClauseSplitter();
    this.validator = this.deps.validator ?? new RecognitionValidator({ timeoutMs: this.timeoutMs });
    this.s3Store = this.deps.s3Store ?? new ContractS3Store();

    this.initialized = true;
  }

  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (
      !this.initialized ||
      !this.ocrProvider ||
      !this.clauseSplitter ||
      !this.validator ||
      !this.s3Store
    ) {
      return this.errorOutput(
        'MODULE_NOT_INITIALIZED',
        '문서 인식기 모듈이 초기화되지 않았습니다.',
        ErrorSeverity.CRITICAL,
      );
    }

    const payload = input.payload as DocumentRecognizerPayload;
    if (!payload?.request) {
      return this.errorOutput(
        'INVALID_INPUT',
        '문서 인식 요청(request)이 필요합니다.',
        ErrorSeverity.LOW,
      );
    }

    return this.recognize(payload.request);
  }

  /**
   * 문서 인식을 수행한다.
   *
   * @param request - 문서 인식 입력
   * @returns 인식 결과 또는 오류를 담은 모듈 출력
   */
  async recognize(request: DocumentRecognizerInput): Promise<ModuleOutput> {
    const validator = this.validator!;
    const startedAt = Date.now();

    // 1) OCR 텍스트 추출 (120초 타임아웃 적용, 요구사항 1.9)
    let ocrResult: OcrResult;
    try {
      ocrResult = await this.runWithTimeout(
        this.ocrProvider!.extractText({
          documentId: request.documentId,
          s3Key: request.s3Key,
          mimeType: request.mimeType,
        }),
        this.timeoutMs,
      );
    } catch (error) {
      // 타임아웃 → 시간 초과 오류 + 재시도 옵션 (중간 결과 미저장)
      if (this.isTimeoutError(error)) {
        const failure = validator.buildTimeoutFailure(Date.now() - startedAt);
        return this.failureOutput(failure);
      }
      // 그 외 추출 실패는 파일 손상으로 간주 → 재업로드 옵션 (부분 결과 미저장)
      const detail = error instanceof Error ? error.message : String(error);
      const failure = validator.buildCorruptedFileFailure(detail);
      return this.failureOutput(failure);
    }

    // 2) 인식 텍스트 최소 길이 검증 (20자 미만 → failed, 요구사항 1.10)
    const validation = validator.validateRecognizedText(ocrResult.text);
    if (!validation.valid) {
      return this.failureOutput(validation);
    }

    // 3) 조항 단위 분할 (최대 1000개, 위치 정보 부여, 요구사항 1.4)
    const clauses = this.clauseSplitter!.split(ocrResult.text);

    // 4) Textract 좌표 존재 여부 판정 (요구사항 1.11 연동)
    const hasCoordinates = Array.isArray(ocrResult.blocks) && ocrResult.blocks.length > 0;

    const output: DocumentRecognizerOutput = {
      documentId: request.documentId,
      fullText: ocrResult.text,
      clauses,
      hasCoordinates,
      recognitionStatus: 'success',
      processingTimeMs: Date.now() - startedAt,
    };

    // 5) 인식 결과를 S3에 저장 (성공 시에만 저장, 요구사항 1.4)
    if (this.persistToS3) {
      try {
        await this.s3Store!.saveRecognizedText(request.documentId, {
          fullText: output.fullText,
          clauses: output.clauses,
          recognitionStatus: output.recognitionStatus,
        });
      } catch (error) {
        // 저장 실패는 높은 심각도 오류로 반환한다.
        const detail = error instanceof Error ? error.message : String(error);
        return this.errorOutput(
          'RECOGNIZED_TEXT_SAVE_FAILED',
          '인식 결과 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.',
          ErrorSeverity.HIGH,
          { detail },
        );
      }
    }

    return { success: true, data: output };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { reason: 'Module not initialized' },
      };
    }

    return {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
      details: { initialized: true, service: 'document-recognizer', timeoutMs: this.timeoutMs },
    };
  }

  getName(): string {
    return 'document-recognizer';
  }

  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 프로미스에 타임아웃을 적용한다.
   *
   * 지정 시간 내에 완료되지 않으면 타임아웃 오류를 던진다.
   *
   * @param promise - 대상 프로미스
   * @param timeoutMs - 제한 시간(밀리초)
   * @returns 프로미스 결과
   * @throws 타임아웃 시 name='TimeoutError' 오류
   */
  private runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`문서 인식 처리가 ${timeoutMs}ms를 초과했습니다.`);
        err.name = 'TimeoutError';
        reject(err);
      }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }) as Promise<T>;
  }

  /**
   * 오류가 타임아웃 오류인지 판별한다.
   *
   * @param error - 오류 객체
   * @returns 타임아웃 오류 여부
   */
  private isTimeoutError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'TimeoutError'
    );
  }

  /**
   * 검증 실패 결과를 표준 모듈 출력으로 변환한다.
   *
   * @param failure - 검증 실패 결과 (오류 응답 + 복구 옵션)
   * @returns 실패 모듈 출력
   */
  private failureOutput(failure: RecognitionValidationFailure): ModuleOutput {
    return {
      success: false,
      errors: [failure.error],
      metadata: {
        recognitionStatus: failure.recognitionStatus,
        recoveryOptions: failure.recoveryOptions.join(','),
      },
    };
  }

  /**
   * 단일 오류를 담은 표준 모듈 출력을 생성한다.
   *
   * @param code - 오류 코드
   * @param message - 사용자 대면 한국어 메시지
   * @param severity - 오류 심각도
   * @param context - 추가 컨텍스트 (옵션)
   * @returns 실패 모듈 출력
   */
  private errorOutput(
    code: string,
    message: string,
    severity: ErrorSeverity,
    context?: Record<string, unknown>,
  ): ModuleOutput {
    return {
      success: false,
      errors: [
        {
          code,
          message,
          severity,
          timestamp: new Date().toISOString(),
          ...(context ? { context } : {}),
        },
      ],
    };
  }
}

// 하위 모듈 re-export
export { ClauseSplitter, MAX_CLAUSES } from './clause-splitter.js';
export type { ClauseSplitterConfig } from './clause-splitter.js';
export {
  RecognitionValidator,
  RECOGNITION_TIMEOUT_MS,
  MIN_RECOGNIZED_TEXT_LENGTH,
} from './recognition-validator.js';
export type {
  RecognitionStatus,
  RecoveryOption,
  RecognitionValidationResult,
  RecognitionValidationFailure,
  RecognitionValidationSuccess,
} from './recognition-validator.js';
