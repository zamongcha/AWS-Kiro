/**
 * 룰셋 로더 (RuleSetLoader)
 *
 * 계약 유형별 독소조항 룰셋을 룰셋_저장소에서 로드하는 책임을 담당한다.
 * 요구사항 2.8/2.9에 따라 룰셋 로드는 반드시 5초 이내에 완료되어야 하며,
 * 로드가 실패하거나 5초를 초과하면 분석을 진행하지 않고 로드 실패를 나타내는
 * 오류 상태를 반환하고 사용자에게 재시도를 요청한다.
 *
 * 로드 소스 우선순위:
 *   1. S3 config(`contract-data/config/toxic-rules/{contractType}.json`)
 *      — 계약 유형별 전체 룰셋을 담은 구조화 JSON (기본 소스)
 *   2. OpenSearch(`contract-toxic-rules` 인덱스) — 주입된 조회 함수가 있을 때 폴백
 *
 * S3 config는 계약 유형별 룰 전체 목록을 단일 객체로 보관하므로 "룰셋 로드"의
 * 기본 소스로 사용한다. OpenSearch 인덱스는 kNN 유사도 검색 용도이므로,
 * 계약 유형 단위의 전체 룰셋 조회가 필요한 경우 호출자가 조회 함수
 * (`openSearchFetcher`)를 주입해 폴백으로 활용할 수 있다.
 *
 * S3 config 조회가 실패하거나 결과가 비어 있으면 OpenSearch 폴백을 시도하고,
 * 두 소스 모두 실패하면 로드 실패 오류 상태를 반환한다. 전체 로드 시간은
 * 소스와 무관하게 단일 5초 타임아웃으로 통제한다.
 *
 * @module RuleSetLoader
 * @requirements 2.8, 2.9
 */

import type { ContractType } from '../interfaces/index.js';
import {
  ErrorSeverity,
  type ErrorResponse,
} from '../../../common/interfaces/service-module.js';
import type { ToxicRuleDocument } from '../storage/opensearch-store.js';
import {
  ContractS3KeyBuilder,
  type ContractS3Store,
} from '../storage/s3-store.js';

/** 룰셋 로드 기본 타임아웃 (밀리초). 요구사항 2.8: 5초 이내 로드 */
export const RULESET_LOAD_TIMEOUT_MS = 5000;

/** 룰셋 로드 실패 오류 코드 */
export const RULESET_LOAD_ERROR_CODE = 'RULESET_LOAD_FAILED';

/** 룰셋 로드 타임아웃 오류 코드 */
export const RULESET_LOAD_TIMEOUT_CODE = 'RULESET_LOAD_TIMEOUT';

/** 룰셋 로드에 사용된 소스 */
export type RuleSetSource = 'opensearch' | 's3-config';

/**
 * OpenSearch 룰셋 폴백 조회 함수
 *
 * 계약 유형에 대응하는 독소조항 룰셋 문서를 OpenSearch에서 조회한다.
 * `ContractOpenSearchStore`가 계약 유형 단위의 전체 룰셋 term 조회를 노출하지
 * 않으므로, 필요 시 호출자가 이 함수를 주입하여 폴백 경로를 구성한다.
 *
 * @param contractType - 계약 유형
 * @returns 독소조항 룰셋 문서 배열
 */
export type OpenSearchRuleFetcher = (
  contractType: ContractType,
) => Promise<ToxicRuleDocument[]>;

/**
 * 단일 독소조항 룰
 *
 * OpenSearch 문서(`ToxicRuleDocument`)와 S3 config JSON 양쪽에서 공통으로
 * 표현되는 룰의 정규화 형태이다. 위험조항 탐지기가 룰셋 매칭에 사용한다.
 */
export interface ToxicRule {
  /** 룰 식별자 */
  ruleId: string;
  /** 계약 유형 */
  contractType: ContractType;
  /** 룰 분류 (선택) */
  ruleCategory?: string;
  /** 독소조항 패턴 텍스트 */
  patternText: string;
  /** 위험 유형 */
  riskType: string;
  /** 위험 사유 */
  riskReason: string;
  /** 필수 특약 여부 */
  isRequiredClause?: boolean;
  /** 근거 법조항/판례 */
  legalBasis?: string[];
}

/**
 * 룰셋 로드 성공 결과
 */
