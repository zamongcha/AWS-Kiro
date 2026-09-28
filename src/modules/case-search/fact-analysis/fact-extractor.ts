/**
 * @fileoverview 사실관계 추출기
 * @description Bedrock Claude 3.5 Sonnet을 호출하여 사용자 상황 설명에서
 * 사실관계를 추출한다. 분쟁유형, 당사자관계, 핵심사실, 법적쟁점을 구조화하여 반환한다.
 *
 * @requirements 1.2 - 사실관계 추출 (분쟁유형, 당사자관계, 핵심사실, 법적쟁점)
 * @requirements 1.4 - LLM 기반 구조화된 법적 요소 추출
 * @requirements 9.2 - Bedrock Claude 3.5 Sonnet 활용
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { DisputeType, PartyRelation } from '../interfaces/index.js';
import type { FactAnalysisOutput } from '../interfaces/index.js';
import type { ConversationEntry } from '../../../common/interfaces/data-models.js';
import { DisputeClassifier } from './dispute-classifier.js';
import { SearchQueryBuilder } from './search-query-builder.js';
import { SynonymDictionary } from '../../search/synonym-dictionary.js';

/**
 * 사실관계 추출기 설정
 */
export interface FactExtractorConfig {
  /** AWS 리전 (기본값: 'us-east-1') */
  region?: string;
  /** Bedrock 모델 ID (기본값: 'anthropic.claude-3-5-sonnet-20241022-v2:0') */
  modelId?: string;
  /** 요청 타임아웃 (밀리초, 기본값: 30000) */
  timeoutMs?: number;
}

/**
 * LLM으로부터 추출된 원시 사실관계
 */
interface RawFactExtraction {
  disputeTypes: string[];
  parties: {
    parties: string[];
    relationship: string;
  };
  keyFacts: string[];
  legalIssues: string[];
}

/**
 * 사실관계 추출기 클래스
 *
 * Bedrock Claude 3.5 Sonnet을 호출하여 사용자 상황 설명에서
 * 구조화된 사실관계를 추출한다.
 *
 * 처리 흐름:
 * 1. LLM 호출하여 사실관계 JSON 추출
 * 2. 응답 파싱 및 검증
 * 3. DisputeClassifier를 통한 분쟁 유형 보강
 * 4. SearchQueryBuilder를 통한 검색 쿼리 생성
 *
 * @requirements 1.2, 1.4, 9.2
 */
export class FactExtractor {
  private readonly bedrockClient: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly disputeClassifier: DisputeClassifier;
  private readonly searchQueryBuilder: SearchQueryBuilder;

  /**
   * FactExtractor 생성자
   *
   * @param config - 추출기 설정
   * @param deps - 의존 모듈 주입 (테스트용)
   */
  constructor(
    config?: FactExtractorConfig,
    deps?: {
      disputeClassifier?: DisputeClassifier;
      searchQueryBuilder?: SearchQueryBuilder;
      synonymDictionary?: SynonymDictionary;
    },
  ) {
    const region = config?.region ?? 'us-east-1';
    this.modelId = config?.modelId ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    this.timeoutMs = config?.timeoutMs ?? 30000;

    this.bedrockClient = new BedrockRuntimeClient({ region });
    this.disputeClassifier = deps?.disputeClassifier ?? new DisputeClassifier();

    const synonymDictionary = deps?.synonymDictionary ?? new SynonymDictionary();
    this.searchQueryBuilder = deps?.searchQueryBuilder ?? new SearchQueryBuilder(synonymDictionary);
  }

