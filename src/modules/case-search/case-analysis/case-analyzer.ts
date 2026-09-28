/**
 * @fileoverview 판례 분석기
 * @description Bedrock Claude 3.5 Sonnet을 호출하여 개별 판례를 분석한다.
 * 판결 요지, 핵심 쟁점, 판결 이유, 실무 시사점을 추출하고
 * 사용자 상황과의 유사점/차이점을 비교한다.
 *
 * @requirements 3.1 - 판결 요지, 핵심 쟁점, 판결 이유, 실무 시사점 추출
 * @requirements 3.2 - 사용자 상황과의 유사점/차이점 비교
 * @requirements 3.3 - 법률 용어 부연 설명
 * @requirements 3.4 - 한국어 존댓말(해요체) 응답
 * @requirements 3.5 - 면책 고지 포함
 * @requirements 9.2 - Bedrock Claude 3.5 Sonnet 활용
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  IndividualCaseAnalysis,
  CaseSearchResult,
  FactAnalysisOutput,
} from '../interfaces/index.js';

/**
 * 판례 분석기 설정
 */
export interface CaseAnalyzerConfig {
  /** AWS 리전 (기본값: 'ap-northeast-2') */
  region?: string;
  /** Bedrock 모델 ID */
  modelId?: string;
  /** 최대 토큰 수 */
  maxTokens?: number;
}

/**
 * 판례 분석기 클래스
 *
 * Bedrock Claude 3.5 Sonnet을 호출하여 개별 판례를 심층 분석한다.
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 9.2
 */
export class CaseAnalyzer {
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly maxTokens: number;

  constructor(
    config?: CaseAnalyzerConfig,
    deps?: { bedrockClient?: BedrockRuntimeClient },
  ) {
    this.modelId = config?.modelId ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    this.maxTokens = config?.maxTokens ?? 4096;

    this.bedrockClient = deps?.bedrockClient ?? new BedrockRuntimeClient({
      region: config?.region ?? 'ap-northeast-2',
    });
  }

  /**
   * 개별 판례를 분석한다.
   *
   * @param caseResult - 검색된 판례 결과
   * @param userSituation - 사용자 상황 분석 결과
   * @returns 개별 판례 분석 결과
   */
  async analyzeSingleCase(
    caseResult: CaseSearchResult,
    userSituation: FactAnalysisOutput,
  ): Promise<IndividualCaseAnalysis> {
    const prompt = this.buildAnalysisPrompt(caseResult, userSituation);

    try {
      const response = await this.invokeModel(prompt);
      return this.parseAnalysisResponse(response, caseResult.caseNumber);
    } catch {
      // LLM 호출 실패 시 기본 분석 반환
      return this.buildFallbackAnalysis(caseResult);
    }
  }

  /**
   * 여러 판례를 병렬로 분석한다.
   *
   * @param cases - 검색된 판례 목록
   * @param userSituation - 사용자 상황 분석 결과
   * @returns 개별 판례 분석 결과 목록
   */
  async analyzeMultipleCases(
    cases: CaseSearchResult[],
    userSituation: FactAnalysisOutput,
  ): Promise<IndividualCaseAnalysis[]> {
    const analyses = await Promise.allSettled(
      cases.map((c) => this.analyzeSingleCase(c, userSituation)),
    );

    return analyses
      .filter((r): r is PromiseFulfilledResult<IndividualCaseAnalysis> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  /**
   * 분석 프롬프트를 생성한다.
   */
  private buildAnalysisPrompt(
    caseResult: CaseSearchResult,
    userSituation: FactAnalysisOutput,
  ): string {
    return `당신은 부동산 법률 전문가입니다. 다음 판례를 분석하고, 사용자의 상황과 비교해 주세요.
한국어 존댓말(해요체)로 답변하며, 법률 용어에는 쉬운 설명을 괄호로 추가해 주세요.

## 사용자 상황
- 분쟁 유형: ${userSituation.disputeTypes.join(', ')}
- 핵심 사실관계: ${userSituation.keyFacts.join('; ')}
- 법적 쟁점: ${userSituation.legalIssues.join('; ')}

## 분석 대상 판례
- 사건번호: ${caseResult.caseNumber}
- 법원: ${caseResult.courtName} (${caseResult.courtLevel === 'supreme' ? '대법원' : '하급심'})
- 선고일자: ${caseResult.judgmentDate}
- 참조 법령: ${caseResult.referencedLaws.join(', ') || '없음'}
- 판결 내용:
${caseResult.fullText.substring(0, 3000)}

## 요청사항
다음 JSON 형식으로 분석 결과를 반환해 주세요:
{
  "judgmentSummary": "판결 요지를 3~5문장으로 요약",
  "keyIssues": ["핵심 쟁점 1", "핵심 쟁점 2"],
  "judgmentReason": "판결 이유를 상세히 설명",
  "practicalImplication": "이 판례의 실무적 시사점",
  "similarities": ["사용자 상황과의 유사점 1", "유사점 2"],
  "differences": ["사용자 상황과의 차이점 1", "차이점 2"]
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
   * LLM 응답을 파싱하여 IndividualCaseAnalysis 구조로 변환한다.
   */
  private parseAnalysisResponse(
    responseText: string,
    caseNumber: string,
  ): IndividualCaseAnalysis {
    try {
      // JSON 블록 추출
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON 응답을 찾을 수 없습니다.');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        caseNumber,
        judgmentSummary: parsed.judgmentSummary || '판결 요지를 분석 중입니다.',
        keyIssues: Array.isArray(parsed.keyIssues) && parsed.keyIssues.length > 0
          ? parsed.keyIssues
          : ['핵심 쟁점 분석 중'],
        judgmentReason: parsed.judgmentReason || '판결 이유를 분석 중입니다.',
        practicalImplication: parsed.practicalImplication || '실무 시사점을 분석 중입니다.',
        similarityToUser: {
          similarities: Array.isArray(parsed.similarities) && parsed.similarities.length > 0
            ? parsed.similarities
            : ['유사점을 분석 중입니다.'],
          differences: Array.isArray(parsed.differences) && parsed.differences.length > 0
            ? parsed.differences
            : ['차이점을 분석 중입니다.'],
        },
      };
    } catch {
      return {
        caseNumber,
        judgmentSummary: responseText.substring(0, 500) || '판결 요지를 분석 중입니다.',
        keyIssues: ['판례 분석 결과를 구조화하는 중입니다.'],
        judgmentReason: '판결 이유 분석이 완료되지 않았습니다.',
        practicalImplication: '실무 시사점 분석이 완료되지 않았습니다.',
        similarityToUser: {
          similarities: ['유사점 분석이 완료되지 않았습니다.'],
          differences: ['차이점 분석이 완료되지 않았습니다.'],
        },
      };
    }
  }

  /**
   * LLM 호출 실패 시 기본 분석을 생성한다.
   */
  private buildFallbackAnalysis(caseResult: CaseSearchResult): IndividualCaseAnalysis {
    return {
      caseNumber: caseResult.caseNumber,
      judgmentSummary: caseResult.summary.substring(0, 300) || '판결 요지를 확인할 수 없습니다.',
      keyIssues: ['판례 상세 분석에 일시적 오류가 발생했습니다.'],
      judgmentReason: '판결 이유를 확인하려면 원문을 참조해 주세요.',
      practicalImplication: '원문 판례를 직접 확인하시는 것을 권장합니다.',
      similarityToUser: {
        similarities: [`사실관계 유사도: ${(caseResult.similarityScore * 100).toFixed(0)}%`],
        differences: ['상세 비교 분석이 완료되지 않았습니다.'],
      },
    };
  }
}
