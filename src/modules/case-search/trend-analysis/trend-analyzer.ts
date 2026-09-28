/**
 * @fileoverview 트렌드 분석기
 * @description 특정 분쟁 유형의 판결 경향 변화를 시간순으로 분석한다.
 * 해당 분쟁유형 판례 5건 이상일 때만 분석을 수행하며,
 * Bedrock Claude 3.5 Sonnet을 호출하여 판결 방향 변화와 법령 개정 영향을 분석한다.
 *
 * @requirements 5.1 - 해당 분쟁유형 판례 5건 이상 시 분석 수행
 * @requirements 5.2 - 5건 미만 시 insufficientData=true, 분석 생략
 * @requirements 5.3 - 최근 5년 판례 조회
 * @requirements 5.4 - 시간순 판결 방향 변화 분석
 * @requirements 5.5 - 관련 법령 개정 영향 분석
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import type {
  TrendInput,
  TrendResult,
  TrendChange,
  LawChange,
  DisputeType,
  CaseSearchResult,
} from '../interfaces/index.js';

/**
 * 트렌드 분석기 설정
 */
export interface TrendAnalyzerConfig {
  /** AWS 리전 */
  region?: string;
  /** Bedrock 모델 ID */
  modelId?: string;
  /** OpenSearch 엔드포인트 */
  openSearchEndpoint?: string;
  /** 판례 인덱스명 */
  caseIndex?: string;
  /** 분석 트리거 최소 판례 수 (기본값: 5) */
  minCasesForAnalysis?: number;
  /** 분석 기간 (년, 기본값: 5) */
  defaultPeriodYears?: number;
}

