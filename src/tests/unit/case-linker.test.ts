/**
 * CaseLinkerModule / CaseSearchClient 단위 테스트
 *
 * 위험 조항별 유사 판례 연동, 조항당 최대 3건 제한, URL 유효성 확인,
 * 10초 타임아웃/오류 시 폴백(caseLinkAvailable=false) 동작을 검증한다.
 *
 * @requirements 7.3, 7.4, 7.5, 7.7
 */

import {
  CaseLinkerModule,
  CASE_LINKER_INPUT_TYPE,
  CASE_LINK_INVALID_INPUT_CODE,
  CASE_LINK_FALLBACK_MESSAGE,
} from '../../modules/contract-analysis/case-linker/index';
import {
  CaseSearchClient,
  MockCaseSearchInvoker,
  isValidFullUrl,
  type CaseSearchHit,
  type CaseSearchInvoker,
} from '../../modules/contract-analysis/case-linker/case-search-client';
import type { RiskClause } from '../../modules/contract-analysis/interfaces/risk-detector';
import type { ModuleInput } from '../../common/interfaces/service-module';

/** 테스트용 위험 조항 생성기 */
function makeRiskClause(clauseId: string, riskType = '과도한 위약금'): RiskClause {
  return {
    clauseId,
    span: {
      clauseId,
      matchedText: `${clauseId} 조항 원문`,
    },
    riskType,
    riskReason: '임차인에게 과도하게 불리한 조건입니다.',
    partyImpact: 'disadvantageous',
    matchSource: 'ruleset',
    isDisadvantageous: true,
  };
}

/** 지정된 판례 목록을 반환하는 스텁 어댑터 */
class StubInvoker implements CaseSearchInvoker {
  constructor(private readonly hits: CaseSearchHit[]) {}
  async searchSimilarCases(): Promise<CaseSearchHit[]> {
    return this.hits;
  }
}

/** 지연 후 응답하는(타임아웃 유발) 어댑터 */
class SlowInvoker implements CaseSearchInvoker {
  constructor(private readonly delayMs: number) {}
  async searchSimilarCases(): Promise<CaseSearchHit[]> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return [];
  }
}

/** 항상 오류를 던지는 어댑터 */
class FailingInvoker implements CaseSearchInvoker {
  async searchSimilarCases(): Promise<CaseSearchHit[]> {
    throw new Error('판례 검색 서비스 오류');
  }
}

describe('isValidFullUrl', () => {
  it('http/https 전체 URL은 유효로 판정한다', () => {
    expect(isValidFullUrl('https://glaw.scourt.go.kr/x')).toBe(true);
    expect(isValidFullUrl('http://example.com')).toBe(true);
  });

  it('전체 URL이 아니면 무효로 판정한다', () => {
    expect(isValidFullUrl('')).toBe(false);
    expect(isValidFullUrl('   ')).toBe(false);
    expect(isValidFullUrl('glaw.scourt.go.kr/x')).toBe(false);
    expect(isValidFullUrl('ftp://example.com')).toBe(false);
    expect(isValidFullUrl('not a url')).toBe(false);
  });
});

describe('CaseSearchClient', () => {
  it('조항당 최대 3건으로 제한한다 (요구사항 7.3)', async () => {
    const hits: CaseSearchHit[] = Array.from({ length: 5 }, (_, i) => ({
      caseNumber: `2020다${1000 + i}`,
      courtName: '대법원',
      judgmentSummary: '요지',
      originalUrl: `https://glaw.scourt.go.kr/x/${i}`,
    }));
    const client = new CaseSearchClient({ invoker: new StubInvoker(hits) });

    const cases = await client.searchForClause(makeRiskClause('c1'));
    expect(cases).toHaveLength(3);
  });

  it('각 판례에 사건번호·법원명·판결요지·원문링크를 매핑한다 (요구사항 7.4)', async () => {
    const client = new CaseSearchClient({
      invoker: new StubInvoker([
        {
          caseNumber: '2021다555',
          courtName: '서울고등법원',
          judgmentSummary: '판결 요지 내용',
          originalUrl: 'https://glaw.scourt.go.kr/case/555',
        },
      ]),
    });

    const [c] = await client.searchForClause(makeRiskClause('c1'));
    expect(c.caseNumber).toBe('2021다555');
    expect(c.courtName).toBe('서울고등법원');
    expect(c.judgmentSummary).toBe('판결 요지 내용');
    expect(c.originalUrl).toBe('https://glaw.scourt.go.kr/case/555');
    expect(c.urlVerified).toBe(true);
  });

  it('유효하지 않은 URL은 urlVerified=false, 링크를 빈 문자열로 대체한다 (요구사항 7.7)', async () => {
    const client = new CaseSearchClient({
      invoker: new StubInvoker([
        {
          caseNumber: '2021다556',
          courtName: '대법원',
          judgmentSummary: '요지',
          originalUrl: 'invalid-link',
        },
      ]),
    });

    const [c] = await client.searchForClause(makeRiskClause('c1'));
    expect(c.urlVerified).toBe(false);
    expect(c.originalUrl).toBe('');
  });

  it('Mock 폴백 어댑터는 조항당 1~3건을 결정적으로 반환한다', async () => {
    const client = new CaseSearchClient({ invoker: new MockCaseSearchInvoker() });
    const cases = await client.searchForClause(makeRiskClause('c1'));
    expect(cases.length).toBeGreaterThanOrEqual(1);
    expect(cases.length).toBeLessThanOrEqual(3);
  });
});

