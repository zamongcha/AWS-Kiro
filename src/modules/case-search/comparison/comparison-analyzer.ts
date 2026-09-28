/**
 * @fileoverview 비교 분석기
 * @description 동일 쟁점에서 상이한 결론을 가진 판례를 비교 분석한다.
 * Bedrock Claude 3.5 Sonnet을 호출하여 사실관계 차이점,
 * 판단 근거 차이, 결론이 달라진 핵심 요인을 분석한다.
 *
 * @requirements 4.3 - 사실관계 차이점 분석
 * @requirements 4.4 - 판단 근거 차이 분석
 * @requirements 4.5 - 대법원/하급심 간 결론 상이 시 courtHierarchyNote 포함
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  ComparisonResult,
  ComparedCase,
  CaseSearchResult,
} from '../interfaces/index.js';
import type { ConflictingCasePair } from './issue-matcher.js';

/**
 * 비교 분석기 설정
 */
export interface ComparisonAnalyzerConfig {
  /** AWS 리전 */
  region?: string;
  /** Bedrock 모델 ID */
  modelId?: string;
  /** 최대 토큰 수 */
  maxTokens?: number;
}

/**
 * 비교 분석기 클래스
 *
 * 동일 쟁점에서 상이한 결론을 가진 판례를 비교 분석한다.
 *
 * @requirements 4.3, 4.4, 4.5
 */
export class ComparisonAnalyzer {
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly maxTokens: number;

  constructor(
    config?: ComparisonAnalyzerConfig,
    deps?: { bedrockClient?: BedrockRuntimeClient },
  ) {
    this.modelId = config?.modelId ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    this.maxTokens = config?.maxTokens ?? 4096;

    this.bedrockClient = deps?.bedrockClient ?? new BedrockRuntimeClient({
      region: config?.region ?? 'ap-northeast-2',
    });
  }

  /**
   * 비교 분석을 수행한다.
   *
   * @param conflictPair - 충돌하는 판례 쌍 정보
   * @returns 비교 분석 결과 또는 null (분석 불가 시)
   */
  async analyze(conflictPair: ConflictingCasePair): Promise<ComparisonResult | null> {
    if (conflictPair.cases.length < 2) {
      return null;
    }

    try {
      const prompt = this.buildComparisonPrompt(conflictPair);
      const response = await this.invokeModel(prompt);
      return this.parseComparisonResponse(response, conflictPair);
    } catch {
      // LLM 호출 실패 시 기본 비교 결과 반환
      return this.buildFallbackComparison(conflictPair);
    }
  }

  /**
   * 비교 분석 프롬프트를 생성한다.
   */
  private buildComparisonPrompt(conflictPair: ConflictingCasePair): string {
    const caseSummaries = conflictPair.cases
      .map((c, i) => `### 판례 ${i + 1}
- 사건번호: ${c.caseNumber}
- 법원: ${c.courtName} (${c.courtLevel === 'supreme' ? '대법원' : '하급심'})
- 선고일자: ${c.judgmentDate}
- 판결 요지: ${c.summary.substring(0, 1000)}`)
      .join('\n\n');

    return `다음 판례들은 "${conflictPair.commonIssue}" 쟁점에서 서로 다른 결론을 내린 사례들이에요.
각 판례의 사실관계 차이점, 판단 근거 차이, 결론이 달라진 핵심 요인을 분석해 주세요.
한국어 존댓말(해요체)로 답변해 주세요.

${caseSummaries}

## 요청사항
다음 JSON 형식으로 분석 결과를 반환해 주세요:
{
  "comparedCases": [
    {
      "caseNumber": "사건번호",
      "conclusion": "결론 요약",
      "reasoningBasis": "판단 근거",
      "factualDifference": "사실관계 차이점"
    }
  ],
  "differentiatingFactors": ["결론이 달라진 핵심 요인 1", "핵심 요인 2"]
}`;
  }

  /**
   * Bedrock 모델을 호출한다.
   */
  private async invokeModel(prompt: string): Promise<string> {
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.maxTokens,
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
   * LLM 응답을 파싱한다.
   */
  private parseComparisonResponse(
    responseText: string,
    conflictPair: ConflictingCasePair,
  ): ComparisonResult {
    let parsed: Record<string, unknown> = {};

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // 파싱 실패 시 기본값 사용
    }

    const comparedCases: ComparedCase[] = conflictPair.cases.map((c, i) => {
      const parsedCase = Array.isArray(parsed['comparedCases'])
        ? (parsed['comparedCases'] as Record<string, string>[])[i]
        : undefined;

      return {
        caseNumber: c.caseNumber,
        courtName: c.courtName,
        courtLevel: c.courtLevel,
        judgmentDate: c.judgmentDate,
        conclusion: parsedCase?.conclusion || c.summary.substring(0, 200),
        reasoningBasis: parsedCase?.reasoningBasis || '판단 근거를 분석 중입니다.',
        factualDifference: parsedCase?.factualDifference || '사실관계 차이점을 분석 중입니다.',
      };
    });

    const differentiatingFactors = Array.isArray(parsed['differentiatingFactors'])
      ? (parsed['differentiatingFactors'] as string[])
      : ['판례 간 결론 차이의 핵심 요인을 분석 중입니다.'];

    const result: ComparisonResult = {
      commonIssue: conflictPair.commonIssue,
      comparedCases,
      differentiatingFactors,
    };

    if (conflictPair.hasCourtHierarchyConflict) {
      result.courtHierarchyNote = '대법원과 하급심의 결론이 다른 사안이에요. ' +
        '일반적으로 대법원 판례가 법적 구속력이 더 강하므로 대법원 판결을 우선 참고하시기 바랍니다.';
    }

    return result;
  }

  /**
   * LLM 호출 실패 시 기본 비교 결과를 생성한다.
   */
  private buildFallbackComparison(conflictPair: ConflictingCasePair): ComparisonResult {
    const comparedCases: ComparedCase[] = conflictPair.cases.map((c) => ({
      caseNumber: c.caseNumber,
      courtName: c.courtName,
      courtLevel: c.courtLevel,
      judgmentDate: c.judgmentDate,
      conclusion: c.summary.substring(0, 200),
      reasoningBasis: '상세 분석을 위해 원문을 확인해 주세요.',
      factualDifference: '사실관계 차이점 분석에 일시적 오류가 발생했습니다.',
    }));

    const result: ComparisonResult = {
      commonIssue: conflictPair.commonIssue,
      comparedCases,
      differentiatingFactors: ['상세 비교 분석에 일시적 오류가 발생했습니다.'],
    };

    if (conflictPair.hasCourtHierarchyConflict) {
      result.courtHierarchyNote = '대법원과 하급심의 결론이 다른 사안이에요. ' +
        '대법원 판결을 우선 참고하시기 바랍니다.';
    }

    return result;
  }
}