  /**
   * 사용자 상황 설명에서 사실관계를 추출한다.
   *
   * @param situationDescription - 사용자 상황 설명
   * @param sessionContext - 이전 대화 컨텍스트 (선택)
   * @returns 사실관계 분석 결과
   *
   * @example
   * ```typescript
   * const extractor = new FactExtractor();
   * const result = await extractor.extract(
   *   "임대인이 계약 만료 후 보증금 3억을 돌려주지 않습니다. 확정일자도 받았고, 전입신고도 했습니다."
   * );
   * ```
   */
  async extract(
    situationDescription: string,
    sessionContext?: ConversationEntry[],
  ): Promise<FactAnalysisOutput> {
    // LLM 호출하여 사실관계 추출
    const rawExtraction = await this.callLLM(situationDescription, sessionContext);

    // 키워드 기반 분쟁 유형 분류로 보강
    const keywordClassification = this.disputeClassifier.classify(situationDescription);

    // LLM 결과와 키워드 분류 결과를 병합하여 최종 분쟁 유형 결정
    const disputeTypes = this.mergeDisputeTypes(
      rawExtraction.disputeTypes,
      keywordClassification.disputeTypes,
    );

    // 부동산 분쟁 여부 판별
    const isRealEstateDispute = disputeTypes.length > 0 || keywordClassification.isRealEstateDispute;

    // 검색 쿼리 생성
    const searchQueries = this.searchQueryBuilder.buildQueries(
      rawExtraction.keyFacts,
      rawExtraction.legalIssues,
      disputeTypes,
    );

    return {
      disputeTypes,
      parties: rawExtraction.parties as PartyRelation,
      keyFacts: rawExtraction.keyFacts,
      legalIssues: rawExtraction.legalIssues,
      searchQueries,
      isRealEstateDispute,
    };
  }

  /**
   * Bedrock Claude 3.5 Sonnet을 호출하여 사실관계를 추출한다.
   *
   * @param situationDescription - 사용자 상황 설명
   * @param sessionContext - 이전 대화 컨텍스트
   * @returns 원시 사실관계 추출 결과
   */
  private async callLLM(
    situationDescription: string,
    sessionContext?: ConversationEntry[],
  ): Promise<RawFactExtraction> {
    const prompt = this.buildPrompt(situationDescription, sessionContext);

    const requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.timeoutMs);

