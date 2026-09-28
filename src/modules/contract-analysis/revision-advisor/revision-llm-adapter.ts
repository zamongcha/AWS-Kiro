/**
 * 수정제안 생성기 전용 LLM 어댑터
 *
 * 수정제안 생성기(SuggestionGenerator)가 사용하는 LLM 호출 어댑터를 정의한다.
 * `LLM_PROVIDER` 환경 변수(bedrock | gemini | mock)에 따라 제공자를 교체할 수
 * 있으며, 어떤 제공자든 동일한 `RevisionLlmAdapter` 인터페이스를 구현한다.
 *
 * 제공자 종류:
 *   - bedrock: Amazon Bedrock Claude 호출 (배포 환경)
 *   - gemini : Google Gemini(gemini-3.6-flash) 호출 (로컬 개발 기본)
 *   - mock   : 결정적 응답 반환 (테스트/오프라인)
 *
 * 다른 서브에이전트가 동시에 작업 중인 clause-recommender와 충돌하지 않도록
 * 파일명·심볼명을 revision-advisor 전용(`Revision*`)으로 격리한다.
 *
 * @module RevisionLlmAdapter
 * @requirements 6.1, 6.2, 6.8
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * 수정제안 생성 LLM 어댑터 인터페이스
 *
 * 시스템 프롬프트와 사용자 프롬프트를 받아 LLM 응답 텍스트를 반환한다.
 * 구현체는 반드시 타임아웃(기본 30초) 내에 응답하거나 오류를 던져야 한다.
 */
export interface RevisionLlmAdapter {
  /**
   * LLM을 호출하여 응답 텍스트를 생성한다.
   *
   * @param systemPrompt - 시스템 프롬프트 (LLM 동작 지시)
   * @param userPrompt - 사용자 프롬프트 (조항/문의 내용 포함)
   * @param timeoutMs - 타임아웃 (밀리초)
   * @returns 생성된 응답 텍스트
   * @throws 타임아웃 초과 또는 호출 실패 시 오류
   */
  generate(
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<string>;

  /** 제공자 식별자 (bedrock | gemini | mock) */
  readonly providerName: string;
}

/** LLM 제공자 종류 */
export type RevisionLlmProviderType = 'bedrock' | 'gemini' | 'mock';

/**
 * `LLM_PROVIDER` 환경 변수 값을 제공자 종류로 해석한다.
 *
 * 미지정 또는 알 수 없는 값이면 로컬 개발 기본값인 `mock`을 사용한다.
 *
 * @param raw - 환경 변수 원본 값
 * @returns 제공자 종류
 */
export function resolveRevisionLlmProviderType(
  raw: string | undefined,
): RevisionLlmProviderType {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'bedrock':
      return 'bedrock';
    case 'gemini':
      return 'gemini';
    case 'mock':
      return 'mock';
    default:
      return 'mock';
  }
}

/**
 * 환경 변수(`LLM_PROVIDER`)에 따라 수정제안 생성용 LLM 어댑터를 생성한다.
 *
 * @param override - 제공자 강제 지정 (테스트용, 미지정 시 환경 변수 사용)
 * @returns LLM 어댑터 인스턴스
 */
export function createRevisionLlmAdapter(
  override?: RevisionLlmProviderType,
): RevisionLlmAdapter {
  const providerType =
    override ?? resolveRevisionLlmProviderType(process.env['LLM_PROVIDER']);

  switch (providerType) {
    case 'bedrock':
      return new RevisionBedrockAdapter();
    case 'gemini':
      return new RevisionGeminiAdapter();
    case 'mock':
    default:
      return new RevisionMockLlmAdapter();
  }
}

/**
 * 주어진 Promise가 타임아웃 내에 완료되지 않으면 오류를 던진다.
 *
 * @param promise - 감쌀 작업 Promise
 * @param timeoutMs - 타임아웃 (밀리초)
 * @param label - 타임아웃 메시지에 포함할 라벨
 * @returns 작업 결과
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} 응답이 ${timeoutMs}ms 이내에 완료되지 않았습니다.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Amazon Bedrock Claude 기반 수정제안 생성 어댑터
 *
 * `src/modules/response-generator/bedrock-client.ts`의 Claude 호출 규약을
 * 재사용하며, AbortSignal로 타임아웃을 적용한다.
 */
