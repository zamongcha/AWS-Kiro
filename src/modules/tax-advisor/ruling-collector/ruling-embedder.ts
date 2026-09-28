/**
 * @fileoverview 예규/심판례 임베딩 및 벡터 적재 모듈
 * @description Amazon Bedrock Titan Embeddings V2를 통해 예규/심판례 청크를 벡터로 변환하고,
 * OpenSearch Serverless의 tax-rulings 인덱스에 적재한다.
 * 임베딩 실패 시 해당 청크만 기록하고 나머지 청크는 계속 처리한다.
 *
 * @requirements 2.3 - 예규 데이터 구조화 저장
 * @requirements 2.7 - 청크 분할 후 벡터 적재
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import type { TaxRuling } from '../interfaces/index.js';

/**
 * 임베딩 결과 인터페이스
 */
export interface RulingEmbeddingResult {
  /** 임베딩 성공 청크 수 */
  successCount: number;
  /** 임베딩 실패 청크 수 */
  failureCount: number;
  /** 실패 상세 정보 */
  failures: Array<{
    rulingId: string;
    documentNumber: string;
    chunkIndex: number;
    error: string;
  }>;
  /** 적재된 총 벡터 수 */
  indexedCount: number;
}

/**
 * 임베딩 설정 인터페이스
 */
export interface RulingEmbedderConfig {
  /** AWS 리전 */
  region: string;
  /** Bedrock 임베딩 모델 ID */
  modelId: string;
  /** OpenSearch 엔드포인트 URL */
  opensearchEndpoint: string;
  /** OpenSearch 인덱스 이름 */
  indexName: string;
  /** 임베딩 벡터 차원 수 */
  embeddingDimension: number;
}

/** 기본 설정 */
const DEFAULT_CONFIG: RulingEmbedderConfig = {
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
  modelId: 'amazon.titan-embed-text-v2:0',
  opensearchEndpoint: process.env['OPENSEARCH_ENDPOINT'] || '',
  indexName: 'tax-rulings',
  embeddingDimension: 1024,
};

/**
 * OpenSearch 예규 문서 인터페이스
 *
 * 예규/심판례 청크를 OpenSearch에 적재할 때 사용하는 문서 구조.
 */
interface OpenSearchRulingDocument {
  /** 문서번호 */
  document_number: string;
  /** 회신일자 */
  reply_date: string;
  /** 문서 유형 */
  document_type: string;
  /** 세목 분류 */
  tax_category: string;
  /** 청크 내용 */
  chunk_content: string;
  /** 청크 인덱스 */
  chunk_index: number;
  /** 총 청크 수 */
  total_chunks: number;
  /** 질의 요지 */
  query_summary: string;
  /** 참조 세법 조항 */
  referenced_law_articles: string[];
  /** 임베딩 벡터 */
  embedding_vector: number[];
  /** 메타데이터 */
  metadata: {
    ruling_id: string;
    source: string;
    collected_at: string;
    service_id: string;
  };
}

/**
 * 예규/심판례 임베딩 및 벡터 적재 서비스
 *
 * Titan Embeddings V2로 각 예규 청크를 임베딩 벡터(1024차원)로 변환하고,
 * OpenSearch Serverless의 tax-rulings 인덱스에 적재한다.
 * 개별 청크별로 임베딩을 생성하며, 실패 시 해당 청크만 기록하고 나머지는 계속 진행한다.
 */
export class RulingEmbedder {
  private bedrockClient: BedrockRuntimeClient;
  private opensearchClient: OpenSearchClient;
  private config: RulingEmbedderConfig;

  constructor(config: Partial<RulingEmbedderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.bedrockClient = new BedrockRuntimeClient({ region: this.config.region });
    this.opensearchClient = new OpenSearchClient({
      node: this.config.opensearchEndpoint,
    });
  }

