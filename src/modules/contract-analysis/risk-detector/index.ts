/**
 * 위험조항 탐지기 모듈 (RiskDetectorModule)
 *
 * 계약서 조항을 계약 유형별 독소조항 룰셋 및 벡터 유사도와 대조하여 위험
 * 조항을 탐지하고, 계약 유형별 필수 특약 목록과 대조하여 누락된 특약을
 * 식별하는 표준 `ServiceModule` 구현체이다.
 *
 * 처리 흐름:
 *   1. `RuleMatcher`로 각 조항의 위험 여부 판정 (룰셋 매칭 OR 유사도 ≥ 0.75)
 *   2. 위험 조항에 대해 `ClauseSpanBuilder`로 원문 매칭 스팬 생성
 *   3. `MissingClauseChecker`로 누락 필수 특약 식별 (항상 별도 항목 제시)
 *
 * 주요 규칙:
 *   - Property 8: 룰셋 매칭 존재 또는 유사도 0.75 이상이면 위험, 둘 다 아니면 비위험
 *   - Property 9: 위험 조항에 riskType/riskReason/partyImpact/isDisadvantageous 포함
 *   - Property 10: 위험 조항 0건이어도 missingClauses는 항상 결과에 존재
 *   - Property 11: 원문 매칭 길이 절단 규칙 적용 (ClauseSpanBuilder)
 *
 * 룰셋/벡터 저장소 접근 불가 시 탐지를 중단하고 표준 `ErrorResponse`를
 * 반환하며, 입력 데이터는 변경하지 않는다. 조항당 처리는 30초 이내에
 * 완료되도록 조항 단위 타임아웃을 적용한다.
 *
 * @module RiskDetectorModule
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
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
  ContractType,
  PartyPerspective,
  PartyImpact,
  RecognizedClause,
  RiskDetectorInput,
  RiskDetectorOutput,
  RiskClause,
} from '../interfaces/index.js';
import type { ToxicRule } from '../contract-context/ruleset-loader.js';
import { RuleMatcher, type ClauseMatchResult } from './rule-matcher.js';
import { MissingClauseChecker } from './missing-clause-checker.js';
import { ClauseSpanBuilder } from './span-builder.js';

/** 조항당 탐지 타임아웃 (밀리초). 요구사항 3.8: 조항당 30초 이내 */
export const CLAUSE_DETECTION_TIMEOUT_MS = 30_000;

/** 저장소 접근 불가 등 탐지 실패 오류 코드 */
export const RISK_DETECTION_ERROR_CODE = 'RISK_DETECTION_FAILED';

/** 입력 스키마 불일치 오류 코드 */
export const RISK_DETECTION_INVALID_INPUT_CODE = 'RISK_DETECTION_INVALID_INPUT';

/** 조항 탐지 타임아웃 오류 코드 */
export const RISK_DETECTION_TIMEOUT_CODE = 'RISK_DETECTION_TIMEOUT';

/** 위험조항 탐지기 입력 판별자 */
export const RISK_DETECTOR_INPUT_TYPE = 'risk-detector.detect';

/**
 * 위험조항 탐지기 실행 입력 확장
 *
 * 표준 `RiskDetectorInput`에 로드된 룰셋을 함께 전달한다. 룰셋은
 * `RuleSetLoader`(태스크 4.2)가 사전 로드하여 오케스트레이터를 통해 주입한다.
 */
export interface RiskDetectorExecuteInput extends RiskDetectorInput {
  /** 사전 로드된 독소조항 룰 목록 */
  rules: ToxicRule[];
  /** 룰셋 버전 (있는 경우) */
  ruleSetVersion?: number;
}

/**
 * 위험조항 탐지기 모듈 설정
 */
export interface RiskDetectorModuleConfig {
  /** 룰셋 매처 */
  ruleMatcher: RuleMatcher;
  /** 누락 특약 점검기 */
  missingClauseChecker: MissingClauseChecker;
  /** 원문 매칭 스팬 빌더 (선택, 기본 인스턴스 생성) */
  spanBuilder?: ClauseSpanBuilder;
  /** 조항당 타임아웃 (밀리초, 기본 30000) */
  clauseTimeoutMs?: number;
}

