/**
 * 룰셋 매처 (RuleMatcher)
 *
 * 계약서 조항을 계약 유형별 독소조항 룰셋 및 벡터 유사도와 대조하여
 * 위험 조항 여부를 판정하는 책임을 담당한다.
 *
 * 위험 판정 규칙 (Property 8):
 *   - 계약 유형별 독소조항 룰셋에 매칭이 존재하거나(matchSource=ruleset),
 *     조항 임베딩 벡터의 kNN 유사도가 0.75 이상이면(matchSource=vector)
 *     위험 조항으로 판정한다.
 *   - 룰셋 매칭이 없고 유사도가 0.75 미만이면 위험 조항으로 판정하지 않는다.
 *
 * 벡터 유사도 검색은 기존 임베딩 클라이언트(`src/modules/search/embedding-client.ts`)를
 * 재활용하여 조항 텍스트를 1024차원 벡터로 변환한 뒤, 계약서 분석 전용
 * OpenSearch 저장소(`ContractOpenSearchStore.searchToxicRules`)로 kNN 검색을 수행한다.
 *
 * @module RuleMatcher
 * @requirements 3.1, 3.7, 3.8
 */

import type { ContractType, RecognizedClause } from '../interfaces/index.js';
import type { EmbeddingClient } from '../../search/embedding-client.js';
import type {
  ContractOpenSearchStore,
  ToxicRuleMatch,
} from '../storage/opensearch-store.js';
import type { ToxicRule } from '../contract-context/ruleset-loader.js';

/** 위험 조항 판정 벡터 유사도 임계값 (Property 8) */
export const RISK_SIMILARITY_THRESHOLD = 0.75;

/**
 * 룰셋 매칭 결과
 *
 * 조항이 위험으로 판정된 경우 매칭 소스와 근거 정보를 포함한다.
 */
export interface ClauseMatchResult {
  /** 조항 식별자 */
  clauseId: string;
  /** 위험 조항 여부 */
  isRisk: boolean;
  /** 매칭 소스 (위험일 때만 의미 있음) */
  matchSource?: 'ruleset' | 'vector';
  /** 매칭된 독소조항 룰 (있는 경우) */
  matchedRule?: {
    ruleId: string;
    riskType: string;
    riskReason: string;
    patternText: string;
    legalBasis?: string[];
  };
  /** 벡터 유사도 점수 (matchSource=vector 시) */
  similarityScore?: number;
}

/**
 * 룰셋 매처 설정
 */
export interface RuleMatcherConfig {
  /** 계약서 분석 OpenSearch 저장소 (kNN 벡터 검색) */
  openSearchStore: ContractOpenSearchStore;
  /** 임베딩 클라이언트 (조항 → 1024차원 벡터) */
  embeddingClient: EmbeddingClient;
  /** 위험 판정 유사도 임계값 (기본 0.75) */
  similarityThreshold?: number;
  /** 조항당 kNN 최대 결과 수 (기본 5) */
  maxVectorResults?: number;
}

/**
 * 룰셋 매처
 *
 * 로드된 독소조항 룰셋과의 텍스트 매칭, 그리고 조항 임베딩 기반 벡터
 * 유사도 검색을 결합하여 조항별 위험 여부를 판정한다.
 *
 * @requirements 3.1, 3.7, 3.8
 */
export class RuleMatcher {
  private readonly openSearchStore: ContractOpenSearchStore;
  private readonly embeddingClient: EmbeddingClient;
  private readonly similarityThreshold: number;
  private readonly maxVectorResults: number;

  constructor(config: RuleMatcherConfig) {
    this.openSearchStore = config.openSearchStore;
    this.embeddingClient = config.embeddingClient;
    this.similarityThreshold = config.similarityThreshold ?? RISK_SIMILARITY_THRESHOLD;
    this.maxVectorResults = config.maxVectorResults ?? 5;
  }

