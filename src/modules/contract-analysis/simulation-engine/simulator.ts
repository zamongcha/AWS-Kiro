/**
 * 협상 시나리오 시뮬레이터 (Simulator)
 *
 * 사용자가 입력한 조항 변경안을 원본 계약서와 분리된 가상 계약 상태에 적용한
 * 뒤, 위험조항 탐지기·위험도 평가기를 재실행하여 변경 후 종합 위험도 등급을
 * 산출하고, 변경 전/후 등급을 대조하여 개선/악화/동일을 판정하는 책임을
 * 담당한다.
 *
 * 주요 규칙:
 *   - Property 32: 조항 변경안은 최소 1개에서 최대 20개까지만 처리한다.
 *     비어있거나(0개) 20개를 초과하면 입력 오류로 거부하고 시뮬레이션을
 *     수행하지 않는다.
 *   - Property 33: 시뮬레이션은 원본 계약서와 분리된 가상 계약 상태(깊은 복사)
 *     에서 수행하며, 실행 전후 원본 계약서 데이터 상태를 변경하지 않는다.
 *   - Property 34: 변경 후 종합 등급이 변경 전 대비 한 단계 이상 낮아지면
 *     "개선"(improved), 한 단계 이상 높아지면 "악화"(worsened), 등급 변화가
 *     없으면 "동일"(same)로 판정한다.
 *
 * 위험조항 탐지기·위험도 평가기 재실행은 의존성 주입으로 받은
 * `SimulationRerunner`를 통해 수행하여, 실제 모듈 구현과 분리한다. 재실행은
 * 30초 타임아웃으로 통제되며, 실패/타임아웃 시 원본 계약서 데이터와 사용자가
 * 입력한 변경안을 보존한 채 오류를 전파한다.
 *
 * @module Simulator
 * @requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
 */

import type { RiskGrade } from '../interfaces/index.js';
import type {
  ClauseChangeRequest,
  GradedRiskClause,
} from '../interfaces/index.js';
import { GRADE_RANK } from '../risk-evaluator/index.js';

/** 시뮬레이션 최소 변경 조항 수 (요구사항 13.1) */
export const MIN_CLAUSE_CHANGES = 1;

/** 시뮬레이션 최대 변경 조항 수 (요구사항 13.1) */
export const MAX_CLAUSE_CHANGES = 20;

/** 시뮬레이션 재실행 타임아웃 (밀리초). 요구사항 13.3, 13.7: 30초 이내 */
export const SIMULATION_TIMEOUT_MS = 30_000;

/**
 * 등급 대조 결과.
 *
 * 개선 | 악화 | 동일
 */
export type GradeComparison = 'improved' | 'worsened' | 'same';

/**
 * 원본과 분리된 가상 계약 상태에서 위험조항 탐지기·위험도 평가기를 재실행한
 * 결과.
 *
 * 실제 재탐지·재평가 로직은 시뮬레이션 엔진 외부(오케스트레이터 또는 각 모듈)
 * 에서 수행하며, 본 시뮬레이터는 이 결과를 받아 변경 후 종합 등급과 등급 대조
 * 판정을 담당한다.
 */
export interface RerunResult {
  /** 변경 조항을 반영한 변경 후 종합 위험도 등급 */
  afterGrade: RiskGrade;
  /** 변경 조항에 대한 재평가 결과 */
  changedClauseResults: GradedRiskClause[];
}

/**
 * 위험조항 탐지기·위험도 평가기 재실행 추상화.
 *
 * 가상 계약 상태(깊은 복사된 조항 변경안)를 입력으로 받아 재탐지·재평가를
 * 수행하고 변경 후 종합 등급을 산출한다. 실제 구현은
 * `RiskDetectorModule`/`RiskEvaluatorModule`을 조합하여 주입한다.
 */
export interface SimulationRerunner {
  /**
   * 가상 계약 상태에 대해 위험조항 탐지기·위험도 평가기를 재실행한다.
   *
   * @param documentId - 문서 식별자
   * @param virtualChanges - 원본과 분리된 가상 조항 변경안 (깊은 복사본)
   * @returns 재실행 결과 (변경 후 종합 등급 및 변경 조항 재평가 결과)
   */
  rerun(
    documentId: string,
    virtualChanges: ClauseChangeRequest[],
  ): Promise<RerunResult>;
}

