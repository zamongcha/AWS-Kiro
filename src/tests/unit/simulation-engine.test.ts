/**
 * 시뮬레이션 엔진 단위 테스트
 *
 * SimulationEngineModule / Simulator의 핵심 동작을 예시 기반으로 검증한다.
 *   - 입력 개수 제한(Property 32): 0개/21개 거부, 1개/20개 허용
 *   - 원본 무변경(Property 33): 실행 후 입력 변경안 불변
 *   - 등급 대조(Property 34): 개선/악화/동일 판정
 *   - 타임아웃/재실행 실패 시 오류 및 원본·변경안 보존(요구사항 13.7)
 */

import {
  SimulationEngineModule,
  Simulator,
  SimulationInputCountError,
  SimulationTimeoutError,
  SIMULATION_ENGINE_INPUT_TYPE,
  SIMULATION_INPUT_COUNT_CODE,
  SIMULATION_TIMEOUT_CODE,
  SIMULATION_ERROR_CODE,
  SIMULATION_INVALID_INPUT_CODE,
  type OriginalGradeProvider,
  type SimulationRerunner,
  type RerunResult,
} from '../../modules/contract-analysis/simulation-engine';
import type { RiskGrade } from '../../modules/contract-analysis/interfaces/types';
import type { ClauseChangeRequest } from '../../modules/contract-analysis/interfaces/simulation-engine';

/** 고정 등급을 반환하는 스텁 조회기 */
class StubGradeProvider implements OriginalGradeProvider {
  constructor(private readonly grade: RiskGrade) {}
  async getOriginalGrade(): Promise<RiskGrade> {
    return this.grade;
  }
}

/** 고정 재실행 결과를 반환하는 스텁 재실행기 */
class StubRerunner implements SimulationRerunner {
  public receivedChanges: ClauseChangeRequest[] | null = null;
  constructor(private readonly result: RerunResult) {}
  async rerun(
    _documentId: string,
    virtualChanges: ClauseChangeRequest[],
  ): Promise<RerunResult> {
    this.receivedChanges = virtualChanges;
    return this.result;
  }
}

/** 항상 실패하는 재실행기 */
class FailingRerunner implements SimulationRerunner {
  async rerun(): Promise<RerunResult> {
    throw new Error('재탐지 저장소 접근 실패');
  }
}

/** 지정 시간 후 완료되는 재실행기 (타임아웃 검증용) */
class SlowRerunner implements SimulationRerunner {
  constructor(private readonly delayMs: number, private readonly result: RerunResult) {}
  async rerun(): Promise<RerunResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.result;
  }
}

const makeChanges = (n: number): ClauseChangeRequest[] =>
  Array.from({ length: n }, (_, i) => ({
    clauseId: `c${i}`,
    newText: `변경 문구 ${i}`,
  }));

const okRerun = (afterGrade: RiskGrade): RerunResult => ({
  afterGrade,
  changedClauseResults: [],
});

describe('Simulator - 입력 개수 제한 (Property 32)', () => {
  const build = () =>
    new Simulator({
      originalGradeProvider: new StubGradeProvider('medium'),
      rerunner: new StubRerunner(okRerun('medium')),
    });

  it('0개(빈) 변경안은 거부한다', async () => {
    await expect(
      build().simulate({ documentId: 'doc1', clauseChanges: [] }),
    ).rejects.toBeInstanceOf(SimulationInputCountError);
  });

  it('21개 변경안은 거부한다', async () => {
    await expect(
      build().simulate({ documentId: 'doc1', clauseChanges: makeChanges(21) }),
    ).rejects.toBeInstanceOf(SimulationInputCountError);
  });

  it('1개 변경안은 처리한다', async () => {
    const result = await build().simulate({
      documentId: 'doc1',
      clauseChanges: makeChanges(1),
    });
    expect(result.afterGrade).toBe('medium');
  });

  it('20개 변경안은 처리한다', async () => {
    const result = await build().simulate({
      documentId: 'doc1',
      clauseChanges: makeChanges(20),
    });
    expect(result.afterGrade).toBe('medium');
  });
});

describe('Simulator - 원본 무변경 (Property 33)', () => {
  it('실행 후 입력 변경안 배열과 원소가 변경되지 않는다', async () => {
    const rerunner = new StubRerunner(okRerun('low'));
    const sim = new Simulator({
      originalGradeProvider: new StubGradeProvider('high'),
      rerunner,
    });
    const changes = makeChanges(3);
    const snapshot = JSON.parse(JSON.stringify(changes));

    await sim.simulate({ documentId: 'doc1', clauseChanges: changes });

    // 원본 입력 불변
    expect(changes).toEqual(snapshot);
    // 재실행기에 전달된 것은 원본과 다른 인스턴스(깊은 복사본)
    expect(rerunner.receivedChanges).not.toBe(changes);
    expect(rerunner.receivedChanges?.[0]).not.toBe(changes[0]);
    expect(rerunner.receivedChanges).toEqual(changes);
  });
});

describe('Simulator - 등급 대조 (Property 34)', () => {
  const compareWith = (before: RiskGrade, after: RiskGrade) =>
    new Simulator({
      originalGradeProvider: new StubGradeProvider(before),
      rerunner: new StubRerunner(okRerun(after)),
    }).simulate({ documentId: 'doc1', clauseChanges: makeChanges(1) });

  it('한 단계 낮아지면 개선', async () => {
    const r = await compareWith('high', 'medium');
    expect(r.comparison).toBe('improved');
  });

  it('두 단계 낮아져도 개선', async () => {
    const r = await compareWith('high', 'low');
    expect(r.comparison).toBe('improved');
  });

  it('한 단계 높아지면 악화', async () => {
    const r = await compareWith('low', 'medium');
    expect(r.comparison).toBe('worsened');
  });

  it('변화가 없으면 동일', async () => {
    const r = await compareWith('medium', 'medium');
    expect(r.comparison).toBe('same');
  });
});