  /**
   * 단일 조항의 위험 여부를 판정한다.
   *
   * 판정 우선순위:
   *   1. 로드된 룰셋에서 패턴 텍스트 매칭을 먼저 확인한다(matchSource=ruleset).
   *   2. 룰셋 매칭이 없으면 조항을 임베딩하여 kNN 유사도 검색을 수행하고,
   *      최고 유사도가 임계값(기본 0.75) 이상이면 위험으로 판정한다
   *      (matchSource=vector).
   *
   * 룰셋 매칭과 벡터 유사도 모두 조건을 충족하지 못하면 비위험으로 판정한다.
   *
   * 룰셋/벡터 저장소 접근이 불가능한 경우(임베딩 또는 kNN 검색 실패)에는
   * 오류를 상위로 전파하여 탐지 중단·오류 반환이 이루어지도록 한다.
   *
   * @param clause - 인식된 조항
   * @param contractType - 계약 유형
   * @param rules - 로드된 독소조항 룰 목록
   * @returns 조항 매칭 결과
   *
   * @requirements 3.1, 3.7, 3.8
   */
  async matchClause(
    clause: RecognizedClause,
    contractType: ContractType,
    rules: ToxicRule[],
  ): Promise<ClauseMatchResult> {
    // 1순위: 룰셋 텍스트 매칭
    const rulesetMatch = this.matchAgainstRuleset(clause.text, rules);
    if (rulesetMatch) {
      const matchedRule: ClauseMatchResult['matchedRule'] = {
        ruleId: rulesetMatch.ruleId,
        riskType: rulesetMatch.riskType,
        riskReason: rulesetMatch.riskReason,
        patternText: rulesetMatch.patternText,
        ...(rulesetMatch.legalBasis !== undefined
          ? { legalBasis: rulesetMatch.legalBasis }
          : {}),
      };
      return {
        clauseId: clause.clauseId,
        isRisk: true,
        matchSource: 'ruleset',
        matchedRule,
      };
    }

    // 2순위: 벡터 유사도 검색
    const vectorMatch = await this.matchAgainstVector(clause.text, contractType);
    if (vectorMatch && vectorMatch.score >= this.similarityThreshold) {
      return {
        clauseId: clause.clauseId,
        isRisk: true,
        matchSource: 'vector',
        matchedRule: {
          ruleId: vectorMatch.rule.rule_id,
          riskType: vectorMatch.rule.risk_type,
          riskReason: vectorMatch.rule.risk_reason,
          patternText: vectorMatch.rule.pattern_text,
          ...(vectorMatch.rule.legal_basis !== undefined
            ? { legalBasis: vectorMatch.rule.legal_basis }
            : {}),
        },
        similarityScore: vectorMatch.score,
      };
    }

    // 룰셋 매칭 없음 + 유사도 임계값 미만 → 비위험
    return {
      clauseId: clause.clauseId,
      isRisk: false,
    };
  }

  /**
   * 조항 텍스트를 로드된 룰셋의 패턴 텍스트와 대조한다.
   *
   * 패턴 텍스트가 조항 텍스트에 포함되면(부분 문자열 매칭) 룰셋 매칭으로
   * 간주한다. 필수 특약 여부만 표시하는 룰(patternText가 비어있는 경우)은
   * 위험 조항 매칭 대상에서 제외한다.
   *
   * @param clauseText - 조항 원문
   * @param rules - 로드된 독소조항 룰 목록
   * @returns 매칭된 룰 또는 null
   */
  private matchAgainstRuleset(
    clauseText: string,
    rules: ToxicRule[],
  ): ToxicRule | null {
    const normalizedClause = this.normalize(clauseText);
    if (normalizedClause.length === 0) {
      return null;
    }

    for (const rule of rules) {
      const pattern = this.normalize(rule.patternText);
      if (pattern.length === 0) {
        continue;
      }
      if (normalizedClause.includes(pattern)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * 조항 텍스트를 임베딩하여 kNN 벡터 유사도 검색을 수행한다.
   *
   * 기존 임베딩 클라이언트로 조항을 1024차원 벡터로 변환한 뒤, 계약 유형
   * 필터를 적용하여 독소조항 룰셋 인덱스에서 최고 유사도 매칭을 조회한다.
   * 검색 결과는 유사도 내림차순으로 정렬되어 반환되므로 첫 번째 항목이
   * 최고 유사도이다. 매칭이 없으면 null을 반환한다.
   *
   * @param clauseText - 조항 원문
   * @param contractType - 계약 유형 필터
   * @returns 최고 유사도 매칭 또는 null
   */
  private async matchAgainstVector(
    clauseText: string,
    contractType: ContractType,
  ): Promise<ToxicRuleMatch | null> {
    const normalized = clauseText.trim();
    if (normalized.length === 0) {
      return null;
    }

    const queryVector = await this.embeddingClient.embedQuery(normalized);
    const matches = await this.openSearchStore.searchToxicRules(queryVector, {
      contractType,
      maxResults: this.maxVectorResults,
      threshold: this.similarityThreshold,
    });

    return matches.length > 0 ? (matches[0] as ToxicRuleMatch) : null;
  }

  /**
   * 매칭 비교를 위해 텍스트를 정규화한다.
   *
   * 앞뒤 공백을 제거하고 연속 공백을 단일 공백으로 축약한다. 한글 매칭
   * 특성상 대소문자 변환은 적용하지 않는다.
   *
   * @param text - 원본 텍스트
   * @returns 정규화된 텍스트
   */
  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