    try {
      const response = await this.bedrockClient.send(command, {
        abortSignal: abortController.signal,
      });

      if (!response.body) {
        throw new Error('Bedrock 응답 본문이 비어있습니다.');
      }

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body),
      );

      const content = responseBody.content?.[0]?.text ?? '';
      return this.parseResponse(content);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`사실관계 분석 타임아웃: ${this.timeoutMs}ms 초과`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * LLM 프롬프트를 구성한다.
   *
   * @param situationDescription - 사용자 상황 설명
   * @param sessionContext - 이전 대화 컨텍스트
   * @returns 구성된 프롬프트 문자열
   */
  private buildPrompt(
    situationDescription: string,
    sessionContext?: ConversationEntry[],
  ): string {
    let contextSection = '';
    if (sessionContext && sessionContext.length > 0) {
      const contextLines = sessionContext.map(
        (entry) => `사용자: ${entry.question}\n분석: ${entry.answer}`,
      );
      contextSection = `\n\n## 이전 대화 컨텍스트\n${contextLines.join('\n\n')}`;
    }

    return `당신은 부동산 법률 전문가입니다. 아래 사용자의 상황 설명에서 법적 사실관계를 분석하여 JSON 형식으로 반환해 주세요.
${contextSection}

## 사용자 상황 설명
${situationDescription}

## 추출 요청 사항
아래 JSON 형식으로 정확히 반환해 주세요:

\`\`\`json
{
  "disputeTypes": ["분쟁유형1", "분쟁유형2"],
  "parties": {
    "parties": ["당사자1", "당사자2"],
    "relationship": "당사자 간 관계 설명"
  },
  "keyFacts": ["핵심 사실관계 1", "핵심 사실관계 2"],
  "legalIssues": ["법적 쟁점 1", "법적 쟁점 2"]
}
\`\`\`

### 분쟁유형 값 (다음 중에서 선택, 복수 가능):
- lease: 임대차 분쟁
- sale: 매매 분쟁
- registration: 등기 분쟁
- brokerage: 중개 분쟁
- redevelopment: 재건축/재개발 분쟁

### 주의사항:
- disputeTypes는 1개 이상 포함해야 합니다.
- keyFacts는 사건의 객관적 사실만 기술합니다.
- legalIssues는 법적으로 쟁점이 되는 사항을 기술합니다.
- 부동산과 관련 없는 상황이면 가장 가까운 유형을 선택하되 빈 배열을 반환하지 마세요.
- JSON만 반환하고 다른 설명은 포함하지 마세요.`;
  }

  /**
   * LLM 응답에서 JSON을 파싱한다.
   *
   * @param content - LLM 응답 텍스트
   * @returns 파싱된 사실관계
   */
  private parseResponse(content: string): RawFactExtraction {
    // JSON 블록 추출 (```json ... ``` 또는 { ... })
    let jsonStr = content;

    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // 순수 JSON 객체 추출
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return this.validateAndNormalize(parsed);
    } catch {
      // 파싱 실패 시 기본값 반환
      return {
        disputeTypes: ['lease'],
        parties: { parties: ['당사자 미상'], relationship: '확인 필요' },
        keyFacts: ['사실관계 추출 실패'],
        legalIssues: ['법적 쟁점 추출 실패'],
      };
    }
  }

  /**
   * 파싱된 결과를 검증하고 정규화한다.
   *
   * @param parsed - JSON 파싱 결과
   * @returns 검증 및 정규화된 사실관계
   */
  private validateAndNormalize(parsed: Record<string, unknown>): RawFactExtraction {
    const disputeTypes = Array.isArray(parsed['disputeTypes'])
      ? (parsed['disputeTypes'] as string[]).filter((t) => this.isValidDisputeType(t))
      : [];

    const partiesRaw = parsed['parties'] as Record<string, unknown> | undefined;
    const parties = {
      parties: Array.isArray(partiesRaw?.['parties'])
        ? (partiesRaw['parties'] as string[])
        : ['당사자 미상'],
      relationship: typeof partiesRaw?.['relationship'] === 'string'
        ? partiesRaw['relationship'] as string
        : '확인 필요',
    };

    const keyFacts = Array.isArray(parsed['keyFacts'])
      ? (parsed['keyFacts'] as string[]).filter((f) => typeof f === 'string' && f.length > 0)
      : [];

    const legalIssues = Array.isArray(parsed['legalIssues'])
      ? (parsed['legalIssues'] as string[]).filter((i) => typeof i === 'string' && i.length > 0)
      : [];

    return {
      disputeTypes: disputeTypes.length > 0 ? disputeTypes : ['lease'],
      parties,
      keyFacts: keyFacts.length > 0 ? keyFacts : ['사실관계 추출 필요'],
      legalIssues: legalIssues.length > 0 ? legalIssues : ['법적 쟁점 분석 필요'],
    };
  }

  /**
   * 유효한 분쟁 유형인지 확인한다.
   */
  private isValidDisputeType(type: string): boolean {
    const validTypes: string[] = ['lease', 'sale', 'registration', 'brokerage', 'redevelopment'];
    return validTypes.includes(type);
  }

  /**
   * LLM 분류 결과와 키워드 분류 결과를 병합한다.
   *
   * 두 결과의 합집합을 취하되, 중복을 제거한다.
   *
   * @param llmTypes - LLM 분류 결과
   * @param keywordTypes - 키워드 분류 결과
   * @returns 병합된 분쟁 유형 목록
   */
  private mergeDisputeTypes(
    llmTypes: string[],
    keywordTypes: DisputeType[],
  ): DisputeType[] {
    const merged = new Set<DisputeType>();

    for (const type of llmTypes) {
      if (this.isValidDisputeType(type)) {
        merged.add(type as DisputeType);
      }
    }

    for (const type of keywordTypes) {
      merged.add(type);
    }

    return Array.from(merged);
  }
}
