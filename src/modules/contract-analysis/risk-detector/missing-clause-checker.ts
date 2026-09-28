/**
 * 누락 특약 점검기 (MissingClauseChecker)
 *
 * 계약 유형별 필수 특약 목록과 업로드 계약서의 조항을 대조하여 누락된
 * 필수 특약을 식별하는 책임을 담당한다.
 *
 * 항상 별도 항목 제시 (Property 10):
 *   위험 조항 탐지 결과와 무관하게(위험 조항이 0건인 경우를 포함하여)
 *   누락 특약 점검 결과(`MissingClause[]`)는 항상 별도 항목으로 반환된다.
 *   누락된 특약이 없으면 빈 배열을 반환한다.
 *
 * 필수 특약 목록 로드 우선순위:
 *   1. 로드된 룰셋에서 `isRequiredClause=true`로 표시된 룰
 *   2. S3 config(`contract-data/config/required-clauses/{contractType}.json`)
 *
 * 위 두 소스를 병합하여 계약 유형별 필수 특약 목록을 구성하며, 룰셋에 필수
 * 특약 정보가 포함되어 있으면 별도 config 조회 없이도 동작한다.
 *
 * @module MissingClauseChecker
 * @requirements 3.3, 3.5
 */

import type {
  ContractType,
  PartyPerspective,
  RecognizedClause,
  MissingClause,
} from '../interfaces/index.js';
import type { ToxicRule } from '../contract-context/ruleset-loader.js';
import {
  ContractS3KeyBuilder,
  type ContractS3Store,
} from '../storage/s3-store.js';

/**
 * 필수 특약 정의
 *
 * 룰셋 또는 S3 config에서 로드되는 계약 유형별 필수 특약 항목이다.
 */
export interface RequiredClauseDefinition {
  /** 필수 특약명 */
  clauseName: string;
  /** 필요성 설명 */
  description: string;
  /** 특약 존재 판별을 위한 키워드 (선택) */
  keywords?: string[];
}

/**
 * S3 config에 저장되는 필수 특약 JSON 페이로드 형태
 *
 * `contract-data/config/required-clauses/{contractType}.json` 파일 구조.
 * 배열 형태 또는 `{ clauses: [...] }` 객체 형태를 모두 허용한다.
 */
interface S3RequiredClausePayload {
  clauses: Array<{
    clauseName?: string;
    clause_name?: string;
    description?: string;
    keywords?: string[];
  }>;
}

/**
 * 누락 특약 점검기 설정
 */
export interface MissingClauseCheckerConfig {
  /** S3 config 저장소 (필수 특약 목록 폴백 로드, 선택) */
  s3Store?: ContractS3Store;
}

/**
 * 누락 특약 점검기
 *
 * 계약 유형별 필수 특약 목록을 룰셋과 S3 config에서 확보한 뒤, 업로드
 * 계약서 조항과 대조하여 누락된 특약을 식별한다.
 *
 * @requirements 3.3, 3.5
 */
export class MissingClauseChecker {
  private readonly s3Store?: ContractS3Store;

  constructor(config: MissingClauseCheckerConfig = {}) {
    if (config.s3Store !== undefined) {
      this.s3Store = config.s3Store;
    }
  }

  /**
   * 누락된 필수 특약을 식별한다.
   *
   * 필수 특약 목록을 룰셋(우선)과 S3 config(폴백)에서 확보하고, 각 필수
   * 특약이 업로드 계약서 조항 중 하나 이상에 포함되는지 확인한다. 어떤
   * 조항에도 매칭되지 않는 필수 특약을 누락 특약으로 반환한다.
   *
   * 위험 조항 수와 무관하게 항상 배열을 반환하며, 누락이 없으면 빈 배열을
   * 반환한다 (Property 10).
   *
   * @param clauses - 업로드 계약서 조항 목록
   * @param contractType - 계약 유형
   * @param perspective - 당사자 관점
   * @param rules - 로드된 독소조항 룰 목록
   * @returns 누락된 필수 특약 목록 (누락 없으면 빈 배열)
   *
   * @requirements 3.3, 3.5
   */
  async check(
    clauses: RecognizedClause[],
    contractType: ContractType,
    perspective: PartyPerspective,
    rules: ToxicRule[],
  ): Promise<MissingClause[]> {
    const required = await this.loadRequiredClauses(contractType, rules);
    if (required.length === 0) {
      return [];
    }

    const contractText = this.normalize(
      clauses.map((clause) => clause.text).join(' '),
    );

    const missing: MissingClause[] = [];
    for (const definition of required) {
      if (!this.isPresent(definition, contractText)) {
        missing.push({
          clauseName: definition.clauseName,
          description: definition.description,
          perspective,
        });
      }
    }
    return missing;
  }

