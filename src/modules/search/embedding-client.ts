/**
 * 임베딩 클라이언트 모듈
 *
 * Amazon Bedrock Titan Text Embeddings V2 모델을 사용하여
 * 사용자 질문 텍스트를 1024차원 벡터로 변환한다.
 * 변환은 3초 이내에 완료되어야 한다.
 *
 * @module EmbeddingClient
 * @requirements 3.1, 9.4
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * 임베딩 클라이언트 설정 인터페이스
 */
export interface EmbeddingClientConfig {
  /** AWS 리전 (기본값: 'us-east-1') */
  region?: string;
  /** Bedrock 모델 ID (기본값: 'amazon.titan-embed-text-v2:0') */
  modelId?: string;
  /** 임베딩 벡터 차원 수 (기본값: 1024) */
  dimensions?: number;
  /** 요청 타임아웃 (밀리초, 기본값: 3000) */
  timeoutMs?: number;
}

/**
 * Titan Embeddings V2 요청 본문 인터페이스
 */
interface TitanEmbedRequest {
  inputText: string;
  dimensions: number;
}

/**
 * Titan Embeddings V2 응답 본문 인터페이스
 */
interface TitanEmbedResponse {
  embedding: number[];
  inputTextTokenCount: number;
}

/**
 * 임베딩 클라이언트 클래스
 *
 * Amazon Bedrock Titan Text Embeddings V2를 호출하여
 * 텍스트를 1024차원 벡터로 변환한다.
 * AbortSignal을 사용하여 3초 타임아웃을 적용한다.
 *
 * @requirements 3.1
 */
export class EmbeddingClient {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private dimensions: number;
  private timeoutMs: number;

  constructor(config: EmbeddingClientConfig = {}) {
    const region = config.region ?? 'us-east-1';
    this.modelId = config.modelId ?? 'amazon.titan-embed-text-v2:0';
    this.dimensions = config.dimensions ?? 1024;
    this.timeoutMs = config.timeoutMs ?? 3000;

    this.client = new BedrockRuntimeClient({ region });
  }

  /**
   * 질문 텍스트를 임베딩 벡터로 변환한다.
   *
   * Titan Text Embeddings V2 모델을 호출하여 입력 텍스트를
   * 1024차원 벡터로 변환한다. 변환은 3초 이내에 완료되어야 하며,
   * 타임아웃 초과 시 에러를 발생시킨다.
   *
   * @param query - 임베딩으로 변환할 질문 텍스트
   * @returns 1024차원 벡터 배열
   * @throws 타임아웃 초과 또는 Bedrock 호출 실패 시 에러
   *
   * @requirements 3.1
   */
  async embedQuery(query: string): Promise<number[]> {
    if (!query || query.trim().length === 0) {
      throw new Error('임베딩 변환할 텍스트가 비어있습니다.');
    }

    const requestBody: TitanEmbedRequest = {
      inputText: query.trim(),
      dimensions: this.dimensions,
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
      ) as TitanEmbedResponse;

      if (
        !responseBody.embedding ||
        !Array.isArray(responseBody.embedding)
      ) {
        throw new Error('유효하지 않은 임베딩 응답 형식입니다.');
      }

      return responseBody.embedding;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `임베딩 변환 타임아웃: ${this.timeoutMs}ms 이내에 완료되지 않았습니다.`
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
