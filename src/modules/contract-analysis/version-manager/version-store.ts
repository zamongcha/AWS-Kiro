/**
 * 버전 저장소 (VersionStore)
 *
 * 계약서 수정본을 신규 버전으로 저장하고, 버전 유지 정책(최소 10개, 최대 50개)에
 * 따라 초과분을 FIFO(가장 낮은 버전 번호부터)로 삭제하는 저장 계층이다.
 * 실제 영속화는 `ContractDynamoStore`에 위임하며, 파티션 키는
 * `CONTRACT#{documentId}`, 정렬 키는 `VERSION#{zeroPadded}` 형식을 사용한다.
 *
 * 주요 규칙:
 *   - Property 29: 버전 번호는 1부터 1씩 증가하며, 각 저장은 기존 버전을
 *     변경하지 않는다(신규 항목만 추가).
 *   - Property 30: 유지 버전 수는 항상 50개 이하이며, 50개를 초과하면 버전
 *     번호가 가장 낮은 오래된 버전부터 삭제한다. 최소 10개를 유지한다.
 *   - 저장 실패 시 기존 버전 데이터를 변경하지 않고 오류를 전파한다(수정본 보존).
 *
 * @module VersionStore
 * @requirements 12.1, 12.2, 12.3, 12.4, 12.7
 */

import type { RiskGrade } from '../interfaces/types.js';
import type { ContractVersion } from '../interfaces/version-manager.js';
import type { ContractVersionRecord } from '../interfaces/records.js';
import type { ContractDynamoStore } from '../storage/dynamo-store.js';

/** 계약서당 유지해야 하는 최소 버전 수 */
export const MIN_RETAINED_VERSIONS = 10;

/** 계약서당 유지 가능한 최대 버전 수 */
export const MAX_RETAINED_VERSIONS = 50;

/**
 * 수정본 내용으로부터 종합 위험도 등급을 산출하는 평가자.
 *
 * 실제 배포에서는 오케스트레이터가 위험조항 탐지기·위험도 평가기 기반의
 * 평가자를 주입한다. 미주입 시 기본 평가자(기본 등급 반환)를 사용한다.
 */
export type GradeEvaluator = (revisedContent: string) => Promise<RiskGrade> | RiskGrade;

/**
 * 버전 저장소 설정
 */
export interface VersionStoreConfig {
  /** DynamoDB 계약서 저장소 (필수) */
  dynamoStore: ContractDynamoStore;
  /** 수정본 종합 등급 평가자 (선택, 미주입 시 기본 등급 사용) */
  gradeEvaluator?: GradeEvaluator;
  /** 기본 종합 등급 (평가자 미주입 시 사용, 기본값 'low') */
  defaultGrade?: RiskGrade;
}

/**
 * 버전 저장소
 *
 * @requirements 12.1, 12.2, 12.3, 12.4, 12.7
 */
export class VersionStore {
  private readonly dynamoStore: ContractDynamoStore;
  private readonly gradeEvaluator: GradeEvaluator | undefined;
  private readonly defaultGrade: RiskGrade;

  constructor(config: VersionStoreConfig) {
    this.dynamoStore = config.dynamoStore;
    this.gradeEvaluator = config.gradeEvaluator;
    this.defaultGrade = config.defaultGrade ?? 'low';
  }

