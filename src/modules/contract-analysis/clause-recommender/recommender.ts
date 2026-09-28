/**
 * 특약 추천기 (ClauseRecommender)
 *
 * 계약 유형과 당사자 관점이 확정되면 해당 조건에서 권장되는 특약 목록을
 * 산출하고, 계약서에서 식별된 누락 특약을 추천 목록 상단에 우선 배치하는
 * 책임을 담당한다.
 *
 * 주요 규칙:
 *   - 요구사항 11.1: 권장 특약이 존재하면 1개 이상 추천하고 3초 이내에 반환
 *   - 요구사항 11.2: 권장 특약이 하나도 없으면 빈 목록 대신 hasRecommendations=false
 *   - 요구사항 11.3: 각 추천에 특약 문안·추천 사유·관점 이점 제공
 *   - 요구사항 11.4 (Property 28): 누락 특약을 그 외 특약보다 높은 우선순위로 상단 배치
 *   - 요구사항 11.6: 각 추천의 근거 법조항/판례 1건 이상 명시
 *   - 요구사항 11.7: 근거 미확인 시 isBasisVerified=false 표시
 *
 * 권장 특약 데이터는 계약 유형·관점별 시드(`recommendation-seed.ts`)에서
 * 확보하며, 필요 시 외부 시드 소스(`ClauseSeedSource`)를 주입하여 S3 config
 * 등에서 로드하도록 확장할 수 있다.
 *
 * @module ClauseRecommender
 * @requirements 11.1, 11.2, 11.3, 11.4, 11.6, 11.7
 */

import type {
  ContractType,
  PartyPerspective,
  ClauseRecommenderInput,
  ClauseRecommenderOutput,
  RecommendedClause,
  MissingClause,
  LegalReference,
} from '../interfaces/index.js';
import {
  RECOMMENDATION_SEED,
  type RecommendationSeed,
} from './recommendation-seed.js';

/**
 * 누락 특약에 부여되는 우선순위 기준값.
 *
 * 누락 특약은 이 값부터 시작하는 낮은 정수 priority를 부여받아 항상 일반
 * 권장 특약보다 상위(작은 값 = 높은 우선순위)에 배치된다.
 */
export const MISSING_CLAUSE_PRIORITY_BASE = 1;

/**
 * 일반 권장 특약에 부여되는 우선순위 기준값.
 *
 * 누락 특약보다 항상 큰 값을 사용하여 누락 특약이 목록 상단에 오도록 보장한다.
 * (요구사항 11.4 / Property 28)
 */
export const GENERAL_CLAUSE_PRIORITY_BASE = 1000;

/**
 * 계약 유형·관점별 권장 특약 시드를 제공하는 소스 인터페이스.
 *
 * 기본 구현은 코드 내 시드(`recommendation-seed.ts`)를 사용하지만, S3 config
 * 등 외부 저장소 기반 구현으로 교체할 수 있다.
 */
export interface ClauseSeedSource {
  /**
   * 계약 유형·관점에 해당하는 권장 특약 시드 목록을 반환한다.
   *
   * @param contractType - 계약 유형
   * @param perspective - 당사자 관점
   * @returns 권장 특약 시드 목록 (없으면 빈 배열)
   */
  getSeeds(
    contractType: ContractType,
    perspective: PartyPerspective,
  ): Promise<RecommendationSeed[]> | RecommendationSeed[];
}

/**
 * 코드 내 시드 데이터를 사용하는 기본 시드 소스.
 */
class DefaultClauseSeedSource implements ClauseSeedSource {
  getSeeds(
    contractType: ContractType,
    perspective: PartyPerspective,
  ): RecommendationSeed[] {
    const byType = RECOMMENDATION_SEED[contractType];
    if (!byType) {
      return [];
    }
    return byType[perspective] ?? [];
  }
}

/**
 * 특약 추천기 설정
 */
export interface ClauseRecommenderConfig {
  /** 권장 특약 시드 소스 (기본: 코드 내 시드) */
  seedSource?: ClauseSeedSource;
}