describe('Simulator - 타임아웃 및 재실행 실패 (요구사항 13.7)', () => {
  it('재실행이 타임아웃을 초과하면 SimulationTimeoutError를 던진다', async () => {
    const sim = new Simulator({
      originalGradeProvider: new StubGradeProvider('medium'),
      rerunner: new SlowRerunner(50, okRerun('low')),
      timeoutMs: 10,
    });
    await expect(
      sim.simulate({ documentId: 'doc1', clauseChanges: makeChanges(1) }),
    ).rejects.toBeInstanceOf(SimulationTimeoutError);
  });

  it('재실행 실패 시 원본 입력 변경안이 보존된다', async () => {
    const sim = new Simulator({
      originalGradeProvider: new StubGradeProvider('medium'),
      rerunner: new FailingRerunner(),
    });
    const changes = makeChanges(2);
    const snapshot = JSON.parse(JSON.stringify(changes));
    await expect(
      sim.simulate({ documentId: 'doc1', clauseChanges: changes }),
    ).rejects.toThrow();
    expect(changes).toEqual(snapshot);
  });
});

describe('SimulationEngineModule - ServiceModule 계약', () => {
  const buildModule = (rerunner: SimulationRerunner, before: RiskGrade = 'high') =>
    new SimulationEngineModule({
      simulatorConfig: {
        originalGradeProvider: new StubGradeProvider(before),
        rerunner,
      },
    });

  it('정상 입력 시 success=true와 등급 대조 결과를 반환한다', async () => {
    const mod = buildModule(new StubRerunner(okRerun('medium')));
    const out = await mod.execute({
      type: SIMULATION_ENGINE_INPUT_TYPE,
      payload: { documentId: 'doc1', clauseChanges: makeChanges(2) },
    });
    expect(out.success).toBe(true);
    const data = out.data as { comparison: string; beforeGrade: RiskGrade };
    expect(data.beforeGrade).toBe('high');
    expect(data.comparison).toBe('improved');
  });

  it('개수 초과 시 입력 오류 코드를 반환하고 재시도를 요청하지 않는다', async () => {
    const mod = buildModule(new StubRerunner(okRerun('medium')));
    const out = await mod.execute({
      type: SIMULATION_ENGINE_INPUT_TYPE,
      payload: { documentId: 'doc1', clauseChanges: makeChanges(21) },
    });
    expect(out.success).toBe(false);
    expect(out.errors?.[0].code).toBe(SIMULATION_INPUT_COUNT_CODE);
    expect(out.errors?.[0].context?.retryRequested).toBe(false);
  });

  it('빈 변경안도 입력 오류 코드를 반환한다', async () => {
    const mod = buildModule(new StubRerunner(okRerun('medium')));
    const out = await mod.execute({
      type: SIMULATION_ENGINE_INPUT_TYPE,
      payload: { documentId: 'doc1', clauseChanges: [] },
    });
    expect(out.success).toBe(false);
    expect(out.errors?.[0].code).toBe(SIMULATION_INPUT_COUNT_CODE);
  });

  it('재실행 실패 시 재시도 요청 및 원본/변경안 보존 플래그를 반환한다', async () => {
    const mod = buildModule(new FailingRerunner());
    const out = await mod.execute({
      type: SIMULATION_ENGINE_INPUT_TYPE,
      payload: { documentId: 'doc1', clauseChanges: makeChanges(1) },
    });
    expect(out.success).toBe(false);
    expect(out.errors?.[0].code).toBe(SIMULATION_ERROR_CODE);
    expect(out.errors?.[0].context?.retryRequested).toBe(true);
    expect(out.errors?.[0].context?.originalPreserved).toBe(true);
    expect(out.errors?.[0].context?.changesPreserved).toBe(true);
  });

  it('타임아웃 시 타임아웃 오류 코드를 반환한다', async () => {
    const mod = new SimulationEngineModule({
      simulatorConfig: {
        originalGradeProvider: new StubGradeProvider('medium'),
        rerunner: new SlowRerunner(50, okRerun('low')),
        timeoutMs: 10,
      },
    });
    const out = await mod.execute({
      type: SIMULATION_ENGINE_INPUT_TYPE,
      payload: { documentId: 'doc1', clauseChanges: makeChanges(1) },
    });
    expect(out.success).toBe(false);
    expect(out.errors?.[0].code).toBe(SIMULATION_TIMEOUT_CODE);
  });

  it('알 수 없는 입력 유형은 입력 형식 오류를 반환한다', async () => {
    const mod = buildModule(new StubRerunner(okRerun('medium')));
    const out = await mod.execute({
      type: 'unknown.type',
      payload: { documentId: 'doc1', clauseChanges: makeChanges(1) },
    });
    expect(out.success).toBe(false);
    expect(out.errors?.[0].code).toBe(SIMULATION_INVALID_INPUT_CODE);
  });

  it('documentId 누락 시 입력 형식 오류를 반환한다', async () => {
    const mod = buildModule(new StubRerunner(okRerun('medium')));
    const out = await mod.execute({
      type: SIMULATION_ENGINE_INPUT_TYPE,
      payload: { clauseChanges: makeChanges(1) },
    });
    expect(out.success).toBe(false);
    expect(out.errors?.[0].code).toBe(SIMULATION_INVALID_INPUT_CODE);
  });

  it('getName/getVersion을 반환한다', () => {
    const mod = buildModule(new StubRerunner(okRerun('medium')));
    expect(mod.getName()).toBe('simulation-engine');
    expect(mod.getVersion()).toBe('1.0.0');
  });
});