export class RevisionBedrockAdapter implements RevisionLlmAdapter {
  readonly providerName = 'bedrock';
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: {
    region?: string;
    modelId?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}) {
    this.client = new BedrockRuntimeClient({
      region: config.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
    });
    this.modelId =
      config.modelId ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    this.maxTokens = config.maxTokens ?? 4096;
    this.temperature = config.temperature ?? 0.3;
  }

  /** @inheritdoc */
  async generate(
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<string> {
    const requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    };

    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    });

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const response = await this.client.send(command, {
        abortSignal: abortController.signal,
      });
      if (!response.body) {
        throw new Error('Bedrock 응답 본문이 비어있습니다.');
      }
      const parsed = JSON.parse(
        new TextDecoder().decode(response.body),
      ) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = (parsed.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (text.trim().length === 0) {
        throw new Error('Bedrock 응답 텍스트가 비어있습니다.');
      }
      return text;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Bedrock 응답이 ${timeoutMs}ms 이내에 완료되지 않았습니다.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Google Gemini(gemini-3.6-flash) 기반 수정제안 생성 어댑터
 *
 * 로컬 서버(`src/local-server/server.ts`)의 callGeminiAPI와 동일한 호출
 * 규약(generateContent REST 엔드포인트)을 사용한다.
 */
export class RevisionGeminiAdapter implements RevisionLlmAdapter {
  readonly providerName = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: { apiKey?: string; model?: string } = {}) {
    this.apiKey = config.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    this.model = config.model ?? 'gemini-3.6-flash';
  }

  /** @inheritdoc */
  async generate(
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<string> {
    if (this.apiKey === '' || this.apiKey === 'YOUR_API_KEY_HERE') {
      throw new Error(
        'Gemini API 키가 설정되지 않았습니다. GEMINI_API_KEY 환경 변수를 확인하세요.',
      );
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const requestBody = {
      contents: [
        {
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    };

    const call = (async (): Promise<string> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Gemini API 호출 실패: ${response.status} ${errorBody}`,
        );
      }
      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const parts = data.candidates?.[0]?.content?.parts;
      const text = (parts ?? []).map((p) => p.text ?? '').join('').trim();
      if (text.length === 0) {
        throw new Error('Gemini 응답 텍스트가 비어있습니다.');
      }
      return text;
    })();

    return withTimeout(call, timeoutMs, 'Gemini');
  }
}

/**
 * 결정적 Mock 수정제안 생성 어댑터
 *
 * 네트워크 호출 없이 입력 프롬프트에 따라 결정적인 JSON 응답을 반환한다.
 * 테스트 및 오프라인 로컬 개발에서 사용한다. 실제 LLM을 대체하는 것이
 * 아니라 SuggestionGenerator의 파싱·후처리 로직 검증을 목적으로 한다.
 *
 * SuggestionGenerator는 이 어댑터가 없어도 프롬프트에 근거 정보가 포함되지
 * 않으면 결정적 폴백 결과를 만들 수 있으나, mock 어댑터는 프롬프트에 담긴
 * mode 지시자를 인식하여 형식에 맞는 JSON을 생성한다.
 */
export class RevisionMockLlmAdapter implements RevisionLlmAdapter {
  readonly providerName = 'mock';

  /** @inheritdoc */
  async generate(
    _systemPrompt: string,
    userPrompt: string,
    _timeoutMs: number,
  ): Promise<string> {
    // 프롬프트에 포함된 모드 지시자에 따라 결정적 JSON을 반환한다.
    if (userPrompt.includes('[MODE:judge]')) {
      return JSON.stringify({
        legalValidity:
          '해당 조항은 관련 법령의 강행규정에 반하지 않는 한 유효할 수 있습니다.',
        partyImpactJudgment: 'neutral',
        cautions:
          '조항의 구체적 해석은 계약 전체 맥락에 따라 달라질 수 있으니 주의하시기 바랍니다.',
        legalBasis: [],
      });
    }
    // 기본은 suggest 모드 응답
    return JSON.stringify({
      suggestions: [
        {
          revisedText:
            '본 조항은 당사자 쌍방의 권리와 의무를 균형 있게 규정하도록 수정하시기 바랍니다.',
          rationale:
            '기존 문구가 일방에게 불리하게 해석될 여지가 있어 형평에 맞게 조정하는 것이 안전합니다.',
          legalBasis: [],
        },
      ],
    });
  }
}