/**
 * 특약 추천기
 *
 * @requirements 11.1, 11.2, 11.3, 11.4, 11.6, 11.7
 */
export class ClauseRecommender {
  private readonly seedSource: ClauseSeedSource;

  constructor(config: ClauseRecommenderConfig = {}) {
    this.seedSource = config.seedSource ?? new DefaultClauseSeedSource();
  }

  /**
   * 계약 유형·관점 조건에서 권장되는 특약 목록을 산출한다.
   *
   * 처리 흐름:
   *   1. 시드 소스에서 계약 유형·관점별 권장 특약 시드를 확보한다.
   *   2. 입력으로 전달된 누락 특약(`missingClauses`)을 상단 우선순위로 변환한다.
   *   3. 시드 기반 일반 권장 특약을 누락 특약보다 낮은 우선순위로 변환한다.
   *   4. 누락 특약명과 중복되는 일반 시드는 제외하여 중복 추천을 방지한다.
   *   5. priority 오름차순으로 정렬하여 반환한다.
   *
   * 권장 특약이 하나도 없으면 빈 목록과 hasRecommendations=false를 반환한다
   * (요구사항 11.2).
   *
   * @param input - 특약 추천기 입력
   * @returns 특약 추천 결과
   *
   * @requirements 11.1, 11.2, 11.3, 11.4, 11.6, 11.7
   */
  async recommend(
    input: ClauseRecommenderInput,
  ): Promise<ClauseRecommenderOutput> {
    const { contractType, perspective, missingClauses } = input;

    const missing = missingClauses ?? [];

    // 1. 누락 특약을 상단 우선순위 추천으로 변환 (Property 28)
    const missingRecommendations = missing.map((clause, index) =>
      this.fromMissingClause(clause, MISSING_CLAUSE_PRIORITY_BASE + index),
    );

    // 누락 특약명 집합 (일반 시드 중복 제거용)
    const missingNames = new Set(
      missing.map((clause) => this.normalizeName(clause.clauseName)),
    );

    // 2. 시드 기반 일반 권장 특약 확보
    const seeds = await this.seedSource.getSeeds(contractType, perspective);
    const generalRecommendations = seeds
      .filter((seed) => !missingNames.has(this.normalizeName(seed.clauseName)))
      .map((seed, index) =>
        this.fromSeed(seed, GENERAL_CLAUSE_PRIORITY_BASE + index),
      );

    // 3. 누락 특약이 항상 상단에 오도록 priority 오름차순 정렬
    const recommendations = [
      ...missingRecommendations,
      ...generalRecommendations,
    ].sort((a, b) => a.priority - b.priority);

    return {
      recommendations,
      hasRecommendations: recommendations.length > 0,
    };
  }

  /**
   * 누락 특약을 권장 특약 항목으로 변환한다.
   *
   * 누락 특약은 계약서에 반드시 포함되어야 하는 특약이므로 낮은 priority
   * 값(높은 우선순위)을 부여하여 목록 상단에 배치한다. 시드에 대응하는 문안이
   * 있으면 이를 활용하고, 없으면 누락 특약 설명을 기반으로 기본 문안을 구성한다.
   *
   * @param clause - 누락 필수 특약
   * @param priority - 부여할 우선순위 (작을수록 상위)
   * @returns 권장 특약
   *
   * @requirements 11.3, 11.4, 11.6, 11.7
   */
  private fromMissingClause(
    clause: MissingClause,
    priority: number,
  ): RecommendedClause {
    const legalBasis = this.defaultLegalBasis(clause.clauseName);
    return {
      clauseText: this.buildMissingClauseText(clause),
      reason: `계약서에 「${clause.clauseName}」 특약이 누락되어 있어 추가를 권장합니다. ${clause.description}`.trim(),
      benefit: `해당 특약을 추가하면 ${this.perspectiveLabel(
        clause.perspective,
      )} 입장에서 분쟁 위험을 줄이고 권리를 보호할 수 있습니다.`,
      priority,
      legalBasis,
      isBasisVerified: legalBasis.length > 0,
    };
  }

