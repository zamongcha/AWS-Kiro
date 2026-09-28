/**
 * 위험도 평가기 (risk-evaluator) 인터페이스 정의
 *
 * 탐지된 위험 조항에 위험도 등급(상/중/하)을 부여하고 종합 위험도를
 * 산출하며, 등기부 대조 결과 기반 전세사기 위험 점수를 반영하는
 * 평가기의 입출력 타입을 정의한다.
 */

import type { RiskGrade } from './types.js';
import type { RiskClause } from './risk-detector.js';
import type { RegistryMatchResult } from './registry-matcher.js';

/**
 * 위험도 평가기 입력
 */
export interface RiskEvaluatorInput {
  /** 위험 조항 목록 */
  riskClauses: RiskClause[];
  /** 등기부 대조 결과 (전세사기 점수 반영) */
  registryResult?: RegistryMatchResult;
}

/**
 * 위험도 평가기 출력
 */
export interface RiskEvaluatorOutput {
  /** 등급이 부여된 위험 조항 목록 */
  gradedClauses: GradedRiskClause[];
  /** 종합 위험도 등급 (개별 등급 중 최고 등급) */
  overallGrade: RiskGrade;
  /** 전세사기 위험 점수 (등기부 대조 시) */
  fraudScore?: FraudRiskScore;
}

/**
 * 등급이 부여된 위험 조항
 */
export interface GradedRiskClause {
  /** 조항 식별자 */
  clauseId: string;
  /** 위험도 등급 */
  grade: RiskGrade;
  /** 등급 산출에 적용한 판정 기준 */
  gradeCriteria: string;
  /** 등급 미확정 시 상으로 처리 */
  isGradeUndetermined: boolean;
  /** 등급-색상 매핑 (상=red, 중=yellow, 하=green) */
  colorMapping: 'red' | 'yellow' | 'green';
}

/**
 * 전세사기 위험 점수
 */
export interface FraudRiskScore {
  /** 위험 점수 (0~100 정수) */
  score: number;
  /** 전세가율 (%) */
  jeonseRatio: number;
  /** 선순위 채권 비율 (%) */
  seniorClaimRatio: number;
  /** 초과된 고위험 기준 */
  exceededCriteria: ExceededCriterion[];
  /** 소유자 불일치 경고 */
  ownerMismatch: boolean;
}

/**
 * 초과된 고위험 기준
 */
export interface ExceededCriterion {
  /** 기준 이름 */
  name: 'jeonse_ratio' | 'senior_claim_ratio' | 'fraud_score';
  /** 기준값 (전세가율 80, 선순위 60, 점수 70) */
  threshold: number;
  /** 실제 수치 */
  actual: number;
}
