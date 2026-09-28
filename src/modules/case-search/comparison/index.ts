/**
 * @fileoverview 비교 분석 모듈
 * @description 동일 쟁점에서 상이한 결론을 가진 판례 간 비교 분석을 수행하는
 * 모듈의 진입점이다. IssueMatcher와 ComparisonAnalyzer를 조합하여
 * 충돌 판례 식별 → 비교 분석 파이프라인을 제공한다.
 *
 * @requirements 4.1 - 동일 쟁점 상이 결론 판례 2건 이상 시 비교 분석 트리거
 * @requirements 4.2 - 조건 미충족 시 비교 분석 생략 (null 반환)
 * @requirements 4.3 - 사실관계 차이점 분석
 * @requirements 4.4 - 판단 근거 차이 분석
 * @requirements 4.5 - 대법원/하급심 간 courtHierarchyNote 포함
 */

import type { CaseSearchResult, ComparisonResult } from '../interfaces/index.js';
import { IssueMatcher } from './issue-matcher.js';
import { ComparisonAnalyzer, ComparisonAnalyzerConfig } from './comparison-analyzer.js';

/**
 * 비교 분석 모듈 설정
 */
export interface ComparisonModuleConfig {
  /** ComparisonAnalyzer 설정 */
  analyzerConfig?: ComparisonAnalyzerConfig;
}

/**
 * 비교 분석 모듈 클래스
 *
 * 검색된 판례 목록에서 충돌하는 판례 쌍을 식별하고,
 * LLM 기반 비교 분석을 수행한다.
 *
 * 처리 흐름:
 * 1. IssueMatcher로 충돌 판례 식별
 * 2. 충돌 있으면 ComparisonAnalyzer로 비교 분석 수행
 * 3. 충돌 없으면 null 반환 (비교 분석 생략)
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */
export class ComparisonModule {
  private readonly issueMatcher: IssueMatcher;
  private readonly analyzer: ComparisonAnalyzer;

  constructor(
    config?: ComparisonModuleConfig,
    deps?: {
      issueMatcher?: IssueMatcher;
      analyzer?: ComparisonAnalyzer;
    },
  ) {
    this.issueMatcher = deps?.issueMatcher ?? new IssueMatcher();
    this.analyzer = deps?.analyzer ?? new ComparisonAnalyzer(config?.analyzerConfig);
  }

  /**
   * 비교 분석을 수행한다.
   *
   * @param cases - 검색된 판례 목록
   * @returns 비교 분석 결과 또는 null (조건 미충족 시)
   */
  async compare(cases: CaseSearchResult[]): Promise<ComparisonResult | null> {
    // 1. 충돌 판례 식별
    const matchResult = this.issueMatcher.findConflictingCases(cases);

    // 2. 비교 분석 트리거 조건 확인
    if (!matchResult.shouldCompare || matchResult.conflictingPairs.length === 0) {
      return null;
    }

    // 3. 첫 번째 충돌 쌍에 대해 비교 분석 수행
    const primaryConflict = matchResult.conflictingPairs[0];
    return this.analyzer.analyze(primaryConflict);
  }

  /**
   * 비교 분석 수행 여부를 빠르게 판별한다 (LLM 호출 없이).
   *
   * @param cases - 검색된 판례 목록
   * @returns 비교 분석 수행 여부
   */
  shouldCompare(cases: CaseSearchResult[]): boolean {
    const matchResult = this.issueMatcher.findConflictingCases(cases);
    return matchResult.shouldCompare;
  }

  getName(): string {
    return 'comparison';
  }

  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { IssueMatcher } from './issue-matcher.js';
export { ComparisonAnalyzer } from './comparison-analyzer.js';
export type { ConflictingCasePair, IssueMatchResult } from './issue-matcher.js';
export type { ComparisonAnalyzerConfig } from './comparison-analyzer.js';