  /**
   * 시드 데이터를 권장 특약 항목으로 변환한다.
   *
   * 시드에 명시된 근거가 없으면 isBasisVerified=false로 표시하고 일반 근거
   * 안내를 제공한다(요구사항 11.7).
   *
   * @param seed - 권장 특약 시드
   * @param priority - 부여할 우선순위
   * @returns 권장 특약
   *
   * @requirements 11.3, 11.6, 11.7
   */
  private fromSeed(seed: RecommendationSeed, priority: number): RecommendedClause {
    const hasBasis = seed.legalBasis !== undefined && seed.legalBasis.length > 0;
    const legalBasis = hasBasis
      ? seed.legalBasis!
      : this.unverifiedLegalBasis(seed.clauseName);
    return {
      clauseText: seed.clauseText,
      reason: seed.reason,
      benefit: seed.benefit,
      priority,
      legalBasis,
      isBasisVerified: hasBasis,
    };
  }

  /**
   * 누락 특약의 기본 문안을 구성한다.
   *
   * 시드 데이터가 없는 누락 특약에 대해 특약명·설명을 결합한 기본 문안을
   * 생성한다.
   *
   * @param clause - 누락 필수 특약
   * @returns 특약 문안
   */
  private buildMissingClauseText(clause: MissingClause): string {
    const description = clause.description.trim();
    if (description.length > 0) {
      return `${clause.clauseName}: ${description}`;
    }
    return `${clause.clauseName} 관련 특약을 계약서에 명시한다.`;
  }

  /**
   * 근거를 확인할 수 없는 경우 제공하는 일반 근거 안내.
   *
   * 명시적 법조항/판례 근거를 확보하지 못한 추천에 대해 일반 주의사항 형태의
   * 참조를 1건 반환하여 근거 목록이 비어있지 않도록 하되, 호출 측에서
   * isBasisVerified=false로 표시한다.
   *
   * @param clauseName - 특약명
   * @returns 일반 근거 참조 목록
   *
   * @requirements 11.7
   */
  private unverifiedLegalBasis(clauseName: string): LegalReference[] {
    return [
      {
        type: 'law_article',
        summary: `「${clauseName}」에 대한 명시적 법조항 또는 판례 근거를 확인하지 못했습니다. 특약 반영 전 전문가 상담을 권장합니다.`,
      },
    ];
  }

  /**
   * 누락 특약에 부여하는 기본 근거 참조.
   *
   * 민법상 계약 자유의 원칙에 근거하여 특약 추가를 권장하는 일반 근거를
   * 제공한다. 시드에 대응 근거가 없는 누락 특약도 근거 목록이 1건 이상이
   * 되도록 보장한다(요구사항 11.6).
   *
   * @param clauseName - 특약명
   * @returns 근거 참조 목록
   */
  private defaultLegalBasis(clauseName: string): LegalReference[] {
    return [
      {
        type: 'law_article',
        lawName: '민법',
        articleNumber: '제105조',
        summary: `계약 자유의 원칙에 따라 「${clauseName}」 특약을 계약서에 명시하여 당사자 간 권리·의무를 명확히 할 수 있습니다.`,
      },
    ];
  }

  /**
   * 당사자 관점 코드를 한국어 라벨로 변환한다.
   *
   * @param perspective - 당사자 관점
   * @returns 한국어 관점 라벨
   */
  private perspectiveLabel(perspective: PartyPerspective): string {
    switch (perspective) {
      case 'buyer':
        return '매수인';
      case 'seller':
        return '매도인';
      case 'landlord':
        return '임대인';
      case 'tenant':
        return '임차인';
      default:
        return '당사자';
    }
  }

  /**
   * 특약명 비교를 위한 정규화.
   *
   * 공백을 제거하고 소문자화하여 누락 특약과 일반 시드의 중복 판별에 사용한다.
   *
   * @param name - 특약명
   * @returns 정규화된 특약명
   */
  private normalizeName(name: string): string {
    return name.replace(/\s+/g, '').toLowerCase();
  }
}