  /**
   * 계약 유형별 필수 특약 목록을 로드한다.
   *
   * 로드된 룰셋에서 `isRequiredClause=true`인 룰을 우선 수집하고, S3 config
   * 저장소가 주입된 경우 config JSON을 추가로 병합한다. 특약명이 중복되면
   * 룰셋 항목을 우선한다. S3 조회 실패는 누락 특약 점검을 중단시키지 않으며,
   * 확보된 룰셋 기반 목록만으로 계속 진행한다.
   *
   * @param contractType - 계약 유형
   * @param rules - 로드된 독소조항 룰 목록
   * @returns 필수 특약 정의 목록
   */
  private async loadRequiredClauses(
    contractType: ContractType,
    rules: ToxicRule[],
  ): Promise<RequiredClauseDefinition[]> {
    const byName = new Map<string, RequiredClauseDefinition>();

    // 1순위: 룰셋의 필수 특약 표시 룰
    for (const rule of rules) {
      if (rule.isRequiredClause === true && rule.patternText.trim().length > 0) {
        const name = rule.riskType.trim().length > 0 ? rule.riskType : rule.ruleId;
        byName.set(name, {
          clauseName: name,
          description: rule.riskReason,
          keywords: [rule.patternText],
        });
      }
    }

    // 2순위: S3 config 필수 특약 목록 (병합)
    const configDefs = await this.loadFromS3Config(contractType);
    for (const def of configDefs) {
      if (!byName.has(def.clauseName)) {
        byName.set(def.clauseName, def);
      }
    }

    return [...byName.values()];
  }

  /**
   * S3 config에서 필수 특약 목록을 로드한다.
   *
   * `contract-data/config/required-clauses/{contractType}.json` 객체를
   * 조회하여 파싱한다. 저장소가 주입되지 않았거나 조회에 실패하면 빈 배열을
   * 반환하여 점검이 룰셋 기반으로 계속 진행되도록 한다.
   *
   * @param contractType - 계약 유형
   * @returns 필수 특약 정의 목록 (미존재/실패 시 빈 배열)
   */
  private async loadFromS3Config(
    contractType: ContractType,
  ): Promise<RequiredClauseDefinition[]> {
    if (!this.s3Store) {
      return [];
    }

    try {
      const key = ContractS3KeyBuilder.config('required-clauses', contractType);
      const bytes = await this.s3Store.getOriginal(key);
      if (!bytes || bytes.length === 0) {
        return [];
      }

      const text = new TextDecoder('utf-8').decode(bytes);
      const parsed = JSON.parse(text) as unknown;

      const rawClauses: S3RequiredClausePayload['clauses'] = Array.isArray(parsed)
        ? (parsed as S3RequiredClausePayload['clauses'])
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as S3RequiredClausePayload).clauses)
          ? (parsed as S3RequiredClausePayload).clauses
          : [];

      return rawClauses
        .map((raw) => {
          const clauseName = (raw.clauseName ?? raw.clause_name ?? '').trim();
          if (clauseName.length === 0) {
            return null;
          }
          const definition: RequiredClauseDefinition = {
            clauseName,
            description: raw.description ?? '',
          };
          if (raw.keywords !== undefined) {
            definition.keywords = raw.keywords;
          }
          return definition;
        })
        .filter((def): def is RequiredClauseDefinition => def !== null);
    } catch {
      // config 조회 실패는 룰셋 기반 점검을 막지 않는다.
      return [];
    }
  }

  /**
   * 필수 특약이 계약서 본문에 존재하는지 판별한다.
   *
   * 키워드가 정의되어 있으면 키워드 중 하나라도 본문에 포함되면 존재로
   * 간주하고, 키워드가 없으면 특약명 자체를 본문에서 탐색한다.
   *
   * @param definition - 필수 특약 정의
   * @param contractText - 정규화된 계약서 전체 본문
   * @returns 존재 시 true, 누락 시 false
   */
  private isPresent(
    definition: RequiredClauseDefinition,
    contractText: string,
  ): boolean {
    const keywords =
      definition.keywords && definition.keywords.length > 0
        ? definition.keywords
        : [definition.clauseName];

    return keywords.some((keyword) => {
      const normalized = this.normalize(keyword);
      return normalized.length > 0 && contractText.includes(normalized);
    });
  }

  /**
   * 매칭 비교를 위해 텍스트를 정규화한다.
   *
   * 연속 공백을 단일 공백으로 축약하고 앞뒤 공백을 제거한다.
   *
   * @param text - 원본 텍스트
   * @returns 정규화된 텍스트
   */
  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
