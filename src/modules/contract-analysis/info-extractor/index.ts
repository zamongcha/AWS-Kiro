/**
 * 정보 추출기 모듈 (InfoExtractorModule)
 *
 * 계약서 전체 인식 텍스트에서 보증금·월세·매매가·관리비·계약기간·당사자·
 * 소재지·면적을 구조화 추출하는 표준 `ServiceModule` 구현체이다. 실제 필드
 * 추출은 `FieldExtractor`에 위임한다.
 *
 * 주요 규칙:
 *   - Property 26: 금액 필드 단위 'KRW', 면적 'sqm', 계약 기간 'month'
 *   - Property 27: 확인 불가 항목은 isConfirmable=false로 표시하고 나머지 항목
 *     추출을 계속 진행
 *
 * 추출 상태(extractionStatus)는 확인 가능한 필드 수에 따라 결정된다.
 *   - 모든 필드 확인 가능: 'success'
 *   - 일부 필드만 확인 가능: 'partial'
 *   - 확인 가능한 필드 없음: 'failed'
 *
 * 추출 처리 중 예외가 발생하면 표준 `ErrorResponse`를 반환한다(요구사항 9.6).
 *
 * @module InfoExtractorModule
 * @requirements 9.1, 9.2, 9.4, 9.6
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
  ExtractedField,
  InfoExtractorInput,
  InfoExtractorOutput,
} from '../interfaces/index.js';
import { FieldExtractor } from './field-extractor.js';

/** 정보 추출기 입력 판별자 */
export const INFO_EXTRACTOR_INPUT_TYPE = 'info-extractor.extract';

/** 입력 스키마 불일치 오류 코드 */
export const INFO_EXTRACTION_INVALID_INPUT_CODE = 'INFO_EXTRACTION_INVALID_INPUT';

/** 추출 처리 실패 오류 코드 (요구사항 9.6) */
export const INFO_EXTRACTION_FAILED_CODE = 'INFO_EXTRACTION_FAILED';

/**
 * 정보 추출기 모듈 설정
 */
export interface InfoExtractorModuleConfig {
  /** 필드 추출기 (선택, 기본 인스턴스 생성) */
  fieldExtractor?: FieldExtractor;
}

/**
 * 정보 추출기 모듈
 *
 * @requirements 9.1, 9.2, 9.4, 9.6
 */
export class InfoExtractorModule implements ServiceModule {
  private readonly fieldExtractor: FieldExtractor;

  constructor(config: InfoExtractorModuleConfig = {}) {
    this.fieldExtractor = config.fieldExtractor ?? new FieldExtractor();
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
   * 입력 페이로드를 검증한 뒤 정보 추출을 수행하고 결과를 `ModuleOutput`으로
   * 감싸 반환한다. 추출 처리 실패 시 표준 `ErrorResponse`를 담은 실패 출력을
   * 반환한다(요구사항 9.6).
   *
   * @param input - 모듈 입력 (payload: InfoExtractorInput)
   * @returns 모듈 출력
   *
   * @requirements 9.1, 9.6
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const output = this.extract(validation.payload);
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildError(error)] };
    }
  }

  /**
   * 정보 추출 핵심 로직.
   *
   * 전체 텍스트에서 8개 핵심 필드를 추출하고, 확인 가능한 필드 수에 따라
   * 추출 상태를 산출한다. 확인 불가 항목은 결과에 포함되며 나머지 항목
   * 추출은 정상적으로 진행된다(Property 27).
   *
   * @param input - 정보 추출기 입력
   * @returns 정보 추출 결과
   *
   * @requirements 9.1, 9.4
   */
  extract(input: InfoExtractorInput): InfoExtractorOutput {
    const extractedFields = this.fieldExtractor.extract(input.fullText);
    return {
      extractedFields,
      extractionStatus: this.resolveStatus(extractedFields),
    };
  }

  /**
   * 확인 가능한 필드 수를 기준으로 추출 상태를 결정한다.
   *
   * @param fields - 추출된 필드 목록
   * @returns 추출 상태 ('success' | 'partial' | 'failed')
   */
  private resolveStatus(fields: ExtractedField[]): InfoExtractorOutput['extractionStatus'] {
    const confirmableCount = fields.filter((field) => field.isConfirmable).length;
    if (confirmableCount === fields.length && fields.length > 0) {
      return 'success';
    }
    if (confirmableCount === 0) {
      return 'failed';
    }
    return 'partial';
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 필수 필드(documentId/fullText/contractType)의 존재 및
   * 타입을 확인한다. 위반 시 표준 오류 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ): { valid: true; payload: InfoExtractorInput } | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: INFO_EXTRACTION_INVALID_INPUT_CODE,
        message: '정보 추출 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== INFO_EXTRACTOR_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<InfoExtractorInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (typeof payload.documentId !== 'string' || payload.documentId.length === 0) {
      return invalid('documentId가 필요합니다.');
    }
    if (typeof payload.fullText !== 'string') {
      return invalid('fullText가 필요합니다.');
    }
    if (typeof payload.contractType !== 'string') {
      return invalid('contractType이 필요합니다.');
    }

    return { valid: true, payload: payload as InfoExtractorInput };
  }

  /**
   * 추출 처리 실패를 표준 오류 응답으로 변환한다(요구사항 9.6).
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildError(error: unknown): ErrorResponse {
    return {
      code: INFO_EXTRACTION_FAILED_CODE,
      message: '계약서 정보를 추출하지 못했습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 모듈 헬스 상태를 반환한다.
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
    return 'info-extractor';
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
  FieldExtractor,
  FIELD_NAMES,
  AMOUNT_UNIT,
  AREA_UNIT,
  PERIOD_UNIT,
} from './field-extractor.js';