export interface RuleSetLoadSuccess {
  /** 로드 성공 여부 (true) */
  success: true;
  /** 계약 유형 */
  contractType: ContractType;
  /** 로드된 독소조항 룰 목록 */
  rules: ToxicRule[];
  /** 로드에 사용된 소스 */
  source: RuleSetSource;
  /** 룰셋 버전 (메타데이터에서 확인 가능한 경우) */
  version?: number;
  /** 로드 소요 시간 (밀리초) */
  loadTimeMs: number;
}

/**
 * 룰셋 로드 실패 결과
 *
 * 로드 실패 또는 5초 초과 시 반환된다. 분석을 진행하지 않고 재시도를
 * 요청하는 표준 오류 응답을 담는다.
 */
export interface RuleSetLoadFailure {
  /** 로드 성공 여부 (false) */
  success: false;
  /** 계약 유형 */
  contractType: ContractType;
  /** 표준 오류 응답 */
  error: ErrorResponse;
  /** 사용자에게 재시도를 요청해야 함을 나타내는 플래그 */
  retryRequested: true;
  /** 로드 소요 시간 (밀리초) */
  loadTimeMs: number;
}

/**
 * 룰셋 로드 결과 (성공 또는 실패)
 */
export type RuleSetLoadResult = RuleSetLoadSuccess | RuleSetLoadFailure;

/**
 * S3 config에 저장되는 룰셋 JSON 페이로드 형태
 *
 * `contract-data/config/toxic-rules/{contractType}.json` 파일 구조.
 * 배열 형태(룰 목록만) 또는 메타데이터를 포함한 객체 형태를 모두 허용한다.
 */
interface S3RuleSetPayload {
  /** 룰셋 버전 (선택) */
  version?: number;
  /** 룰 목록 */
  rules: Array<{
    ruleId?: string;
    rule_id?: string;
    ruleCategory?: string;
    rule_category?: string;
    patternText?: string;
    pattern_text?: string;
    riskType?: string;
    risk_type?: string;
    riskReason?: string;
    risk_reason?: string;
    isRequiredClause?: boolean;
    is_required_clause?: boolean;
    legalBasis?: string[];
    legal_basis?: string[];
  }>;
}

/**
 * 룰셋 로더 설정
 */
export interface RuleSetLoaderConfig {
  /** S3 config 저장소 (기본 소스) */
  s3Store: ContractS3Store;
  /** OpenSearch 룰셋 폴백 조회 함수 (선택) */
  openSearchFetcher?: OpenSearchRuleFetcher;
  /** 로드 타임아웃 (밀리초, 기본 5000) */
  timeoutMs?: number;
  /** 조회할 최대 룰 개수 (기본 500) */
  maxRules?: number;
}

/**
 * 룰셋 로더
 *
 * 계약 유형별 독소조항 룰셋을 S3 config → OpenSearch 순서로 로드하며,
 * 전체 로드를 단일 5초 타임아웃으로 통제한다. 성공 시 정규화된 룰 목록을,
 * 실패/타임아웃 시 재시도 요청 플래그가 포함된 표준 오류 결과를 반환한다.
 *
 * @requirements 2.8, 2.9
 */
export class RuleSetLoader {
  private readonly s3Store: ContractS3Store;
  private readonly openSearchFetcher?: OpenSearchRuleFetcher;
  private readonly timeoutMs: number;
  private readonly maxRules: number;

  constructor(config: RuleSetLoaderConfig) {
    this.s3Store = config.s3Store;
    if (config.openSearchFetcher !== undefined) {
      this.openSearchFetcher = config.openSearchFetcher;
    }
    this.timeoutMs = config.timeoutMs ?? RULESET_LOAD_TIMEOUT_MS;
    this.maxRules = config.maxRules ?? 500;
  }

  /**
   * 계약 유형별 독소조항 룰셋을 5초 이내에 로드한다.
   *
   * OpenSearch 조회를 우선 시도하고, 실패하거나 결과가 비어 있으면 S3 config
   * 폴백을 시도한다. 전체 로드가 설정된 타임아웃(기본 5초)을 초과하면
   * 타임아웃 오류 상태를 반환한다. 어떤 실패에서도 입력 데이터를 변경하지
   * 않으며, 실패 결과에는 항상 재시도 요청 플래그가 포함된다.
   *
   * @param contractType - 계약 유형
   * @returns 로드 성공 또는 실패(재시도 요청 포함) 결과
   *
   * @requirements 2.8, 2.9
   */
  async load(contractType: ContractType): Promise<RuleSetLoadResult> {
    const startedAt = Date.now();

    try {
      const result = await this.withTimeout(
        this.loadFromSources(contractType),
        this.timeoutMs,
      );
      return {
        success: true,
        contractType,
        rules: result.rules,
        source: result.source,
        ...(result.version !== undefined ? { version: result.version } : {}),
        loadTimeMs: Date.now() - startedAt,
      };
    } catch (error) {
      const loadTimeMs = Date.now() - startedAt;
      const isTimeout = error instanceof RuleSetTimeoutError;
      return {
        success: false,
        contractType,
        error: this.buildError(contractType, error, isTimeout),
        retryRequested: true,
        loadTimeMs,
      };
    }
  }