/**
 * 원본 계약 상태 조회 추상화.
 *
 * 변경 전 종합 위험도 등급을 조회한다. 실제 구현은 기존 분석 결과 저장소
 * (DynamoDB 등)에서 원본 종합 등급을 읽어 주입한다.
 */
export interface OriginalGradeProvider {
  /**
   * 원본 계약서의 변경 전 종합 위험도 등급을 조회한다.
   *
   * @param documentId - 문서 식별자
   * @returns 변경 전 종합 위험도 등급
   */
  getOriginalGrade(documentId: string): Promise<RiskGrade>;
}

/**
 * 시뮬레이터 실행 입력.
 *
 * 표준 `SimulationEngineInput`과 동형이나, 시뮬레이터 내부 로직에서 사용하는
 * 최소 형태로 별도 선언한다.
 */
export interface SimulationRunInput {
  /** 문서 식별자 */
  documentId: string;
  /** 조항 변경안 (1~20개) */
  clauseChanges: ClauseChangeRequest[];
}

/**
 * 시뮬레이터 실행 결과.
 */
export interface SimulationRunResult {
  /** 변경 전 종합 등급 */
  beforeGrade: RiskGrade;
  /** 변경 후 종합 등급 */
  afterGrade: RiskGrade;
  /** 등급 대조 (개선/악화/동일) */
  comparison: GradeComparison;
  /** 변경 조항 재평가 결과 */
  changedClauseResults: GradedRiskClause[];
}

/**
 * 시뮬레이션 입력 개수 오류 (Property 32, 요구사항 13.6).
 *
 * 조항 변경안이 비어있거나(0개) 상한(20개)을 초과할 때 발생한다.
 */
export class SimulationInputCountError extends Error {
  constructor(actual: number) {
    super(
      `변경할 조항은 ${MIN_CLAUSE_CHANGES}개 이상 ${MAX_CLAUSE_CHANGES}개 이하로 입력해 주세요. (입력: ${actual}개)`,
    );
    this.name = 'SimulationInputCountError';
  }
}

/**
 * 시뮬레이션 재실행 타임아웃 오류 (요구사항 13.3, 13.7).
 *
 * 재실행이 설정된 타임아웃(기본 30초)을 초과했음을 나타낸다.
 */
export class SimulationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`시뮬레이션 재실행이 ${timeoutMs}ms 타임아웃을 초과했습니다.`);
    this.name = 'SimulationTimeoutError';
  }
}

/**
 * 시뮬레이터 설정.
 */
export interface SimulatorConfig {
  /** 변경 전 종합 등급 조회기 */
  originalGradeProvider: OriginalGradeProvider;
  /** 위험조항 탐지기·위험도 평가기 재실행기 */
  rerunner: SimulationRerunner;
  /** 재실행 타임아웃 (밀리초, 기본 30000) */
  timeoutMs?: number;
}

/**
 * 협상 시나리오 시뮬레이터.
 *
 * @requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
 */
export class Simulator {
  private readonly originalGradeProvider: OriginalGradeProvider;
  private readonly rerunner: SimulationRerunner;
  private readonly timeoutMs: number;

  constructor(config: SimulatorConfig) {
    this.originalGradeProvider = config.originalGradeProvider;
    this.rerunner = config.rerunner;
    this.timeoutMs = config.timeoutMs ?? SIMULATION_TIMEOUT_MS;
  }

