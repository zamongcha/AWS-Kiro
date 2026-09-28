/**
 * @fileoverview 세법 임베딩 및 벡터 적재 모듈
 * @description Amazon Bedrock Titan Embeddings V2를 통해 세법 조문을 벡터로 변환하고,
 * OpenSearch Serverless의 tax-laws 인덱스에 적재한다.
 * 임베딩 실패 시 해당 조문만 기록하고 나머지 조문은 계속 처리한다.
 *
 * @requirements 1.7 - 수집된 데이터는 Amazon S3에 원본, DynamoDB에 메타데이터
 * @requirements 1.8 - 텍스트 임베딩 변환 및 OpenSearch Serverless에 적재
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import type { TaxLawArticle } from '../interfaces/index.js';

/**
 * 임베딩 결과 인터페이스
 */
export interface TaxLawEmbeddingResult {
  /** 임베딩 성공 조문 수 */
  successCount: number;
  /** 임베딩 실패 조문 수 */
  failureCount: number;
  /** 실패 상세 정보 */
  failures: Array<{
    lawId: string;
    lawName: string;
    articleNumber: string;
    error: string;
  }>;
  /** 적재된 총 벡터 수 */
  indexedCount: number;
}

/**
 * 임베딩 설정 인터페이스
 */
export interface TaxLawEmbedderConfig {
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
const DEFAULT_CONFIG: TaxLawEmbedderConfig = {
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
  modelId: 'amazon.titan-embed-text-v2:0',
  opensearchEndpoint: process.env['OPENSEARCH_ENDPOINT'] || '',
  indexName: 'tax-laws',
  embeddingDimension: 1024,
};

/**
 * OpenSearch 세법 문서 인터페이스
 *
 * 세법 조문을 OpenSearch에 적재할 때 사용하는 문서 구조.
 */
interface OpenSearchTaxLawDocument {
  /** 법령명 */
  law_name: string;
  /** 조항 번호 */
  article_number: string;
  /** 조항 내용 */
  article_content: string;
  /** 시행일자 */
  effective_date: string;
  /** 적용 세목 */
  tax_type: string;
  /** 세율 테이블 포함 여부 */
  has_rate_table: boolean;
  /** 개정 횟수 */
  revision_count: number;
  /** 임베딩 벡터 */
  embedding_vector: number[];
  /** 메타데이터 */
  metadata: {
    law_id: string;
    source: string;
    collected_at: string;
    is_current: boolean;
    service_id: string;
  };
}

/**
 * 세법 임베딩 및 벡터 적재 서비스
 *
 * Titan Embeddings V2로 각 세법 조문의 content를 임베딩 벡터(1024차원)로 변환하고,
 * OpenSearch Serverless의 tax-laws 인덱스에 적재한다.
 * 개별 조문별로 임베딩을 생성하며, 실패 시 해당 조문만 기록하고 나머지는 계속 진행한다.
 *
 * 기존 src/modules/search/embedding-client.ts 및 opensearch-client.ts의 패턴을 재활용하며,
 * 인덱스명을 tax-laws로 변경하여 세무 데이터 격리를 보장한다.
 */
export class TaxLawEmbedder {
  private bedrockClient: BedrockRuntimeClient;
  private opensearchClient: OpenSearchClient;
  private config: TaxLawEmbedderConfig;

  constructor(config: Partial<TaxLawEmbedderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.bedrockClient = new BedrockRuntimeClient({ region: this.config.region });
    this.opensearchClient = new OpenSearchClient({
      node: this.config.opensearchEndpoint,
    });
  }

  /**
   * 세법 조문 임베딩 및 OpenSearch 적재
   *
   * 각 조문의 articleContent를 Titan Embeddings V2로 변환하고,
   * OpenSearch에 벡터와 함께 문서를 적재한다.
   * 임베딩 실패 시 해당 조문만 기록하고 나머지 조문의 처리를 계속한다.
   *
   * @param articles - 임베딩 및 적재할 세법 조문 목록
   * @returns 임베딩 결과 (성공/실패 카운트 및 실패 상세)
   */
  async embedAndStore(articles: TaxLawArticle[]): Promise<TaxLawEmbeddingResult> {
    const result: TaxLawEmbeddingResult = {
      successCount: 0,
      failureCount: 0,
      failures: [],
      indexedCount: 0,
    };

    for (const article of articles) {
      try {
        // 조문 내용으로 임베딩 벡터 생성
        const embedding = await this.generateEmbedding(article.articleContent);

        // OpenSearch에 문서 적재
        await this.indexDocument(article, embedding);

        result.successCount++;
        result.indexedCount++;
      } catch (error) {
        // 개별 조문 실패 시 기록하고 나머지 계속 진행
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.failureCount++;
        result.failures.push({
          lawId: article.metadata.lawId,
          lawName: article.lawName,
          articleNumber: article.articleNumber,
          error: errorMessage,
        });
      }
    }

    return result;
  }

  /**
   * Titan Embeddings V2를 통한 텍스트 임베딩 생성
   *
   * @param text - 임베딩할 텍스트 (세법 조문 내용)
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
   * OpenSearch에 세법 문서 적재
   *
   * 조문 데이터와 임베딩 벡터를 결합하여 OpenSearch tax-laws 인덱스에 인덱싱한다.
   * 동일 ID의 문서가 존재하면 덮어쓴다 (upsert).
   *
   * @param article - 세법 조문
   * @param embedding - 임베딩 벡터
   */
  private async indexDocument(article: TaxLawArticle, embedding: number[]): Promise<void> {
    const documentId = `${article.metadata.lawId}_${article.articleNumber}`;

    const document: OpenSearchTaxLawDocument = {
      law_name: article.lawName,
      article_number: article.articleNumber,
      article_content: article.articleContent,
      effective_date: article.effectiveDate,
      tax_type: article.applicableTaxType[0] || 'general',
      has_rate_table: article.hasRateTable,
      revision_count: article.revisionHistory.length,
      embedding_vector: embedding,
      metadata: {
        law_id: article.metadata.lawId,
        source: article.metadata.source,
        collected_at: article.metadata.collectedAt,
        is_current: true,
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
