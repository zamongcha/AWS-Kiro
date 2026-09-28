/**
 * 위험도 등급 부여기 (GradeAssigner)
 *
 * 탐지된 위험 조항에 위험도 등급(상/중/하)을 정확히 하나 부여하고, 개별
 * 등급으로부터 종합 위험도 등급을 산출하며, 등급-색상 매핑을 제공하는 책임을
 * 담당한다.
 *
 * 주요 규칙:
 *   - Property 12: 각 조항 등급은 {상(high), 중(medium), 하(low)} 중 정확히
 *     하나여야 한다. 등급이 부여되지 않거나 유효값 이외의 값이 산출되면 해당
 *     조항은 "상"(high)으로 처리하고 등급 미확정(isGradeUndetermined=true)을
 *     표시한다.
 *   - Property 13: 종합 등급은 개별 등급 중 최고 등급(상>중>하)이며, 위험 조항이
 *     0건이면 "하"(low)로 산출한다. 등기부 대조로 전세사기 고위험 기준이
 *     초과되면 종합 등급을 "상"(high)으로 상향한다.
 *   - Property 14: 등급-색상은 상=red, 중=yellow, 하=green으로 1:1(전단사)
 *     매핑한다.
 *
 * @module GradeAssigner
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.10
 */

import type { RiskGrade } from '../interfaces/index.js';
import type {
  GradedRiskClause,
  FraudRiskScore,
} from '../interfaces/index.js';
import type { RiskClause } from '../interfaces/index.js';

/** 유효 위험도 등급 집합 */
export const VALID_GRADES: readonly RiskGrade[] = ['high', 'medium', 'low'];

/**
 * 위험도 등급 순위 (높을수록 위험).
 *
 * 종합 등급 산출 시 최고 등급 비교에 사용한다. (상 > 중 > 하)
 */
export const GRADE_RANK: Record<RiskGrade, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * 등급-색상 매핑 (Property 14: 상=red, 중=yellow, 하=green).
 */
export const GRADE_COLOR_MAP: Record<RiskGrade, 'red' | 'yellow' | 'green'> = {
  high: 'red',
  medium: 'yellow',
  low: 'green',
};

/** 등급 미부여/이상값 시 적용하는 기본 등급 */
export const FALLBACK_GRADE: RiskGrade = 'high';

/** 등급 미확정 시 사용하는 판정 기준 안내 문구 */
export const UNDETERMINED_GRADE_CRITERIA =
  '위험도 등급이 부여되지 않았거나 유효하지 않은 값이 산출되어, 안전을 위해 "상"으로 처리했습니다. (등급 미확정)';

/**
 * 등급 부여 입력용 위험 조항 확장.
 *
 * `RiskClause`에는 등급 정보가 없으므로, 상위 평가 로직(예: 룰별 심각도 매핑,
 * LLM 판정)이 산출한 등급을 선택적으로 전달받는다. 값이 없거나 유효하지 않으면
 * Property 12에 따라 "상"(high) + 미확정으로 처리한다.
 */
export interface GradeAssignmentInput extends RiskClause {
  /**
   * 사전 산출된 위험도 등급 (선택).
   *
   * 값이 없거나 {high, medium, low} 이외의 값이면 미확정으로 간주한다.
   */
  proposedGrade?: RiskGrade | string | null;
  /** 등급 산출에 적용한 판정 기준 (선택, 없으면 기본 문구 사용) */
  proposedCriteria?: string;
}

/**
 * 위험도 등급 부여기
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.10
 */
export class GradeAssigner {
  /**
   * 단일 위험 조항에 위험도 등급을 부여한다.
   *
   * 사전 산출된 등급(proposedGrade)이 유효한 {high, medium, low} 값이면 그대로
   * 사용하고, 없거나 유효하지 않으면 "상"(high)으로 처리하며 등급 미확정
   * (isGradeUndetermined=true)을 표시한다. 부여 결과에는 항상 판정 기준
   * (gradeCriteria)과 등급-색상 매핑(colorMapping)을 포함한다.
   *
   * @param clause - 등급 부여 대상 위험 조항 (등급 정보 포함 가능)
   * @returns 등급이 부여된 위험 조항
   *
   * @requirements 4.1, 4.2, 4.5, 4.10
   */
  assignClauseGrade(clause: GradeAssignmentInput): GradedRiskClause {
    const isValid = this.isValidGrade(clause.proposedGrade);
    const grade: RiskGrade = isValid
      ? (clause.proposedGrade as RiskGrade)
      : FALLBACK_GRADE;

    const gradeCriteria = isValid
      ? this.resolveCriteria(clause.proposedCriteria, clause.riskReason)
      : UNDETERMINED_GRADE_CRITERIA;

    return {
      clauseId: clause.clauseId,
      grade,
      gradeCriteria,
      isGradeUndetermined: !isValid,
      colorMapping: GRADE_COLOR_MAP[grade],
    };
  }