  /**
   * 우선순위(S3 config → OpenSearch)에 따라 룰셋을 로드한다.
   *
   * S3 config 조회 결과가 존재하면 그대로 사용하고, 조회가 오류로 실패하거나
   * 결과가 비어 있으면 OpenSearch 폴백(주입된 경우)을 시도한다. 두 소스 모두
   * 유효한 룰을 반환하지 못하면 오류를 던진다.
   *
   * @param contractType - 계약 유형
   * @returns 정규화된 룰 목록과 로드 소스
   */
  private async loadFromSources(
    contractType: ContractType,
  ): Promise<{ rules: ToxicRule[]; source: RuleSetSource; version?: number }> {
    let s3Error: unknown;

    // 1순위: S3 config 룰셋 JSON
    try {
      const payload = await this.loadFromS3Config(contractType);
      if (payload && payload.rules.length > 0) {
        return {
          rules: payload.rules.map((rule) => this.normalizeFromS3(rule, contractType)),
          source: 's3-config',
          ...(payload.version !== undefined ? { version: payload.version } : {}),
        };
      }
    } catch (error) {
      // S3 조회 실패는 폴백 시도 후에도 실패할 경우에만 표면화한다.
      s3Error = error;
    }

    // 2순위: OpenSearch 룰셋 인덱스 (폴백 조회 함수가 주입된 경우에만)
    if (this.openSearchFetcher) {
      try {
        const documents = await this.openSearchFetcher(contractType);
        if (documents.length > 0) {
          return {
            rules: documents
              .slice(0, this.maxRules)
              .map((doc) => this.normalizeFromDocument(doc, contractType)),
            source: 'opensearch',
          };
        }
      } catch (error) {
        // OpenSearch 폴백까지 실패하면 원인을 종합하여 오류를 던진다.
        throw this.aggregateSourceError(s3Error, error);
      }
    }

    // 두 소스 모두 유효한 룰을 반환하지 못한 경우
    throw this.aggregateSourceError(
      s3Error,
      new Error(`계약 유형(${contractType})에 대한 독소조항 룰셋을 찾을 수 없습니다.`),
    );
  }

