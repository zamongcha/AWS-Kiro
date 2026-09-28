/**
 * @fileoverview 계약서 분석 관리(admin) 데이터 적재 파이프라인
 * @description 관리자가 계약 유형별 독소조항 룰셋과 표준계약서를 갱신할 때,
 * 각 패턴/조항을 임베딩 벡터로 변환하여 OpenSearch 전용 인덱스에 적재하고,
 * 갱신 시각(UTC)·단조 증가 버전 번호를 DynamoDB 메타데이터로 관리한다.
 *
 * 핵심 동작:
 * - 개별 패턴 임베딩/적재 실패 시 실패 항목을 기록하고 나머지 적재를 계속 진행하며,
 *   실패 항목이 존재하면 SNS로 관리자에게 알림을 전송한다. (Property 36)
 * - 새로운 버전 번호는 이전 버전보다 항상 큰 값(단조 증가)이며 각 버전은 UTC
 *   타임스탬프 메타데이터를 갖는다. (Property 37)
 * - 룰셋/표준계약서 로드 실패 시 마지막으로 정상 로드된 버전으로 폴백하고
 *   관리자에게 로드 실패 알림을 전송한다.
 *
 * 기존 세무 수집기(`src/modules/tax-advisor/*`)의 `SnsNotifier` 추상화 패턴을
 * 재사용하여, 실제 SNS 클라이언트를 주입 가능하도록 인터페이스로 분리한다.
 *
 * @module ContractAdminService
 * @requirements 15.2 - 룰셋/표준계약서 저장 시 독소조항 패턴을 임베딩하여 OpenSearch 적재
 * @requirements 15.3 - 개별 임베딩/적재 실패 시 기록·계속 진행·관리자 알림 (Property 36)
 * @requirements 15.5 - 갱신 시각(UTC)·단조 증가 버전 번호 메타데이터 관리 (Property 37)
 * @requirements 15.6 - 갱신 성공/부분 실패 및 반영 버전 통지
 * @requirements 15.7 - 로드 실패 시 마지막 정상 버전 폴백·관리자 알림
 */

import type { ContractType } from '../interfaces/types.js';
import type { RuleSetMetadataRecord } from '../interfaces/records.js';
import type {
  ToxicRuleDocument,
  StandardFormDocument,
} from '../storage/opensearch-store.js';

// ---------------------------------------------------------------------------
// 포트(주입 가능한 의존성) 인터페이스
// ---------------------------------------------------------------------------

/**
 * SNS 알림 발행 포트
 *
 * 실제 SNS 클라이언트를 주입 가능하도록 인터페이스로 분리한다.
 * (기존 세무 수집기의 `SnsNotifier`와 동일한 계약을 따른다.)
 */
export interface SnsNotifier {
  /** 관리자 알림 발행 (제목, 본문) */
  publishFailureNotification(subject: string, message: string): Promise<void>;
}

/**
 * 임베딩 변환 포트
 *
 * `src/modules/search/embedding-client.ts`의 `EmbeddingClient`가 이 계약을
 * 만족하므로 그대로 주입할 수 있으며, 테스트 시 Mock으로 대체 가능하다.
 */
export interface PatternEmbedder {
  /** 텍스트를 1024차원 임베딩 벡터로 변환한다. */
  embedQuery(text: string): Promise<number[]>;
}

/**
 * OpenSearch 적재 포트
 *
 * `ContractOpenSearchStore`가 제공하는 인덱스 초기화 외에, 관리 파이프라인은
 * 개별 문서 색인(upsert)을 필요로 한다. 다른 서브에이전트가 편집 중인
 * 저장소 파일을 건드리지 않기 위해 관리 서비스는 이 최소 포트에만 의존한다.
 */