  /**
   * 계약서 수정본을 신규 버전으로 저장한다.
   *
   * 기존 버전을 조회하여 다음 버전 번호(기존 최대 + 1, 없으면 1)를 부여하고,
   * 저장 일시(`YYYY-MM-DD HH:mm:ss`)를 함께 기록한다. 저장 후 유지 정책에
   * 따라 50개 초과분을 오래된 버전부터 삭제한다.
   *
   * 신규 버전 저장이 실패하면 기존 버전 데이터는 변경되지 않으며, 오류가
   * 그대로 전파되어 상위 계층에서 수정본 보존·오류 안내를 수행한다.
   *
   * @param documentId - 문서 식별자
   * @param revisedContent - 수정본 내용
   * @returns 저장된 버전 정보
   *
   * @requirements 12.1, 12.2, 12.3, 12.4, 12.7
   */
  async save(
    documentId: string,
    revisedContent: string,
  ): Promise<ContractVersion> {
    // 기존 버전 조회 (오름차순: 가장 낮은 버전이 앞) — 기존 데이터는 변경하지 않는다.
    const existing = await this.dynamoStore.listVersions(documentId, true);

    // 다음 버전 번호: 기존 최대 버전 + 1 (없으면 1부터 시작)
    const nextVersion = this.computeNextVersionNumber(existing);
    const savedAt = this.formatTimestamp(new Date());
    const overallGrade = await this.evaluateGrade(revisedContent);

    // 신규 버전만 추가 (기존 버전 미변경)
    await this.dynamoStore.saveVersion(documentId, {
      versionNumber: nextVersion,
      savedAt,
      content: revisedContent,
      overallGrade,
    });

    // 유지 정책 적용: 50개 초과 시 오래된 버전부터 FIFO 삭제
    await this.enforceRetentionPolicy(documentId, existing, nextVersion);

    return { versionNumber: nextVersion, savedAt, overallGrade };
  }

  /**
   * 다음 버전 번호를 산출한다.
   *
   * 기존 버전이 없으면 1, 있으면 최대 버전 번호 + 1을 반환하여 1씩 증가하는
   * 연속된 정수 버전 번호를 보장한다(Property 29).
   *
   * @param existing - 기존 버전 레코드 목록
   * @returns 다음 버전 번호
   */
  private computeNextVersionNumber(existing: ContractVersionRecord[]): number {
    if (existing.length === 0) {
      return 1;
    }
    const maxVersion = existing.reduce(
      (max, record) => (record.versionNumber > max ? record.versionNumber : max),
      0,
    );
    return maxVersion + 1;
  }

  /**
   * 버전 유지 정책을 적용한다.
   *
   * 신규 버전 저장 후 총 버전 수가 최대 유지 수(50)를 초과하면, 버전 번호가
   * 가장 낮은 오래된 버전부터 순서대로 삭제하여 정확히 50개를 유지한다.
   * 최소 유지 수(10) 미만으로는 삭제하지 않는다(초과 시에만 삭제하므로 자연히 보장).
   *
   * @param documentId - 문서 식별자
   * @param previousVersions - 저장 이전의 버전 레코드 목록
   * @param newVersionNumber - 방금 저장한 신규 버전 번호
   *
   * @requirements 12.3, 12.4
   */
  private async enforceRetentionPolicy(
    documentId: string,
    previousVersions: ContractVersionRecord[],
    newVersionNumber: number,
  ): Promise<void> {
    const totalCount = previousVersions.length + 1;
    if (totalCount <= MAX_RETAINED_VERSIONS) {
      return;
    }

    // 버전 번호 오름차순으로 삭제 후보를 정렬한다(신규 버전 포함 전체 목록 기준).
    const allVersionNumbers = [
      ...previousVersions.map((record) => record.versionNumber),
      newVersionNumber,
    ].sort((a, b) => a - b);

    const deleteCount = totalCount - MAX_RETAINED_VERSIONS;
    const toDelete = allVersionNumbers.slice(0, deleteCount);

    for (const versionNumber of toDelete) {
      await this.dynamoStore.deleteVersion(documentId, versionNumber);
    }
  }

  /**
   * 수정본 종합 위험도 등급을 산출한다.
   *
   * 평가자가 주입된 경우 이를 사용하고, 없으면 기본 등급을 반환한다.
   *
   * @param revisedContent - 수정본 내용
   * @returns 종합 위험도 등급
   */
  private async evaluateGrade(revisedContent: string): Promise<RiskGrade> {
    if (this.gradeEvaluator) {
      return this.gradeEvaluator(revisedContent);
    }
    return this.defaultGrade;
  }

  /**
   * 저장 일시를 `YYYY-MM-DD HH:mm:ss` 형식 문자열로 포맷한다.
   *
   * 로컬 타임존 기준으로 각 필드를 2자리로 zero-padding 한다.
   *
   * @param date - 대상 시각
   * @returns `YYYY-MM-DD HH:mm:ss` 형식 문자열
   *
   * @requirements 12.1
   */
  formatTimestamp(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}