  /**
   * S3 config에서 룰셋 JSON을 로드한다.
   *
   * `contract-data/config/toxic-rules/{contractType}.json` 객체를 조회하여
   * 파싱한다. 배열 형태(룰 목록만) 또는 `{ version, rules }` 객체 형태를 모두
   * 허용한다.
   *
   * @param contractType - 계약 유형
   * @returns 파싱된 S3 룰셋 페이로드 또는 null (미존재/빈 값)
   */
  private async loadFromS3Config(
    contractType: ContractType,
  ): Promise<S3RuleSetPayload | null> {
    const key = ContractS3KeyBuilder.config('toxic-rules', contractType);
    const bytes = await this.s3Store.getOriginal(key);
    if (!bytes || bytes.length === 0) {
      return null;
    }

    const text = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(text) as unknown;

    if (Array.isArray(parsed)) {
      return { rules: parsed as S3RuleSetPayload['rules'] };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as S3RuleSetPayload).rules)) {
      return parsed as S3RuleSetPayload;
    }
    return null;
  }

  /**
   * OpenSearch 룰셋 문서를 정규화된 룰로 변환한다.
   *
   * @param doc - OpenSearch 독소조항 룰셋 문서
   * @param contractType - 계약 유형 (문서에 유형이 없을 때 기본값)
   * @returns 정규화된 룰
   */
  private normalizeFromDocument(
    doc: ToxicRuleDocument,
    contractType: ContractType,
  ): ToxicRule {
    return {
      ruleId: doc.rule_id,
      contractType: doc.contract_type ?? contractType,
      ...(doc.rule_category !== undefined ? { ruleCategory: doc.rule_category } : {}),
      patternText: doc.pattern_text,
      riskType: doc.risk_type,
      riskReason: doc.risk_reason,
      ...(doc.is_required_clause !== undefined
        ? { isRequiredClause: doc.is_required_clause }
        : {}),
      ...(doc.legal_basis !== undefined ? { legalBasis: doc.legal_basis } : {}),
    };
  }

  /**
   * S3 config 룰 항목을 정규화된 룰로 변환한다.
   *
   * camelCase/snake_case 키를 모두 허용하여 유연하게 매핑한다.
   *
   * @param rule - S3 config 룰 항목
   * @param contractType - 계약 유형
   * @returns 정규화된 룰
   */
  private normalizeFromS3(
    rule: S3RuleSetPayload['rules'][number],
    contractType: ContractType,
  ): ToxicRule {
    const ruleCategory = rule.ruleCategory ?? rule.rule_category;
    const isRequiredClause = rule.isRequiredClause ?? rule.is_required_clause;
    const legalBasis = rule.legalBasis ?? rule.legal_basis;
    return {
      ruleId: rule.ruleId ?? rule.rule_id ?? '',
      contractType,
      ...(ruleCategory !== undefined ? { ruleCategory } : {}),
      patternText: rule.patternText ?? rule.pattern_text ?? '',
      riskType: rule.riskType ?? rule.risk_type ?? '',
      riskReason: rule.riskReason ?? rule.risk_reason ?? '',
      ...(isRequiredClause !== undefined ? { isRequiredClause } : {}),
      ...(legalBasis !== undefined ? { legalBasis } : {}),
    };
  }

  /**
   * 주어진 Promise가 타임아웃 내에 완료되지 않으면 타임아웃 오류를 던진다.
   *
   * 타임아웃 초과 시 `RuleSetTimeoutError`를 던져 5초 초과 상황을 명확히
   * 구분한다. 타이머는 성공/실패 여부와 무관하게 항상 정리된다.
   *
   * @param promise - 감싸질 작업 Promise
   * @param timeoutMs - 타임아웃 (밀리초)
   * @returns 작업 결과
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new RuleSetTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
    }) as Promise<T>;
  }

  /**
   * S3/OpenSearch 실패 원인을 종합한 오류를 생성한다.
   *
   * @param s3Error - S3 config 조회 오류 (있는 경우)
   * @param openSearchError - OpenSearch 폴백 조회 오류
   * @returns 종합된 오류
   */
  private aggregateSourceError(s3Error: unknown, openSearchError: unknown): Error {
    const parts: string[] = [];
    if (s3Error !== undefined) {
      parts.push(`S3 config: ${this.describeError(s3Error)}`);
    }
    parts.push(`OpenSearch: ${this.describeError(openSearchError)}`);
    return new Error(parts.join(' | '));
  }

  /**
   * 오류 객체를 사람이 읽을 수 있는 문자열로 변환한다.
   *
   * @param error - 오류 값
   * @returns 오류 설명 문자열
   */
  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * 로드 실패/타임아웃 상황을 표준 오류 응답으로 변환한다.
   *
   * 로드 실패는 외부 의존성 실패이므로 심각도 HIGH로 분류한다(설계 문서의
   * 오류 심각도 매트릭스 기준). 사용자 대면 메시지는 존댓말 한국어로 제공하며,
   * 컨텍스트에 계약 유형·재시도 요청 여부·원인을 담는다.
   *
   * @param contractType - 계약 유형
   * @param error - 원인 오류
   * @param isTimeout - 타임아웃 여부
   * @returns 표준 오류 응답
   */
  private buildError(
    contractType: ContractType,
    error: unknown,
    isTimeout: boolean,
  ): ErrorResponse {
    return {
      code: isTimeout ? RULESET_LOAD_TIMEOUT_CODE : RULESET_LOAD_ERROR_CODE,
      message: '분석 준비 중 오류가 발생했습니다. 다시 시도해 주세요.',
      severity: ErrorSeverity.HIGH,
      timestamp: new Date().toISOString(),
      context: {
        contractType,
        retryRequested: true,
        reason: isTimeout
          ? `룰셋 로드가 ${this.timeoutMs}ms 이내에 완료되지 않았습니다.`
          : this.describeError(error),
      },
    };
  }
}

/**
 * 룰셋 로드 타임아웃 오류
 *
 * 룰셋 로드가 설정된 타임아웃(기본 5초)을 초과했음을 나타내는 전용 오류 타입.
 */
export class RuleSetTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`룰셋 로드가 ${timeoutMs}ms 타임아웃을 초과했습니다.`);
    this.name = 'RuleSetTimeoutError';
  }
}