  /**
   * 예규/심판례 청크를 임베딩하고 OpenSearch에 적재한다.
   *
   * 각 예규에 대해 청크 목록을 받아 개별 임베딩을 생성하고,
   * OpenSearch tax-rulings 인덱스에 적재한다.
   * 임베딩 실패 시 해당 청크만 기록하고 나머지 청크의 처리를 계속한다.
   *
   * @param rulings - 예규 목록
   * @param chunksMap - 예규 ID → 청크 내용 배열 매핑
   * @returns 임베딩 결과
   */
  async embedAndStore(
    rulings: TaxRuling[],
    chunksMap: Map<string, string[]>,
  ): Promise<RulingEmbeddingResult> {
    const result: RulingEmbeddingResult = {
      successCount: 0,
      failureCount: 0,
      failures: [],
      indexedCount: 0,
    };

    for (const ruling of rulings) {
      const rulingId = ruling.metadata.rulingId;
      const chunks = chunksMap.get(rulingId);

      if (!chunks || chunks.length === 0) {
        // 청크가 없으면 전체 회신 내용을 단일 청크로 처리
        try {
          const embedding = await this.generateEmbedding(ruling.replyContent);
          await this.indexDocument(ruling, ruling.replyContent, 0, 1, embedding);
          result.successCount++;
          result.indexedCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.failureCount++;
          result.failures.push({
            rulingId,
            documentNumber: ruling.documentNumber,
            chunkIndex: 0,
            error: errorMessage,
          });
        }
        continue;
      }

      // 청크별 임베딩 및 적재
      for (let i = 0; i < chunks.length; i++) {
        try {
          const embedding = await this.generateEmbedding(chunks[i]);
          await this.indexDocument(ruling, chunks[i], i, chunks.length, embedding);
          result.successCount++;
          result.indexedCount++;
        } catch (error) {
          // 개별 청크 실패 시 기록하고 나머지 계속 진행
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.failureCount++;
          result.failures.push({
            rulingId,
            documentNumber: ruling.documentNumber,
            chunkIndex: i,
            error: errorMessage,
          });
        }
      }
    }

    return result;
  }

  /**
   * Titan Embeddings V2를 통한 텍스트 임베딩 생성
   *
   * @param text - 임베딩할 텍스트 (예규 청크 내용)
   * @returns 1024차원 임베딩 벡터
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const payload = {
      inputText: text,
      dimensions: this.config.embeddingDimension,
      normalize: true,
    };

    const command = new InvokeModelCommand({
      modelId: this.config.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await this.bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.embedding || !Array.isArray(responseBody.embedding)) {
      throw new Error('임베딩 응답에서 벡터를 추출할 수 없습니다.');
    }

    return responseBody.embedding as number[];
  }

  /**
   * OpenSearch에 예규 청크 문서 적재
   *
   * @param ruling - 예규 데이터
   * @param chunkContent - 청크 내용
   * @param chunkIndex - 청크 인덱스
   * @param totalChunks - 총 청크 수
   * @param embedding - 임베딩 벡터
   */
  private async indexDocument(
    ruling: TaxRuling,
    chunkContent: string,
    chunkIndex: number,
    totalChunks: number,
    embedding: number[],
  ): Promise<void> {
    const documentId = `${ruling.metadata.rulingId}_chunk_${chunkIndex}`;

    const document: OpenSearchRulingDocument = {
      document_number: ruling.documentNumber,
      reply_date: ruling.replyDate,
      document_type: ruling.documentType,
      tax_category: ruling.taxCategory,
      chunk_content: chunkContent,
      chunk_index: chunkIndex,
      total_chunks: totalChunks,
      query_summary: ruling.querySummary,
      referenced_law_articles: ruling.referencedLawArticles,
      embedding_vector: embedding,
      metadata: {
        ruling_id: ruling.metadata.rulingId,
        source: ruling.metadata.source,
        collected_at: ruling.metadata.collectedAt,
        service_id: 'TAX',
      },
    };

    await this.opensearchClient.index({
      index: this.config.indexName,
      id: documentId,
      body: document,
      refresh: false,
    });
  }
}