/**
 * 트렌드 분석기 클래스
 *
 * 특정 분쟁 유형의 판결 경향 변화를 시간순으로 분석한다.
 *
 * @requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export class TrendAnalyzer {
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly openSearchClient: OpenSearchClient | null;
  private readonly modelId: string;
  private readonly caseIndex: string;
  private readonly minCasesForAnalysis: number;
  private readonly defaultPeriodYears: number;

  constructor(
    config?: TrendAnalyzerConfig,
    deps?: {
      bedrockClient?: BedrockRuntimeClient;
      openSearchClient?: OpenSearchClient;
    },
  ) {
    this.modelId = config?.modelId ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    this.caseIndex = config?.caseIndex ?? 'court-cases';
    this.minCasesForAnalysis = config?.minCasesForAnalysis ?? 5;
    this.defaultPeriodYears = config?.defaultPeriodYears ?? 5;

    this.bedrockClient = deps?.bedrockClient ?? new BedrockRuntimeClient({
      region: config?.region ?? 'ap-northeast-2',
    });

    if (deps?.openSearchClient) {
      this.openSearchClient = deps.openSearchClient;
    } else if (config?.openSearchEndpoint) {
      this.openSearchClient = new OpenSearchClient({
        node: config.openSearchEndpoint,
        ssl: { rejectUnauthorized: true },
      });
    } else {
      this.openSearchClient = null;
    }
  }

  /**
   * 트렌드 분석을 수행한다.
   *
   * @param input - 트렌드 분석 입력
   * @returns 트렌드 분석 결과
   */
  async analyze(input: TrendInput): Promise<TrendResult> {
    const periodYears = input.periodYears ?? this.defaultPeriodYears;
    const now = new Date();
    const fromDate = new Date();
    fromDate.setFullYear(now.getFullYear() - periodYears);

    // 해당 분쟁유형 판례 조회
    const cases = await this.fetchCasesByType(input.disputeType, fromDate);

    // 5건 미만 시 데이터 부족 반환
    if (cases.length < this.minCasesForAnalysis) {
      return {
        disputeType: input.disputeType,
        analysisPeriod: {
          from: fromDate.toISOString().split('T')[0],
          to: now.toISOString().split('T')[0],
        },
        totalCasesAnalyzed: cases.length,
        trendDescription: '해당 분쟁 유형의 판례가 충분하지 않아 트렌드 분석을 제공할 수 없습니다.',
        timelineChanges: [],
        insufficientData: true,
      };
    }

    // LLM 기반 트렌드 분석
    try {
      const prompt = this.buildTrendPrompt(input, cases, fromDate, now);
      const response = await this.invokeModel(prompt);
      return this.parseTrendResponse(response, input, cases.length, fromDate, now);
    } catch {
      return this.buildFallbackTrend(input, cases.length, fromDate, now);
    }
  }

  /**
   * 해당 분쟁유형의 최근 N년 판례를 조회한다.
   */
  private async fetchCasesByType(
    disputeType: DisputeType,
    fromDate: Date,
  ): Promise<CaseSearchResult[]> {
    if (!this.openSearchClient) {
      return [];
    }

    try {
      const response = await this.openSearchClient.search({
        index: this.caseIndex,
        body: {
          size: 100,
          query: {
            bool: {
              filter: [
                { term: { case_type: disputeType } },
                { range: { judgment_date: { gte: fromDate.toISOString().split('T')[0] } } },
              ],
            },
          },
          sort: [{ judgment_date: { order: 'asc' } }],
          _source: ['case_number', 'court_name', 'court_level', 'judgment_date', 'case_type', 'chunk_content'],
        },
      });

      const hits = (response.body as Record<string, unknown>)?.hits as Record<string, unknown>;
      const hitArray = (hits?.hits as Record<string, unknown>[]) ?? [];

      return hitArray.map((hit) => {
        const source = hit['_source'] as Record<string, unknown>;
        return {
          caseId: hit['_id'] as string,
          caseNumber: (source['case_number'] as string) ?? '',
          courtName: (source['court_name'] as string) ?? '',
          courtLevel: ((source['court_level'] as string) ?? 'lower') as 'supreme' | 'lower',
          judgmentDate: (source['judgment_date'] as string) ?? '',
          caseType: ((source['case_type'] as string) ?? disputeType) as DisputeType,
          summary: ((source['chunk_content'] as string) ?? '').substring(0, 500),
          fullText: (source['chunk_content'] as string) ?? '',
          referencedLaws: [],
          similarityScore: 0,
          matchedFacts: [],
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * 트렌드 분석 프롬프트를 생성한다.
   */
  private buildTrendPrompt(
    input: TrendInput,
    cases: CaseSearchResult[],
    fromDate: Date,
    toDate: Date,
  ): string {
    const caseSummaries = cases
      .slice(0, 20) // 최대 20건만 프롬프트에 포함
      .map((c) => `- ${c.judgmentDate} | ${c.courtName} | ${c.caseNumber}: ${c.summary.substring(0, 200)}`)
      .join('\n');

    const disputeTypeNames: Record<string, string> = {
      lease: '임대차', sale: '매매', registration: '등기',
      brokerage: '중개', redevelopment: '재건축/재개발',
    };

    return `다음은 "${disputeTypeNames[input.disputeType] || input.disputeType}" 분쟁 유형에 대한
${fromDate.toISOString().split('T')[0]}부터 ${toDate.toISOString().split('T')[0]}까지의 판례 목록이에요.
판결 경향 변화와 관련 법령 개정 영향을 시간순으로 분석해 주세요.

## 관련 쟁점: ${input.relatedIssue}

## 판례 목록 (${cases.length}건)
${caseSummaries}

## 요청사항
다음 JSON 형식으로 분석 결과를 반환해 주세요:
{
  "trendDescription": "전체 판결 경향 변화 설명",
  "timelineChanges": [
    { "period": "2020~2021", "direction": "판결 방향 설명", "representativeCases": ["사건번호1"] }
  ],
  "relatedLawChanges": [
    { "lawName": "법령명", "changeDate": "2021-01-01", "description": "개정 내용", "impactOnTrend": "트렌드 영향" }
  ]
}`;
  }

  /**
   * Bedrock 모델을 호출한다.
   */
  private async invokeModel(prompt: string): Promise<string> {
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      body: new TextEncoder().encode(body),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await this.bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.content?.[0]?.text ?? '';
  }

  /**
   * LLM 응답을 파싱하여 TrendResult로 변환한다.
   */
  private parseTrendResponse(
    responseText: string,
    input: TrendInput,
    totalCases: number,
    fromDate: Date,
    toDate: Date,
  ): TrendResult {
    let parsed: Record<string, unknown> = {};

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // 파싱 실패 시 기본값 사용
    }

    const timelineChanges: TrendChange[] = Array.isArray(parsed['timelineChanges'])
      ? (parsed['timelineChanges'] as Record<string, unknown>[]).map((tc) => ({
          period: (tc['period'] as string) || '',
          direction: (tc['direction'] as string) || '',
          representativeCases: Array.isArray(tc['representativeCases'])
            ? (tc['representativeCases'] as string[])
            : [],
        }))
      : [];

    const relatedLawChanges: LawChange[] | undefined = Array.isArray(parsed['relatedLawChanges'])
      ? (parsed['relatedLawChanges'] as Record<string, unknown>[]).map((lc) => ({
          lawName: (lc['lawName'] as string) || '',
          changeDate: (lc['changeDate'] as string) || '',
          description: (lc['description'] as string) || '',
          impactOnTrend: (lc['impactOnTrend'] as string) || '',
        }))
      : undefined;

    return {
      disputeType: input.disputeType,
      analysisPeriod: {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      },
      totalCasesAnalyzed: totalCases,
      trendDescription: (parsed['trendDescription'] as string) || '판결 경향 분석 결과를 확인해 주세요.',
      timelineChanges,
      relatedLawChanges,
      insufficientData: false,
    };
  }

  /**
   * LLM 호출 실패 시 기본 트렌드 결과를 반환한다.
   */
  private buildFallbackTrend(
    input: TrendInput,
    totalCases: number,
    fromDate: Date,
    toDate: Date,
  ): TrendResult {
    return {
      disputeType: input.disputeType,
      analysisPeriod: {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      },
      totalCasesAnalyzed: totalCases,
      trendDescription: '트렌드 분석 중 일시적 오류가 발생했습니다.',
      timelineChanges: [],
      insufficientData: false,
    };
  }
}
