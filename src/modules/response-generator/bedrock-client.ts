/**
 * Bedrock LLM 클라이언트 모듈
 *
 * Amazon Bedrock Claude 3.5 Sonnet 모델을 사용하여
 * 부동산 법률 자문 응답을 생성한다.
 * 호출 타임아웃은 60초로 설정된다.
 *
 * @module BedrockLLMClient
 * @requirements 4.1, 4.2, 9.1
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * Bedrock LLM 클라이언트 설정 인터페이스
 */
export interface BedrockLLMClientConfig {
  /** AWS 리전 (기본값: 'us-east-1') */
  region?: string;
  /** Bedrock 모델 ID (기본값: 'anthropic.claude-3-5-sonnet-20240620-v1:0') */
  modelId?: string;
  /** 요청 타임아웃 (밀리초, 기본값: 60000) */
  timeoutMs?: number;
  /** 최대 출력 토큰 수 (기본값: 4096) */
  maxTokens?: number;
  /** 생성 온도 (기본값: 0.3) */
  temperature?: number;
}

/**
 * Claude 3.5 Sonnet 요청 메시지 인터페이스
 */
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Claude 3.5 Sonnet 요청 본문 인터페이스
 */
interface ClaudeRequest {
  anthropic_version: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: ClaudeMessage[];
}

/**
 * Claude 3.5 Sonnet 응답 컨텐츠 블록 인터페이스
 */
interface ClaudeContentBlock {
  type: 'text';
  text: string;
}

/**
 * Claude 3.5 Sonnet 응답 본문 인터페이스
 */
interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * LLM 호출 결과 인터페이스
 */
export interface LLMResponse {
  /** 생성된 텍스트 */
  text: string;
  /** 사용된 모델 ID */
  model: string;
  /** 입력 토큰 수 */
  inputTokens: number;
  /** 출력 토큰 수 */
  outputTokens: number;
  /** 종료 사유 */
  stopReason: string;
}

/**
 * Bedrock LLM 클라이언트 클래스
 *
 * Amazon Bedrock Claude 3.5 Sonnet 모델을 호출하여
 * 부동산 법률 자문 응답을 생성한다.
 * AbortSignal을 사용하여 60초 타임아웃을 적용한다.
 *
 * @requirements 4.1, 4.2, 9.1
 */
export class BedrockLLMClient {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private timeoutMs: number;
  private maxTokens: number;
  private temperature: number;

  constructor(config: BedrockLLMClientConfig = {}) {
    const region = config.region ?? 'us-east-1';
    this.modelId = config.modelId ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    this.timeoutMs = config.timeoutMs ?? 60000;
    this.maxTokens = config.maxTokens ?? 4096;
    this.temperature = config.temperature ?? 0.3;

    this.client = new BedrockRuntimeClient({ region });
  }

  /**
   * 시스템 프롬프트와 사용자 메시지를 전달하여 LLM 응답을 생성한다.
   *
   * Claude 3.5 Sonnet 모델에 시스템 프롬프트와 사용자 메시지를 전달하고
   * 생성된 응답 텍스트를 반환한다. 60초 타임아웃을 적용한다.
   *
   * @param systemPrompt - 시스템 프롬프트 (LLM 동작 지시)
   * @param userMessage - 사용자 메시지 (질문 + 검색 결과 포함)
   * @returns LLM 응답 결과
   * @throws 타임아웃 초과 또는 Bedrock 호출 실패 시 에러
   *
   * @requirements 4.1, 9.1
   */
  async invoke(systemPrompt: string, userMessage: string): Promise<LLMResponse> {
    if (!userMessage || userMessage.trim().length === 0) {
      throw new Error('사용자 메시지가 비어있습니다.');
    }

    const requestBody: ClaudeRequest = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
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
      const response = await this.client.send(command, {
        abortSignal: abortController.signal,
      });

      if (!response.body) {
        throw new Error('Bedrock 응답 본문이 비어있습니다.');
      }

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      ) as ClaudeResponse;

      if (!responseBody.content || responseBody.content.length === 0) {
        throw new Error('LLM 응답 컨텐츠가 비어있습니다.');
      }

      const text = responseBody.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        model: responseBody.model || this.modelId,
        inputTokens: responseBody.usage?.input_tokens ?? 0,
        outputTokens: responseBody.usage?.output_tokens ?? 0,
        stopReason: responseBody.stop_reason || 'unknown',
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `LLM 응답 생성 타임아웃: ${this.timeoutMs}ms 이내에 완료되지 않았습니다.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 대화 이력을 포함한 LLM 호출
   *
   * 이전 대화 이력(질문-답변 쌍)을 메시지에 포함하여
   * 컨텍스트를 유지한 후속 답변을 생성한다.
   *
   * @param systemPrompt - 시스템 프롬프트
   * @param conversationHistory - 이전 대화 이력 (user/assistant 쌍)
   * @param currentMessage - 현재 사용자 메시지
   * @returns LLM 응답 결과
   *
   * @requirements 4.3
   */
  async invokeWithHistory(
    systemPrompt: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    currentMessage: string
  ): Promise<LLMResponse> {
    if (!currentMessage || currentMessage.trim().length === 0) {
      throw new Error('사용자 메시지가 비어있습니다.');
    }

    const messages: ClaudeMessage[] = [
      ...conversationHistory,
      { role: 'user', content: currentMessage },
    ];

    const requestBody: ClaudeRequest = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: systemPrompt,
      messages,
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
      const response = await this.client.send(command, {
        abortSignal: abortController.signal,
      });

      if (!response.body) {
        throw new Error('Bedrock 응답 본문이 비어있습니다.');
      }

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      ) as ClaudeResponse;

      if (!responseBody.content || responseBody.content.length === 0) {
        throw new Error('LLM 응답 컨텐츠가 비어있습니다.');
      }

      const text = responseBody.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        model: responseBody.model || this.modelId,
        inputTokens: responseBody.usage?.input_tokens ?? 0,
        outputTokens: responseBody.usage?.output_tokens ?? 0,
        stopReason: responseBody.stop_reason || 'unknown',
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `LLM 응답 생성 타임아웃: ${this.timeoutMs}ms 이내에 완료되지 않았습니다.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 사용 중인 모델 ID를 반환한다.
   */
  getModelId(): string {
    return this.modelId;
  }

  /**
   * 설정된 타임아웃(밀리초)을 반환한다.
   */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }
}