  /**
   * 조항 변경안에 대한 시뮬레이션을 수행한다.
   *
   * 처리 흐름:
   *   1. 변경안 개수 검증 (Property 32) — 위반 시 `SimulationInputCountError`
   *   2. 원본과 분리된 가상 계약 상태 구성 (깊은 복사, Property 33)
   *   3. 변경 전 종합 등급 조회
   *   4. 30초 타임아웃 내 재탐지·재평가 재실행 (Property 34의 afterGrade 산출)
   *   5. 변경 전/후 등급 대조 판정 (Property 34)
   *
   * 어떤 경로에서도 입력으로 받은 `input.clauseChanges` 배열과 그 원소는
   * 변경하지 않으며(원본 및 변경안 보존, 요구사항 13.7), 재실행에는 항상
   * 깊은 복사본을 전달한다.
   *
   * @param input - 시뮬레이터 실행 입력
   * @returns 시뮬레이션 결과
   * @throws {SimulationInputCountError} 변경안이 0개이거나 20개 초과일 때
   * @throws {SimulationTimeoutError} 재실행이 타임아웃을 초과할 때
   *
   * @requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
   */
  async simulate(input: SimulationRunInput): Promise<SimulationRunResult> {
    // Property 32 / 요구사항 13.6: 변경안 개수 검증 (비어있거나 20개 초과 거부)
    this.assertValidChangeCount(input.clauseChanges);

    // Property 33 / 요구사항 13.2: 원본과 분리된 가상 상태(깊은 복사) 구성
    const virtualChanges = this.buildVirtualState(input.clauseChanges);

    // 변경 전 종합 등급 조회
    const beforeGrade = await this.originalGradeProvider.getOriginalGrade(
      input.documentId,
    );

    // 요구사항 13.3, 13.4, 13.7: 30초 이내 재탐지·재평가 재실행
    const rerun = await this.withTimeout(
      this.rerunner.rerun(input.documentId, virtualChanges),
      this.timeoutMs,
    );

    // Property 34 / 요구사항 13.5: 변경 전/후 등급 대조
    const comparison = this.compareGrades(beforeGrade, rerun.afterGrade);

    return {
      beforeGrade,
      afterGrade: rerun.afterGrade,
      comparison,
      changedClauseResults: rerun.changedClauseResults,
    };
  }

  /**
   * 조항 변경안 개수가 유효 범위(1~20개)인지 검증한다 (Property 32).
   *
   * 비어있거나(0개) 상한(20개)을 초과하면 `SimulationInputCountError`를 던져
   * 시뮬레이션을 수행하지 않는다.
   *
   * @param clauseChanges - 조항 변경안 목록
   * @throws {SimulationInputCountError} 개수가 유효 범위를 벗어날 때
   *
   * @requirements 13.1, 13.6
   */
  assertValidChangeCount(clauseChanges: ClauseChangeRequest[]): void {
    const count = Array.isArray(clauseChanges) ? clauseChanges.length : 0;
    if (count < MIN_CLAUSE_CHANGES || count > MAX_CLAUSE_CHANGES) {
      throw new SimulationInputCountError(count);
    }
  }

  /**
   * 조항 변경안을 원본과 분리된 가상 계약 상태(깊은 복사본)로 구성한다
   * (Property 33).
   *
   * 반환된 배열과 원소는 입력과 독립적인 새 객체이므로, 가상 상태에 대한 이후
   * 처리가 원본 입력을 변경하지 않는다.
   *
   * @param clauseChanges - 원본 조항 변경안 목록
   * @returns 깊은 복사된 가상 조항 변경안 목록
   *
   * @requirements 13.2
   */
  buildVirtualState(
    clauseChanges: ClauseChangeRequest[],
  ): ClauseChangeRequest[] {
    return clauseChanges.map((change) => ({
      clauseId: change.clauseId,
      newText: change.newText,
    }));
  }

  /**
   * 변경 전/후 종합 위험도 등급을 대조하여 개선/악화/동일을 판정한다
   * (Property 34).
   *
   * 등급 순위(상>중>하)를 기준으로, 변경 후 등급이 한 단계 이상 낮아지면
   * "개선"(improved), 한 단계 이상 높아지면 "악화"(worsened), 등급 변화가
   * 없으면 "동일"(same)로 판정한다.
   *
   * @param beforeGrade - 변경 전 종합 등급
   * @param afterGrade - 변경 후 종합 등급
   * @returns 등급 대조 결과
   *
   * @requirements 13.4, 13.5
   */
  compareGrades(
    beforeGrade: RiskGrade,
    afterGrade: RiskGrade,
  ): GradeComparison {
    const beforeRank = GRADE_RANK[beforeGrade];
    const afterRank = GRADE_RANK[afterGrade];
    if (afterRank < beforeRank) {
      return 'improved';
    }
    if (afterRank > beforeRank) {
      return 'worsened';
    }
    return 'same';
  }

  /**
   * 주어진 Promise가 타임아웃 내에 완료되지 않으면 타임아웃 오류를 던진다.
   *
   * 타이머는 성공/실패와 무관하게 항상 정리된다. 타임아웃 발생 시에도 입력
   * (원본 및 변경안)은 변경되지 않는다.
   *
   * @param promise - 감싸질 재실행 작업 Promise
   * @param timeoutMs - 타임아웃 (밀리초)
   * @returns 작업 결과
   *
   * @requirements 13.3, 13.7
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new SimulationTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
    }) as Promise<T>;
  }
}