export interface ContractVectorIndexPort {
  /** 계약서 분석 전용 인덱스가 없으면 생성한다. (`contract-` 접두사 강제) */
  ensureIndex(name: string): Promise<boolean>;
  /**
   * 문서를 지정한 인덱스에 색인(upsert)한다.
   *
   * @param name - 논리 인덱스 이름 (`contract-` 접두사 강제)
   * @param id - 문서 식별자
   * @param document - 색인할 문서 본문 (임베딩 벡터 포함)
   */
  indexDocument(
    name: string,
    id: string,
    document: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * 룰셋/표준계약서 메타데이터 저장 포트
 *
 * `ContractDynamoStore`가 제공하는 메타데이터 CRUD 중 관리 파이프라인이
 * 사용하는 최소 부분만 추상화한다.
 */
export interface ContractMetadataPort {
  /** 룰셋 최신 메타데이터 조회 (없으면 null) */
  getLatestRuleSetMetadata(
    contractType: ContractType,
  ): Promise<RuleSetMetadataRecord | null>;
  /** 표준계약서 최신 메타데이터 조회 (없으면 null) */
  getLatestStandardMetadata(
    contractType: ContractType,
  ): Promise<RuleSetMetadataRecord | null>;
  /** 룰셋 메타데이터 저장 */
  saveRuleSetMetadata(
    contractType: ContractType,
    metadata: Omit<RuleSetMetadataRecord, 'PK' | 'SK'>,
  ): Promise<RuleSetMetadataRecord>;
  /** 표준계약서 메타데이터 저장 */
  saveStandardMetadata(
    contractType: ContractType,
    metadata: Omit<RuleSetMetadataRecord, 'PK' | 'SK'>,
  ): Promise<RuleSetMetadataRecord>;
}

// ---------------------------------------------------------------------------
// 기본 구현 (배포 전 안전한 폴백)
// ---------------------------------------------------------------------------

/**
 * 기본 SNS 알림 구현 (console.error로 로깅 — 실제 배포 시 AWS SNS로 교체)
 *
 * 세무 수집기의 기본 알림 구현과 동일한 폴백 전략을 사용한다.
 */
export class DefaultSnsNotifier implements SnsNotifier {
  async publishFailureNotification(subject: string, message: string): Promise<void> {
    // 실제 배포 시 SNSClient.PublishCommand로 교체
    console.error(`[SNS NOTIFICATION] ${subject}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 대상 종류 및 결과 타입
// ---------------------------------------------------------------------------

/** 적재 대상 종류 (룰셋 / 표준계약서) */
export type ContractDataKind = 'ruleset' | 'standard';

/**
 * 개별 적재 항목 유형
 *
 * - 룰셋: 독소조항 패턴 문서
 * - 표준계약서: 표준 조항 문서
 */
export type LoadableItem = ToxicRuleDocument | StandardFormDocument;

/**
 * 적재 실패 항목 상세
 */
export interface FailedPattern {
  /** 실패한 문서 식별자 (rule_id 또는 clause_id) */
  id: string;
  /** 실패한 단계 (임베딩 변환 / 벡터 적재) */
  phase: 'embedding' | 'indexing';
  /** 실패 사유 */
  error: string;
}

/**
 * 갱신 결과
 */
export interface AdminLoadResult {
  /** 대상 종류 */
  kind: ContractDataKind;
  /** 계약 유형 */
  contractType: ContractType;
  /** 반영된 버전 번호 (단조 증가) */
  version: number;
  /** 갱신 시각 (UTC ISO 8601) */
  updatedAt: string;
  /** 벡터 적재 상태 */
  vectorStatus: 'completed' | 'partial' | 'failed';
  /** 정상 적재된 항목 수 */
  loadedCount: number;
  /** 요청 항목 총 수 */
  totalCount: number;
  /** 적재 실패 항목 식별자 목록 (Property 36) */
  failedPatterns: string[];
  /** 적재 실패 상세 목록 */
  failedDetails: FailedPattern[];
  /** 갱신 성공 여부 (전체 실패가 아니면 true) */
  success: boolean;
}

/**
 * 로드 결과 (폴백 정보 포함)
 */
export interface AdminLoadStatus {
  /** 대상 종류 */
  kind: ContractDataKind;
  /** 계약 유형 */
  contractType: ContractType;
  /** 사용 가능한 최신 정상 버전 (없으면 null) */
  version: number | null;
  /** 마지막 정상 버전으로 폴백했는지 여부 */
  fallbackApplied: boolean;
  /** 로드 성공 여부 */
  available: boolean;
  /** 로드 시각 (UTC ISO 8601) */
  checkedAt: string;
}

/**
 * 서비스 설정
 */
export interface ContractAdminServiceConfig {
  /** 벡터 인덱스 적재 포트 */
  vectorIndex: ContractVectorIndexPort;
  /** 임베딩 변환 포트 */
  embedder: PatternEmbedder;
  /** 메타데이터 저장 포트 */
  metadata: ContractMetadataPort;
  /** SNS 알림 포트 (기본: DefaultSnsNotifier) */
  snsNotifier?: SnsNotifier;
  /** 서비스 식별자 (메타데이터 service_id, 기본 'CONTRACT') */
  serviceId?: string;
}

/** 룰셋/표준계약서 인덱스 논리명 */
const RULESET_INDEX = 'contract-toxic-rules';
const STANDARD_INDEX = 'contract-standard-forms';

// ---------------------------------------------------------------------------
// 관리(admin) 데이터 적재 서비스
// ---------------------------------------------------------------------------

/**
 * 계약서 분석 관리 데이터 적재 서비스
 *
 * 룰셋/표준계약서 갱신 파이프라인을 조율한다. 임베딩 변환·벡터 적재·메타데이터
 * 관리·실패 알림·로드 폴백을 담당하며, 모든 외부 의존성은 포트로 주입받아
 * 테스트 가능성을 확보한다.
 */
export class ContractAdminService {
  private readonly vectorIndex: ContractVectorIndexPort;
  private readonly embedder: PatternEmbedder;
  private readonly metadata: ContractMetadataPort;
  private readonly snsNotifier: SnsNotifier;
  private readonly serviceId: string;

  constructor(config: ContractAdminServiceConfig) {
    this.vectorIndex = config.vectorIndex;
    this.embedder = config.embedder;
    this.metadata = config.metadata;
    this.snsNotifier = config.snsNotifier ?? new DefaultSnsNotifier();
    this.serviceId = config.serviceId ?? 'CONTRACT';
  }

  /**
   * 계약 유형별 독소조항 룰셋을 갱신한다.
   *
   * 각 패턴을 임베딩 벡터로 변환하여 `contract-toxic-rules` 인덱스에 적재하고,
   * 단조 증가 버전 번호와 UTC 타임스탬프 메타데이터를 저장한다. 개별 실패는
   * 격리하여 나머지 적재를 계속 진행하며, 실패가 있으면 SNS 알림을 전송한다.
   *
   * @param contractType - 계약 유형
   * @param rules - 적재할 독소조항 룰셋 목록
   * @returns 갱신 결과 (반영 버전·실패 목록 포함)
   *
   * @requirements 15.2, 15.3, 15.5, 15.6
   */
  async updateRuleSet(
    contractType: ContractType,
    rules: ToxicRuleDocument[],
  ): Promise<AdminLoadResult> {
    return this.loadAndVersion(
      'ruleset',
      contractType,
      RULESET_INDEX,
      rules,
      (rule) => rule.rule_id,
      (rule) => rule.pattern_text,
    );
  }

  /**
   * 계약 유형별 표준계약서 조항을 갱신한다.
   *
   * 각 조항을 임베딩 벡터로 변환하여 `contract-standard-forms` 인덱스에
   * 적재하고, 단조 증가 버전 번호와 UTC 타임스탬프 메타데이터를 저장한다.
   *
   * @param contractType - 계약 유형
   * @param clauses - 적재할 표준계약서 조항 목록
   * @returns 갱신 결과 (반영 버전·실패 목록 포함)
   *
   * @requirements 15.2, 15.3, 15.5, 15.6
   */
  async updateStandardForm(
    contractType: ContractType,
    clauses: StandardFormDocument[],
  ): Promise<AdminLoadResult> {
    return this.loadAndVersion(
      'standard',
      contractType,
      STANDARD_INDEX,
      clauses,
      (clause) => clause.clause_id,
      (clause) => clause.clause_content,
    );
  }

  /**
   * 갱신 파이프라인 공통 구현.
   *
   * 1. 인덱스 존재 보장
   * 2. 각 항목 임베딩 → 적재 (개별 실패 격리, Property 36)
   * 3. 단조 증가 버전 번호 산출 및 UTC 타임스탬프 메타데이터 저장 (Property 37)
   * 4. 부분/전체 실패 시 SNS 관리자 알림
   *
   * @typeParam T - LoadableItem 하위 타입
   */
  private async loadAndVersion<T extends LoadableItem>(
    kind: ContractDataKind,
    contractType: ContractType,
    indexName: string,
    items: T[],
    getId: (item: T) => string,
    getText: (item: T) => string,
  ): Promise<AdminLoadResult> {
    const updatedAt = new Date().toISOString(); // UTC ISO 8601 (Property 37)

    // 인덱스 보장 (실패 시 전체 적재 불가 → failed 처리 + 알림)
    try {
      await this.vectorIndex.ensureIndex(indexName);
    } catch (error) {
      const message = this.toMessage(error);
      const failedDetails: FailedPattern[] = items.map((item) => ({
        id: getId(item),
        phase: 'indexing',
        error: `인덱스 초기화 실패: ${message}`,
      }));
      const version = await this.nextVersion(kind, contractType);
      await this.persistMetadata(kind, contractType, {
        version,
        updatedAt,
        vectorStatus: 'failed',
        failedPatterns: failedDetails.map((d) => d.id),
      });
      await this.notifyFailure(kind, contractType, failedDetails);
      return {
        kind,
        contractType,
        version,
        updatedAt,
        vectorStatus: 'failed',
        loadedCount: 0,
        totalCount: items.length,
        failedPatterns: failedDetails.map((d) => d.id),
        failedDetails,
        success: false,
      };
    }

    // 개별 항목 임베딩 + 적재 (실패 격리)
    const failedDetails: FailedPattern[] = [];
    let loadedCount = 0;

    for (const item of items) {
      const id = getId(item);
      let vector: number[];

      // 1) 임베딩 변환
      try {
        vector = await this.embedder.embedQuery(getText(item));
      } catch (error) {
        failedDetails.push({
          id,
          phase: 'embedding',
          error: this.toMessage(error),
        });
        continue; // 나머지 패턴 계속 진행 (Property 36)
      }

      // 2) 벡터 적재
      try {
        const document: Record<string, unknown> = {
          ...item,
          embedding_vector: vector,
          metadata: {
            version: 0, // 아래에서 확정 버전으로 갱신
            updated_at: updatedAt,
            service_id: this.serviceId,
          },
        };
        await this.vectorIndex.indexDocument(indexName, id, document);
        loadedCount += 1;
      } catch (error) {
        failedDetails.push({
          id,
          phase: 'indexing',
          error: this.toMessage(error),
        });
        continue; // 나머지 패턴 계속 진행 (Property 36)
      }
    }

    // 벡터 적재 상태 판정
    const vectorStatus: AdminLoadResult['vectorStatus'] =
      failedDetails.length === 0
        ? 'completed'
        : loadedCount === 0
          ? 'failed'
          : 'partial';

    // 단조 증가 버전 번호 + UTC 타임스탬프 메타데이터 (Property 37)
    const version = await this.nextVersion(kind, contractType);
    await this.persistMetadata(kind, contractType, {
      version,
      updatedAt,
      vectorStatus,
      failedPatterns: failedDetails.map((d) => d.id),
    });

    // 부분/전체 실패 시 관리자 알림 (Property 36)
    if (failedDetails.length > 0) {
      await this.notifyFailure(kind, contractType, failedDetails);
    }

    return {
      kind,
      contractType,
      version,
      updatedAt,
      vectorStatus,
      loadedCount,
      totalCount: items.length,
      failedPatterns: failedDetails.map((d) => d.id),
      failedDetails,
      success: vectorStatus !== 'failed',
    };
  }

  /**
   * 다음 버전 번호를 산출한다. (기존 최신 버전 + 1, 없으면 1)
   *
   * 반환 버전은 항상 이전 버전보다 크므로 단조 증가를 보장한다. (Property 37)
   *
   * @param kind - 대상 종류
   * @param contractType - 계약 유형
   * @returns 다음 버전 번호 (1 이상)
   */
  private async nextVersion(
    kind: ContractDataKind,
    contractType: ContractType,
  ): Promise<number> {
    const latest =
      kind === 'ruleset'
        ? await this.metadata.getLatestRuleSetMetadata(contractType)
        : await this.metadata.getLatestStandardMetadata(contractType);
    return (latest?.version ?? 0) + 1;
  }

  /**
   * 메타데이터 레코드를 저장한다. (룰셋/표준계약서 공통)
   */
  private async persistMetadata(
    kind: ContractDataKind,
    contractType: ContractType,
    metadata: Omit<RuleSetMetadataRecord, 'PK' | 'SK'>,
  ): Promise<void> {
    if (kind === 'ruleset') {
      await this.metadata.saveRuleSetMetadata(contractType, metadata);
    } else {
      await this.metadata.saveStandardMetadata(contractType, metadata);
    }
  }

  /**
   * 룰셋 또는 표준계약서 로드 상태를 확인한다.
   *
   * 최신 정상 버전(vectorStatus !== 'failed')을 조회한다. 최신 버전이 실패
   * 상태이거나 조회 자체가 실패하면 마지막으로 정상 로드된 버전으로 폴백하며,
   * 폴백 발생 시 관리자에게 로드 실패 알림을 전송한다.
   *
   * 주의: 최신 메타데이터만 조회 가능한 포트 제약상, 최신 버전이 failed인 경우
   * 폴백 대상 버전은 (version - 1)로 표기하고 알림을 전송한다.
   *
   * @param kind - 대상 종류
   * @param contractType - 계약 유형
   * @returns 로드 상태 (폴백 여부·사용 가능 버전 포함)
   *
   * @requirements 15.7
   */
  async loadLatest(
    kind: ContractDataKind,
    contractType: ContractType,
  ): Promise<AdminLoadStatus> {
    const checkedAt = new Date().toISOString();

    let latest: RuleSetMetadataRecord | null;
    try {
      latest =
        kind === 'ruleset'
          ? await this.metadata.getLatestRuleSetMetadata(contractType)
          : await this.metadata.getLatestStandardMetadata(contractType);
    } catch (error) {
      // 조회 자체 실패 → 폴백 불가·로드 실패 알림
      await this.notifyLoadFailure(kind, contractType, this.toMessage(error));
      return {
        kind,
        contractType,
        version: null,
        fallbackApplied: true,
        available: false,
        checkedAt,
      };
    }

    // 메타데이터 없음 → 사용 가능한 버전 없음 (폴백 대상도 없음)
    if (!latest) {
      return {
        kind,
        contractType,
        version: null,
        fallbackApplied: false,
        available: false,
        checkedAt,
      };
    }

    // 최신 버전이 실패 상태 → 마지막 정상 버전으로 폴백 + 알림
    if (latest.vectorStatus === 'failed') {
      const fallbackVersion = latest.version > 1 ? latest.version - 1 : null;
      await this.notifyLoadFailure(
        kind,
        contractType,
        `최신 버전(${latest.version}) 로드 실패, 마지막 정상 버전으로 폴백합니다.`,
      );
      return {
        kind,
        contractType,
        version: fallbackVersion,
        fallbackApplied: true,
        available: fallbackVersion !== null,
        checkedAt,
      };
    }

    // 정상 버전 사용
    return {
      kind,
      contractType,
      version: latest.version,
      fallbackApplied: false,
      available: true,
      checkedAt,
    };
  }

  /**
   * 적재 실패 관리자 알림을 전송한다. (Property 36)
   *
   * 알림 발행 실패는 갱신 결과에 영향을 주지 않는다.
   */
  private async notifyFailure(
    kind: ContractDataKind,
    contractType: ContractType,
    failedDetails: FailedPattern[],
  ): Promise<void> {
    const subject = `[계약서분석] ${this.kindLabel(kind)} 적재 실패 알림 (${contractType})`;
    const lines = failedDetails.map(
      (d) => `- ${d.id} [${d.phase}]: ${d.error}`,
    );
    const message = [
      `계약 유형: ${contractType}`,
      `실패 항목 수: ${failedDetails.length}`,
      '실패 상세:',
      ...lines,
    ].join('\n');

    try {
      await this.snsNotifier.publishFailureNotification(subject, message);
    } catch (notifyError) {
      // 알림 실패는 결과에 영향을 주지 않음
      console.error(`SNS 알림 발행 실패: ${this.toMessage(notifyError)}`);
    }
  }

  /**
   * 로드 실패 관리자 알림을 전송한다. (Property/Requirement 15.7)
   */
  private async notifyLoadFailure(
    kind: ContractDataKind,
    contractType: ContractType,
    reason: string,
  ): Promise<void> {
    const subject = `[계약서분석] ${this.kindLabel(kind)} 로드 실패 알림 (${contractType})`;
    const message = [
      `계약 유형: ${contractType}`,
      `사유: ${reason}`,
    ].join('\n');

    try {
      await this.snsNotifier.publishFailureNotification(subject, message);
    } catch (notifyError) {
      console.error(`SNS 알림 발행 실패: ${this.toMessage(notifyError)}`);
    }
  }

  /** 대상 종류 한글 라벨 */
  private kindLabel(kind: ContractDataKind): string {
    return kind === 'ruleset' ? '독소조항 룰셋' : '표준계약서';
  }

  /** 오류를 문자열 메시지로 변환한다. */
  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