/**
 * 위험조항 탐지기 모듈
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
export class RiskDetectorModule implements ServiceModule {
  private readonly ruleMatcher: RuleMatcher;
  private readonly missingClauseChecker: MissingClauseChecker;
  private readonly spanBuilder: ClauseSpanBuilder;
  private readonly clauseTimeoutMs: number;

  constructor(config: RiskDetectorModuleConfig) {
    this.ruleMatcher = config.ruleMatcher;
    this.missingClauseChecker = config.missingClauseChecker;
    this.spanBuilder = config.spanBuilder ?? new ClauseSpanBuilder();
    this.clauseTimeoutMs = config.clauseTimeoutMs ?? CLAUSE_DETECTION_TIMEOUT_MS;
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
   * 입력 페이로드를 검증한 뒤 위험조항 탐지를 수행하고, 결과를
   * `ModuleOutput`으로 감싸 반환한다. 저장소 접근 불가 등 실패 시 표준
   * `ErrorResponse`를 담은 실패 출력을 반환하며 입력을 변경하지 않는다.
   *
   * @param input - 모듈 입력 (payload: RiskDetectorExecuteInput)
   * @returns 모듈 출력
   *
   * @requirements 3.1, 3.7, 3.8
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return { success: false, errors: [validation.error] };
    }

    try {
      const output = await this.detect(validation.payload);
      return { success: true, data: output };
    } catch (error) {
      return { success: false, errors: [this.buildError(error)] };
    }
  }

  /**
   * 위험조항 탐지 핵심 로직.
   *
   * 각 조항을 순회하며 룰셋/벡터 매칭으로 위험 여부를 판정하고, 위험 조항에
   * 대해 원문 매칭 스팬과 관점 기준 유불리 정보를 부여한다. 위험 조항 수와
   * 무관하게 누락 필수 특약 점검을 항상 수행하여 결과에 포함한다.
   *
   * 조항별 매칭은 30초 조항 타임아웃으로 통제되며, 저장소 접근 불가로 인한
   * 오류는 그대로 전파되어 탐지가 중단된다.
   *
   * @param input - 탐지 실행 입력
   * @returns 위험조항 탐지 결과
   *
   * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
   */
  async detect(input: RiskDetectorExecuteInput): Promise<RiskDetectorOutput> {
    const { contractType, perspective, clauses, rules } = input;

    const riskClauses: RiskClause[] = [];
    for (const clause of clauses) {
      const match = await this.withTimeout(
        this.ruleMatcher.matchClause(clause, contractType, rules),
        this.clauseTimeoutMs,
      );
      if (match.isRisk) {
        riskClauses.push(this.toRiskClause(clause, match, contractType, perspective));
      }
    }

    // Property 10: 위험 조항 수와 무관하게 누락 특약 점검을 항상 수행한다.
    const missingClauses = await this.missingClauseChecker.check(
      clauses,
      contractType,
      perspective,
      rules,
    );

    return {
      riskClauses,
      missingClauses,
      totalRiskCount: riskClauses.length,
      ruleSetVersion: input.ruleSetVersion ?? 0,
    };
  }

  /**
   * 조항 매칭 결과를 위험 조항(`RiskClause`)으로 변환한다.
   *
   * riskType/riskReason은 매칭된 룰에서 가져오며, 값이 비어 있으면 기본
   * 안내 문구로 대체하여 항상 비어있지 않도록 보장한다(Property 9). 원문
   * 매칭 스팬은 길이 규칙(Property 11)을 적용하여 생성한다.
   *
   * @param clause - 인식된 조항
   * @param match - 조항 매칭 결과
   * @param contractType - 계약 유형
   * @param perspective - 당사자 관점
   * @returns 위험 조항
   *
   * @requirements 3.2, 3.4, 3.6
   */
  private toRiskClause(
    clause: RecognizedClause,
    match: ClauseMatchResult,
    contractType: ContractType,
    perspective: PartyPerspective,
  ): RiskClause {
    const riskType =
      match.matchedRule?.riskType && match.matchedRule.riskType.trim().length > 0
        ? match.matchedRule.riskType
        : '기타 위험';
    const riskReason =
      match.matchedRule?.riskReason && match.matchedRule.riskReason.trim().length > 0
        ? match.matchedRule.riskReason
        : '해당 조항은 당사자에게 불리하게 작용할 수 있어 검토가 필요합니다.';

    const partyImpact = this.resolvePartyImpact(match, contractType, perspective);

    const spanInput: Parameters<ClauseSpanBuilder['build']>[0] = {
      clauseId: clause.clauseId,
      clauseText: clause.text,
      startOffset: clause.startOffset,
      endOffset: clause.endOffset,
    };
    if (match.matchedRule?.patternText) {
      spanInput.matchedText = match.matchedRule.patternText;
    }
    const span = this.spanBuilder.build(spanInput);

    const riskClause: RiskClause = {
      clauseId: clause.clauseId,
      span,
      riskType,
      riskReason,
      partyImpact,
      matchSource: match.matchSource ?? 'ruleset',
      isDisadvantageous: partyImpact === 'disadvantageous',
    };
    if (match.similarityScore !== undefined) {
      riskClause.similarityScore = match.similarityScore;
    }
    return riskClause;
  }

  /**
   * 매칭 결과로부터 당사자 관점 기준 유불리를 결정한다.
   *
   * 독소조항은 특정 당사자에게 불리한 조항이므로, 매칭된 위험 조항은
   * 선택된 관점 기준 불리(disadvantageous)로 판정한다. 이는 위험 조항
   * 판정과 관점 기준 불리 표시를 일관되게 유지하기 위한 기본 정책이다.
   *
   * @param _match - 조항 매칭 결과 (향후 룰별 관점 매핑 확장 지점)
   * @param _contractType - 계약 유형
   * @param _perspective - 당사자 관점
   * @returns 당사자 관점 기준 유불리
   */
  private resolvePartyImpact(
    _match: ClauseMatchResult,
    _contractType: ContractType,
    _perspective: PartyPerspective,
  ): PartyImpact {
    return 'disadvantageous';
  }

  /**
   * 실행 입력을 검증한다.
   *
   * 입력 유형 판별자와 필수 필드(documentId/contractType/perspective/clauses/rules)의
   * 존재 및 타입을 확인한다. 위반 시 표준 오류 응답을 담은 실패 결과를 반환한다.
   *
   * @param input - 모듈 입력
   * @returns 검증 결과 (성공 시 페이로드 포함)
   */
  private validateInput(
    input: ModuleInput,
  ):
    | { valid: true; payload: RiskDetectorExecuteInput }
    | { valid: false; error: ErrorResponse } {
    const invalid = (reason: string): { valid: false; error: ErrorResponse } => ({
      valid: false,
      error: {
        code: RISK_DETECTION_INVALID_INPUT_CODE,
        message: '위험조항 탐지 입력 형식이 올바르지 않습니다. 입력을 확인해 주세요.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
        context: { reason },
      },
    });

    if (input.type !== RISK_DETECTOR_INPUT_TYPE) {
      return invalid(`알 수 없는 입력 유형입니다: ${input.type}`);
    }
    const payload = input.payload as Partial<RiskDetectorExecuteInput> | undefined;
    if (!payload || typeof payload !== 'object') {
      return invalid('페이로드가 비어있습니다.');
    }
    if (typeof payload.documentId !== 'string' || payload.documentId.length === 0) {
      return invalid('documentId가 필요합니다.');
    }
    if (typeof payload.contractType !== 'string') {
      return invalid('contractType이 필요합니다.');
    }
    if (typeof payload.perspective !== 'string') {
      return invalid('perspective가 필요합니다.');
    }
    if (!Array.isArray(payload.clauses)) {
      return invalid('clauses 배열이 필요합니다.');
    }
    if (!Array.isArray(payload.rules)) {
      return invalid('rules 배열이 필요합니다.');
    }

    return { valid: true, payload: payload as RiskDetectorExecuteInput };
  }

  /**
   * 저장소 접근 불가/타임아웃 등 탐지 실패를 표준 오류 응답으로 변환한다.
   *
   * 벡터 저장소·임베딩 등 외부 의존성 실패는 심각도 HIGH로 분류하고, 조항
   * 타임아웃은 별도 코드로 구분한다. 어떤 경우에도 입력 데이터는 변경되지
   * 않는다.
   *
   * @param error - 원인 오류
   * @returns 표준 오류 응답
   */
  private buildError(error: unknown): ErrorResponse {
    const isTimeout = error instanceof ClauseDetectionTimeoutError;
    return {
      code: isTimeout ? RISK_DETECTION_TIMEOUT_CODE : RISK_DETECTION_ERROR_CODE,
      message: isTimeout
        ? '위험조항 분석이 지연되어 완료하지 못했습니다. 다시 시도해 주세요.'
        : '위험조항 분석 중 오류가 발생했습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        retryRequested: true,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 주어진 Promise가 타임아웃 내에 완료되지 않으면 타임아웃 오류를 던진다.
   *
   * 타이머는 성공/실패와 무관하게 항상 정리된다.
   *
   * @param promise - 감싸질 작업 Promise
   * @param timeoutMs - 타임아웃 (밀리초)
   * @returns 작업 결과
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ClauseDetectionTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
    }) as Promise<T>;
  }

  /**
   * 모듈 헬스 상태를 반환한다.
   *
   * 위험조항 탐지기는 외부 저장소 상태를 별도로 폴링하지 않으므로 정상
   * 상태를 즉시 반환한다.
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
    return 'risk-detector';
  }

  /**
   * 모듈 버전을 반환한다.
   */
  getVersion(): string {
    return '1.0.0';
  }
}

/**
 * 조항 탐지 타임아웃 오류
 *
 * 단일 조항 탐지가 설정된 타임아웃(기본 30초)을 초과했음을 나타낸다.
 */
export class ClauseDetectionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`위험조항 탐지가 ${timeoutMs}ms 타임아웃을 초과했습니다.`);
    this.name = 'ClauseDetectionTimeoutError';
  }
}

// 하위 모듈 re-export
export { RuleMatcher, RISK_SIMILARITY_THRESHOLD } from './rule-matcher.js';
export type { ClauseMatchResult, RuleMatcherConfig } from './rule-matcher.js';
export { MissingClauseChecker } from './missing-clause-checker.js';
export type {
  MissingClauseCheckerConfig,
  RequiredClauseDefinition,
} from './missing-clause-checker.js';
export {
  ClauseSpanBuilder,
  MIN_MATCH_LENGTH,
  MAX_MATCH_LENGTH,
} from './span-builder.js';
export type { SpanBuildInput } from './span-builder.js';
