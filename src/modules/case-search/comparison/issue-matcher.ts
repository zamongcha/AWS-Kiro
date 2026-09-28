/**
 * @fileoverview 판례 쟁점 매칭 모듈
 * @description 검색된 판례 간 동일 쟁점을 식별하고,
 * 상이한 결론을 가진 판례 쌍을 추출한다.
 *
 * @requirements 4.1 - 동일 쟁점 상이 결론 판례 2건 이상 시 비교 분석 트리거
 * @requirements 4.2 - 조건 미충족 시 비교 분석 생략
 */

import type { CaseSearchResult } from '../interfaces/index.js';

/**
 * 충돌 판례 쌍 인터페이스
 */
export interface ConflictingCasePair {
  /** 공통 쟁점 */
  commonIssue: string;
  /** 충돌하는 판례 목록 */
  cases: CaseSearchResult[];
  /** 대법원/하급심 간 충돌 여부 */
  hasCourtHierarchyConflict: boolean;
}

/**
 * 쟁점 매칭 결과 인터페이스
 */
export interface IssueMatchResult {
  /** 비교 분석 수행 여부 */
  shouldCompare: boolean;
  /** 충돌 판례 쌍 목록 */
  conflictingPairs: ConflictingCasePair[];
}

/**
 * 판례 쟁점 매칭 클래스
 *
 * 검색된 판례의 법적 쟁점을 비교하여 동일 쟁점에서
 * 상이한 결론을 가진 판례 쌍을 식별한다.
 *
 * @requirements 4.1, 4.2
 */
export class IssueMatcher {
  /** 비교 분석 트리거를 위한 최소 충돌 판례 수 */
  private readonly minConflictCases = 2;

  /**
   * 판례 목록에서 충돌하는 판례 쌍을 식별한다.
   *
   * @param cases - 검색된 판례 목록
   * @returns 쟁점 매칭 결과
   */
  findConflictingCases(cases: CaseSearchResult[]): IssueMatchResult {
    if (cases.length < this.minConflictCases) {
      return { shouldCompare: false, conflictingPairs: [] };
    }

    const conflictingPairs = this.identifyConflicts(cases);

    return {
      shouldCompare: conflictingPairs.length > 0,
      conflictingPairs,
    };
  }

  /**
   * 판례 간 충돌을 식별한다.
   *
   * 동일 분쟁 유형에서 법원 판단이 다른 판례를 그룹화한다.
   */
  private identifyConflicts(cases: CaseSearchResult[]): ConflictingCasePair[] {
    const pairs: ConflictingCasePair[] = [];

    // 분쟁 유형별로 그룹화
    const byType = new Map<string, CaseSearchResult[]>();
    for (const c of cases) {
      const existing = byType.get(c.caseType) || [];
      existing.push(c);
      byType.set(c.caseType, existing);
    }

    // 동일 유형 내에서 결론이 다른 판례 식별
    for (const [type, typeCases] of byType.entries()) {
      if (typeCases.length < this.minConflictCases) continue;

      // 판결 요지(summary)의 결론 키워드로 상이한 결론 감지
      const groups = this.groupByConclusion(typeCases);

      if (groups.length >= 2) {
        // 최소 2개 그룹이 있으면 결론이 다른 판례 존재
        const conflictCases = groups.flatMap((g) => g);
        const hasCourtHierarchyConflict = this.detectCourtHierarchyConflict(conflictCases);

        const disputeTypeNames: Record<string, string> = {
          lease: '임대차 분쟁',
          sale: '매매 분쟁',
          registration: '등기 분쟁',
          brokerage: '중개 분쟁',
          redevelopment: '재건축/재개발 분쟁',
        };

        pairs.push({
          commonIssue: disputeTypeNames[type] || type,
          cases: conflictCases.slice(0, 4), // 최대 4건 비교
          hasCourtHierarchyConflict,
        });
      }
    }

    return pairs;
  }

  /**
   * 판례를 결론별로 그룹화한다.
   *
   * 원고 승소/패소 키워드 기반 분류.
   */
  private groupByConclusion(cases: CaseSearchResult[]): CaseSearchResult[][] {
    const positiveKeywords = ['인용', '승소', '인정', '청구 인용', '원고 승'];
    const negativeKeywords = ['기각', '패소', '각하', '청구 기각', '원고 패'];

    const positive: CaseSearchResult[] = [];
    const negative: CaseSearchResult[] = [];
    const neutral: CaseSearchResult[] = [];

    for (const c of cases) {
      const summaryLower = c.summary.toLowerCase();
      if (positiveKeywords.some((kw) => summaryLower.includes(kw))) {
        positive.push(c);
      } else if (negativeKeywords.some((kw) => summaryLower.includes(kw))) {
        negative.push(c);
      } else {
        neutral.push(c);
      }
    }

    const groups: CaseSearchResult[][] = [];
    if (positive.length > 0) groups.push(positive);
    if (negative.length > 0) groups.push(negative);
    if (neutral.length > 0 && groups.length < 2) groups.push(neutral);

    return groups;
  }

  /**
   * 대법원/하급심 간 결론 차이 여부를 감지한다.
   */
  private detectCourtHierarchyConflict(cases: CaseSearchResult[]): boolean {
    const hasSupreme = cases.some((c) => c.courtLevel === 'supreme');
    const hasLower = cases.some((c) => c.courtLevel === 'lower');
    return hasSupreme && hasLower;
  }
}
