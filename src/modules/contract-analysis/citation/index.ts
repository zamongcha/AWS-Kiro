/**
 * 인용 표시기 모듈 (CitationModule)
 *
 * 각 위험 조항에 대해 근거 법조항(법령명·조항번호)·판례를 각주 형태로
 * 표시하는 표준 `ServiceModule` 구현체이다. 실제 각주 부여 로직은
 * `FootnoteFormatter`에 위임하며, 본 모듈은 입력 검증·오류 표준화·헬스체크
 * 등 모듈 계약을 담당한다.
 *
 * 주요 규칙:
 *   - Property 23: 조항당 각주 수 ≤ 5, 본문 각주 번호 [N]은 등장 순서대로
 *     1부터 연속 부여되며 하단 근거 목록의 N번째 항목과 1:1 대응.
 *   - 근거 미발견 조항은 noBasisFound=true 로 표시하고, 나머지 조항의
 *     각주는 계속 제공한다(요구사항 7.6).
 *
 * @module CitationModule
 * @requirements 7.1, 7.2, 7.6
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
  CitationInput,
  CitationOutput,
} from '../interfaces/citation.js';
import { FootnoteFormatter } from './footnote-formatter.js';

/** 인용 표시기 입력 판별자 */
export const CITATION_INPUT_TYPE = 'citation.annotate';

/** 입력 스키마 불일치 오류 코드 */
export const CITATION_INVALID_INPUT_CODE = 'CITATION_INVALID_INPUT';

/** 각주 부여 실패 오류 코드 */
export const CITATION_ERROR_CODE = 'CITATION_FAILED';

/**
 * 인용 표시기 모듈 설정
 */
export interface CitationModuleConfig {
  /** 각주 포맷터 (선택, 기본 인스턴스 생성) */
  footnoteFormatter?: FootnoteFormatter;
}

/**
 * 인용 표시기 모듈
 *
 * @requirements 7.1, 7.2, 7.6
 */
export class CitationModule implements ServiceModule {
  private readonly formatter: FootnoteFormatter;

  constructor(config: CitationModuleConfig = {}) {
    this.formatter = config.footnoteFormatter ?? new FootnoteFormatter();
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
   * 입력 페이로드를 검증한 뒤 각 위험 조항에 각주를 부여하고, 결과를
   * `ModuleOutput`으로 감싸 반환한다. 스키마 불일치는 스키마 오류로,
   * 처리 실패는 처리 오류로 표준화한다.
   *
   * @param input - 모듈 입력 (payload: CitationInput)
   * @returns 모듈 출력
   *
   * @requirements 7.1, 7.2, 7.6
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateModuleInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const output = this.formatter.format(validation.payload);
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildProcessingError(error)] };
    }
  }

  /**
   * 위험 조항 목록에 각주를 직접 부여한다(모듈 래핑 없이).
   *
   * 다른 컴포넌트(오케스트레이터 등)가 결과 객체를 직접 사용할 수 있도록
   * 제공하는 편의 메서드이다.
   *
   * @param input - 인용 표시기 입력
   * @returns 인용 표시기 출력
   *
   * @requirements 7.1, 7.2, 7.6
   */
  annotate(input: CitationInput): CitationOutput {
    return this.formatter.format(input);
  }

  /**
   * 모듈 입력을 검증한다.
   *
   * 입력 유형 판별자와 페이로드 존재 여부, 필수 필드 형식을 확인한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateModuleInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: CitationInput }
    | { valid: false; error: ErrorResponse } {
    if (input.type !== CITATION_INPUT_TYPE) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error(`알 수 없는 입력 유형입니다: ${input.type}`),
        ),
      };
    }
    const payload = input.payload as CitationInput | undefined;
    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error('페이로드가 비어있습니다.'),
        ),
      };
    }
    if (!Array.isArray(payload.riskClauses)) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error('riskClauses 는 배열이어야 합니다.'),
        ),
      };
    }
    if (
      !payload.legalReferences ||
      typeof payload.legalReferences !== 'object'
    ) {
      return {
        valid: false,
        error: this.buildInvalidInputError(
          new Error('legalReferences 는 객체여야 합니다.'),
        ),
      };
    }
    return { valid: true, payload };
  }

  /**
   * 스키마 불일치 표준 오류 응답을 만든다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildInvalidInputError(error: unknown): ErrorResponse {
    return {
      code: CITATION_INVALID_INPUT_CODE,
      message: '인용 표시 요청 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
      severity: ErrorSeverity.MEDIUM,
      timestamp: new Date().toISOString(),
      context: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 각주 부여 실패 표준 오류 응답을 만든다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildProcessingError(error: unknown): ErrorResponse {
    return {
      code: CITATION_ERROR_CODE,
      message: '근거 각주 부여 중 오류가 발생했습니다. 다시 시도해 주세요.',
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
   * 외부 의존성이 없으므로 정상 상태를 즉시 반환한다.
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
    return 'citation';
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
  FootnoteFormatter,
  MAX_FOOTNOTES_PER_CLAUSE,
} from './footnote-formatter.js';
