/**
 * 시뮬레이션 엔진 (simulation-engine) 인터페이스 정의
 *
 * 조항 변경안을 원본과 분리된 가상 계약 상태에 적용하고 위험조항 탐지기·
 * 위험도 평가기를 재실행하여 변경 전/후 종합 등급을 비교하는 엔진의
 * 입출력 타입을 정의한다.
 *
 * 시뮬레이션은 원본과 분리된 가상 계약 상태에서 재실행하며, 원본 계약서
 * 데이터를 변경하지 않는다.
 */

import type { RiskGrade } from './types.js';
import type { GradedRiskClause } from './risk-evaluator.js';

/**
 * 시뮬레이션 엔진 입력
 */
export interface SimulationEngineInput {
  /** 문서 식별자 */
  documentId: string;
  /** 조항 변경안 (1~20개) */
  clauseChanges: ClauseChangeRequest[];
}

/**
 * 조항 변경 요청
 */
export interface ClauseChangeRequest {
  /** 조항 식별자 */
  clauseId: string;
  /** 변경할 새 조항 문구 */
  newText: string;
}

/**
 * 시뮬레이션 엔진 출력
 */
export interface SimulationEngineOutput {
  /** 변경 전 종합 등급 */
  beforeGrade: RiskGrade;
  /** 변경 후 종합 등급 */
  afterGrade: RiskGrade;
  /** 등급 대조 (개선/악화/동일) */
  comparison: 'improved' | 'worsened' | 'same';
  /** 변경 조항 재평가 결과 */
  changedClauseResults: GradedRiskClause[];
}