  /**
   * 위험 조항 목록 전체에 등급을 부여한다.
   *
   * @param clauses - 등급 부여 대상 위험 조항 목록
   * @returns 등급이 부여된 위험 조항 목록
   *
   * @requirements 4.1, 4.2
   */
  assignGrades(clauses: GradeAssignmentInput[]): GradedRiskClause[] {
    return clauses.map((clause) => this.assignClauseGrade(clause));
  }

  /**
   * 종합 위험도 등급을 산출한다.
   *
   * 위험 조항이 0건이면 "하"(low)로 산출한다. 비어있지 않으면 개별 조항 등급 중
   * 가장 높은 등급(상>중>하)을 반환한다. 전세사기 위험 점수가 주입되어 고위험
   * 기준이 초과된 경우(exceededCriteria가 하나 이상)에는 종합 등급을
   * "상"(high)으로 상향한다.
   *
   * @param gradedClauses - 등급이 부여된 위험 조항 목록
   * @param fraudScore - 전세사기 위험 점수 (선택, 등기부 대조 시)
   * @returns 종합 위험도 등급
   *
   * @requirements 4.3, 4.4
   */
  computeOverallGrade(
    gradedClauses: GradedRiskClause[],
    fraudScore?: FraudRiskScore,
  ): RiskGrade {
    // 등기부 대조 결과 반영: 전세사기 고위험 기준 초과 시 종합 등급 상향
    if (fraudScore && fraudScore.exceededCriteria.length > 0) {
      return 'high';
    }

    // Property 13: 위험 조항 0건이면 종합 등급은 "하"(low)
    if (gradedClauses.length === 0) {
      return 'low';
    }

    // Property 13: 개별 등급 중 최고 등급(상>중>하)
    return gradedClauses.reduce<RiskGrade>((highest, clause) => {
      return GRADE_RANK[clause.grade] > GRADE_RANK[highest]
        ? clause.grade
        : highest;
    }, 'low');
  }

  /**
   * 위험도 등급에 대응하는 색상을 반환한다 (Property 14).
   *
   * @param grade - 위험도 등급
   * @returns 등급-색상 매핑 (red/yellow/green)
   *
   * @requirements 4.5
   */
  mapColor(grade: RiskGrade): 'red' | 'yellow' | 'green' {
    return GRADE_COLOR_MAP[grade];
  }

  /**
   * 주어진 값이 유효한 위험도 등급({high, medium, low})인지 판정한다.
   *
   * @param value - 검사할 값
   * @returns 유효한 등급이면 true
   */
  private isValidGrade(value: unknown): value is RiskGrade {
    return (
      typeof value === 'string' &&
      (VALID_GRADES as readonly string[]).includes(value)
    );
  }

  /**
   * 판정 기준 문구를 결정한다.
   *
   * 명시적으로 전달된 기준(proposedCriteria)이 비어있지 않으면 이를 사용하고,
   * 없으면 위험 사유(riskReason)를 기준으로 삼되, 둘 다 비어있으면 일반 안내
   * 문구를 반환하여 항상 비어있지 않도록 보장한다.
   *
   * @param proposedCriteria - 사전 산출된 판정 기준 (선택)
   * @param riskReason - 위험 사유
   * @returns 판정 기준 문구
   *
   * @requirements 4.10
   */
  private resolveCriteria(
    proposedCriteria: string | undefined,
    riskReason: string,
  ): string {
    if (proposedCriteria && proposedCriteria.trim().length > 0) {
      return proposedCriteria;
    }
    if (riskReason && riskReason.trim().length > 0) {
      return riskReason;
    }
    return '위험 조항 특성에 근거하여 등급을 부여했습니다.';
  }
}