describe('CaseLinkerModule', () => {
  const makeInput = (riskClauses: RiskClause[]): ModuleInput => ({
    type: CASE_LINKER_INPUT_TYPE,
    payload: { riskClauses },
  });

  it('위험 조항별로 판례를 연동하고 caseLinkAvailable=true를 반환한다', async () => {
    const module = new CaseLinkerModule({
      caseSearchClient: new CaseSearchClient({
        invoker: new StubInvoker([
          {
            caseNumber: '2020다1',
            courtName: '대법원',
            judgmentSummary: '요지',
            originalUrl: 'https://glaw.scourt.go.kr/1',
          },
        ]),
      }),
    });

    const result = await module.execute(makeInput([makeRiskClause('c1'), makeRiskClause('c2')]));
    expect(result.success).toBe(true);
    const output = result.data as import('../../modules/contract-analysis/interfaces/case-linker').CaseLinkerOutput;
    expect(output.caseLinkAvailable).toBe(true);
    expect(output.linkedCases).toHaveLength(2);
    expect(output.linkedCases[0].clauseId).toBe('c1');
    expect(output.linkedCases[0].cases[0].caseNumber).toBe('2020다1');
  });

  it('위험 조항이 없으면 판례 호출 없이 빈 목록과 사용 가능 상태를 반환한다', async () => {
    const module = new CaseLinkerModule();
    const result = await module.execute(makeInput([]));
    expect(result.success).toBe(true);
    const output = result.data as import('../../modules/contract-analysis/interfaces/case-linker').CaseLinkerOutput;
    expect(output.linkedCases).toHaveLength(0);
    expect(output.caseLinkAvailable).toBe(true);
  });

  it('10초 타임아웃 초과 시 폴백한다 (요구사항 7.5)', async () => {
    const module = new CaseLinkerModule({
      caseSearchClient: new CaseSearchClient({ invoker: new SlowInvoker(50) }),
      timeoutMs: 10,
    });

    const result = await module.execute(makeInput([makeRiskClause('c1')]));
    expect(result.success).toBe(true);
    const output = result.data as import('../../modules/contract-analysis/interfaces/case-linker').CaseLinkerOutput;
    expect(output.caseLinkAvailable).toBe(false);
    expect(output.linkedCases).toHaveLength(0);
    expect(result.metadata?.notice).toBe(CASE_LINK_FALLBACK_MESSAGE);
  });

  it('판례 서비스 오류 시 예외 없이 폴백한다 (요구사항 7.5)', async () => {
    const module = new CaseLinkerModule({
      caseSearchClient: new CaseSearchClient({ invoker: new FailingInvoker() }),
    });

    const result = await module.execute(makeInput([makeRiskClause('c1')]));
    expect(result.success).toBe(true);
    const output = result.data as import('../../modules/contract-analysis/interfaces/case-linker').CaseLinkerOutput;
    expect(output.caseLinkAvailable).toBe(false);
    expect(result.metadata?.notice).toBe(CASE_LINK_FALLBACK_MESSAGE);
  });

  it('입력 유형이 잘못되면 검증 오류를 반환한다', async () => {
    const module = new CaseLinkerModule();
    const result = await module.execute({ type: 'wrong.type', payload: {} });
    expect(result.success).toBe(false);
    expect(result.errors?.[0].code).toBe(CASE_LINK_INVALID_INPUT_CODE);
  });

  it('riskClauses가 배열이 아니면 검증 오류를 반환한다', async () => {
    const module = new CaseLinkerModule();
    const result = await module.execute({ type: CASE_LINKER_INPUT_TYPE, payload: {} });
    expect(result.success).toBe(false);
    expect(result.errors?.[0].code).toBe(CASE_LINK_INVALID_INPUT_CODE);
  });

  it('모듈 이름과 버전을 반환한다', () => {
    const module = new CaseLinkerModule();
    expect(module.getName()).toBe('case-linker');
    expect(module.getVersion()).toBe('1.0.0');
  });
});
