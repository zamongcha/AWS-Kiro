/**
 * @fileoverview 판례 임베딩 및 벡터 적재 모듈
 * @description 판례 청크별 임베딩을 생성하고 OpenSearch Serverless에 적재한다.
 * S3에 원본 및 청크 데이터를 저장하고, DynamoDB에 수집/벡터 상태 메타데이터를 기록한다.
 * Amazon Bedrock Titan Embeddings V2를 사용하여 1024차원 벡터를 생성한다.
 *
 * @requirements 2.3 - 구조화된 데이터 저장
 * @requirements 2.7 - 판결문을 500~1000 토큰 단위로 청크 분할 후 벡터 적재
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CourtCase } from '../../common/interfaces/index.js';
import { Chunk } from './chunk-splitter.js';

/**
 * 판례 임베딩 결과 인터페이스
 */
export interface CaseEmbeddingResult {
  /** 판례 ID */
  caseId: string;
  /** 사건번호 */
  caseNumber: string;
  /** 전체 청크 수 */
  totalChunks: number;
  /** 임베딩 성공 청크 수 */
  successCount: number;
  /** 임베딩 실패 청크 수 */
  failureCount: number;
  /** 실패 상세 정보 */
  failures: Array<{
    chunkIndex: number;
    error: string;
  }>;
  /** S3 저장 경로 */
  s3Paths: {
    fullCase: string;
    chunks: string[];
  };
  /** 벡터 적재 상태 */
  vectorStatus: 'completed' | 'partial' | 'failed';
}

/**
 * 판례 임베딩 설정 인터페이스
 */
export interface CaseEmbedderConfig {
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
  /** S3 버킷 이름 */
  bucketName: string;
  /** DynamoDB 테이블 이름 */
  tableName: string;
}

/** 기본 설정 */
const DEFAULT_CONFIG: CaseEmbedderConfig = {
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
  modelId: 'amazon.titan-embed-text-v2:0',
  opensearchEndpoint: process.env['OPENSEARCH_ENDPOINT'] || '',
  indexName: 'court-cases',
  embeddingDimension: 1024,
  bucketName: `real-estate-legal-data-${process.env['ENVIRONMENT'] || 'dev'}`,
  tableName: 'DataManagement',
};

/**
 * OpenSearch 판례 청크 문서 인터페이스
 *
 * court-cases 인덱스에 적재되는 문서 구조.
 */
interface OpenSearchCaseDocument {
  /** 사건번호 */
  case_number: string;
  /** 법원명 */
  court_name: string;
  /** 선고일자 */
  judgment_date: string;
  /** 사건 유형 */
  case_type: string;
  /** 청크 내용 */
  chunk_content: string;
  /** 청크 인덱스 */
  chunk_index: number;
  /** 전체 청크 수 */
  total_chunks: number;
  /** 참조 법령 */
  referenced_laws: string[];
  /** 임베딩 벡터 */
  embedding_vector: number[];
  /** 메타데이터 */
  metadata: {
    case_id: string;
    source: string;
    collected_at: string;
  };
}

/**
 * DynamoDB 판례 메타데이터 인터페이스
 */
export interface CaseMetadata {
  /** 데이터 유형 (PK) */
  dataType: 'case';
  /** 판례 문서 고유 ID (SK) */
  documentId: string;
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 선고일자 */
  judgmentDate: string;
  /** 사건 유형 */
  caseType: string;
  /** 청크 수 */
  chunkCount: number;
  /** 수집 일시 (ISO 8601) */
  collectedAt: string;
  /** 최종 갱신 일시 (ISO 8601) */
  lastUpdated: string;
  /** 벡터 적재 상태 */
  vectorStatus: 'completed' | 'in_progress' | 'failed';
  /** 문서 버전 */
  version: number;
}

/**
 * 판례 임베딩 및 벡터 적재 서비스
 *
 * 판례 청크별로 Titan Embeddings V2 임베딩을 생성하고,
 * OpenSearch Serverless의 court-cases 인덱스에 적재한다.
 * 또한 S3에 원본 판례 및 청크 데이터를 저장하고,
 * DynamoDB에 수집 상태 메타데이터를 기록한다.
 */
export class CaseEmbedder {
  private bedrockClient: BedrockRuntimeClient;
  private opensearchClient: OpenSearchClient;
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private config: CaseEmbedderConfig;

  constructor(config: Partial<CaseEmbedderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.bedrockClient = new BedrockRuntimeClient({ region: this.config.region });
    this.opensearchClient = new OpenSearchClient({
      node: this.config.opensearchEndpoint,
    });
    this.s3Client = new S3Client({ region: this.config.region });
    const ddbClient = new DynamoDBClient({ region: this.config.region });
    this.dynamoClient = DynamoDBDocumentClient.from(ddbClient);
  }

  /**
   * 판례 임베딩 및 OpenSearch/S3/DynamoDB 적재
   *
   * 1. S3에 원본 판례 데이터 저장 (raw/cases/{case_id}/full.json)
   * 2. 각 청크를 S3에 저장 (raw/cases/{case_id}/chunks/{chunk_index}.json)
   * 3. 각 청크를 Titan Embeddings V2로 임베딩
   * 4. OpenSearch court-cases 인덱스에 적재
   * 5. DynamoDB에 메타데이터 기록
   *
   * 개별 청크 임베딩 실패 시 해당 청크만 기록하고 나머지 청크 처리를 계속한다.
   *
   * @param courtCase - 판례 데이터
   * @param chunks - 분할된 청크 배열
   * @returns 임베딩 결과
   */
  async embedAndIndexCase(courtCase: CourtCase, chunks: Chunk[]): Promise<CaseEmbeddingResult> {
    const caseId = courtCase.id;
    const result: CaseEmbeddingResult = {
      caseId,
      caseNumber: courtCase.caseNumber,
      totalChunks: chunks.length,
      successCount: 0,
      failureCount: 0,
      failures: [],
      s3Paths: {
        fullCase: `raw/cases/${caseId}/full.json`,
        chunks: [],
      },
      vectorStatus: 'completed',
    };

    // DynamoDB 메타데이터 초기 기록 (in_progress 상태)
    await this.saveCaseMetadata(courtCase, chunks.length, 'in_progress');

    // S3에 원본 판례 데이터 저장
    await this.saveFullCaseToS3(courtCase);

    // 각 청크 처리
    for (const chunk of chunks) {
      try {
        // S3에 청크 데이터 저장
        const chunkPath = `raw/cases/${caseId}/chunks/${chunk.index}.json`;
        await this.saveChunkToS3(caseId, chunk);
        result.s3Paths.chunks.push(chunkPath);

        // 임베딩 벡터 생성
        const embedding = await this.generateEmbedding(chunk.content);

        // OpenSearch에 문서 적재
        await this.indexChunkDocument(courtCase, chunk, chunks.length, embedding);

        result.successCount++;
      } catch (error) {
        // 개별 청크 실패 시 기록하고 나머지 계속 진행
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.failureCount++;
        result.failures.push({
          chunkIndex: chunk.index,
          error: errorMessage,
        });
      }
    }

    // 벡터 적재 상태 결정
    if (result.failureCount === 0) {
      result.vectorStatus = 'completed';
    } else if (result.successCount > 0) {
      result.vectorStatus = 'partial';
    } else {
      result.vectorStatus = 'failed';
    }

    // DynamoDB 메타데이터 최종 상태 갱신
    const ddbStatus = result.vectorStatus === 'partial' ? 'completed' : result.vectorStatus;
    await this.saveCaseMetadata(courtCase, chunks.length, ddbStatus);

    return result;
  }

  /**
   * Titan Embeddings V2를 통한 텍스트 임베딩 생성
   *
   * @param text - 임베딩할 텍스트 (청크 내용)
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
   * OpenSearch에 판례 청크 문서 적재
   *
   * @param courtCase - 판례 데이터
   * @param chunk - 청크 데이터
   * @param totalChunks - 전체 청크 수
   * @param embedding - 임베딩 벡터
   */
  private async indexChunkDocument(
    courtCase: CourtCase,
    chunk: Chunk,
    totalChunks: number,
    embedding: number[],
  ): Promise<void> {
    const document: OpenSearchCaseDocument = {
      case_number: courtCase.caseNumber,
      court_name: courtCase.court,
      judgment_date: courtCase.date,
      case_type: this.determineCaseType(courtCase),
      chunk_content: chunk.content,
      chunk_index: chunk.index,
      total_chunks: totalChunks,
      referenced_laws: courtCase.relatedLaws,
      embedding_vector: embedding,
      metadata: {
        case_id: courtCase.id,
        source: '대법원 종합법률정보',
        collected_at: new Date().toISOString(),
      },
    };

    // 문서 ID: {case_id}_chunk_{chunk_index}
    const documentId = `${courtCase.id}_chunk_${chunk.index}`;

    await this.opensearchClient.index({
      index: this.config.indexName,
      id: documentId,
      body: document,
      refresh: false,
    });
  }

  /**
   * S3에 원본 판례 데이터 저장
   *
   * 경로: raw/cases/{case_id}/full.json
   *
   * @param courtCase - 판례 데이터
   */
  private async saveFullCaseToS3(courtCase: CourtCase): Promise<void> {
    const s3Key = `raw/cases/${courtCase.id}/full.json`;
    const body = JSON.stringify({
      caseId: courtCase.id,
      caseNumber: courtCase.caseNumber,
      court: courtCase.court,
      date: courtCase.date,
      summary: courtCase.summary,
      fullText: courtCase.fullText,
      keywords: courtCase.keywords,
      relatedLaws: courtCase.relatedLaws,
      savedAt: new Date().toISOString(),
    }, null, 2);

    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: s3Key,
      Body: body,
      ContentType: 'application/json',
    });

    await this.s3Client.send(command);
  }

  /**
   * S3에 청크 데이터 저장
   *
   * 경로: raw/cases/{case_id}/chunks/{chunk_index}.json
   *
   * @param caseId - 판례 ID
   * @param chunk - 청크 데이터
   */
  private async saveChunkToS3(caseId: string, chunk: Chunk): Promise<void> {
    const s3Key = `raw/cases/${caseId}/chunks/${chunk.index}.json`;
    const body = JSON.stringify({
      caseId,
      chunkIndex: chunk.index,
      content: chunk.content,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      tokenCount: chunk.tokenCount,
      savedAt: new Date().toISOString(),
    }, null, 2);

    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: s3Key,
      Body: body,
      ContentType: 'application/json',
    });

    await this.s3Client.send(command);
  }

  /**
   * DynamoDB에 판례 메타데이터 저장
   *
   * DataManagement 테이블에 판례 수집 상태와 벡터 적재 상태를 기록한다.
   *
   * @param courtCase - 판례 데이터
   * @param chunkCount - 청크 수
   * @param vectorStatus - 벡터 적재 상태
   */
  private async saveCaseMetadata(
    courtCase: CourtCase,
    chunkCount: number,
    vectorStatus: 'completed' | 'in_progress' | 'failed',
  ): Promise<void> {
    const now = new Date().toISOString();

    // 기존 메타데이터 조회하여 버전 결정
    const existing = await this.getCaseMetadata(courtCase.id);
    const version = existing ? existing.version + 1 : 1;

    const metadata: CaseMetadata = {
      dataType: 'case',
      documentId: courtCase.id,
      caseNumber: courtCase.caseNumber,
      courtName: courtCase.court,
      judgmentDate: courtCase.date,
      caseType: this.determineCaseType(courtCase),
      chunkCount,
      collectedAt: existing?.collectedAt || now,
      lastUpdated: now,
      vectorStatus,
      version,
    };

    const command = new PutCommand({
      TableName: this.config.tableName,
      Item: metadata,
    });

    await this.dynamoClient.send(command);
  }

  /**
   * DynamoDB에서 판례 메타데이터 조회
   *
   * @param caseId - 판례 ID
   * @returns 메타데이터 또는 null
   */
  async getCaseMetadata(caseId: string): Promise<CaseMetadata | null> {
    const command = new GetCommand({
      TableName: this.config.tableName,
      Key: {
        dataType: 'case',
        documentId: caseId,
      },
    });

    const response = await this.dynamoClient.send(command);

    if (!response.Item) {
      return null;
    }

    return response.Item as CaseMetadata;
  }

  /**
   * 벡터 적재 상태 업데이트
   *
   * @param caseId - 판례 ID
   * @param status - 벡터 적재 상태
   */
  async updateVectorStatus(
    caseId: string,
    status: 'completed' | 'in_progress' | 'failed',
  ): Promise<void> {
    const metadata = await this.getCaseMetadata(caseId);
    if (!metadata) {
      return;
    }

    const updated: CaseMetadata = {
      ...metadata,
      vectorStatus: status,
      lastUpdated: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: this.config.tableName,
      Item: updated,
    });

    await this.dynamoClient.send(command);
  }

  /**
   * 판례 데이터에서 사건 유형을 결정한다.
   *
   * 키워드 기반으로 카테고리 분류한다.
   *
   * @param courtCase - 판례 데이터
   * @returns 사건 유형 문자열
   */
  private determineCaseType(courtCase: CourtCase): string {
    const text = `${courtCase.summary} ${courtCase.keywords.join(' ')}`;

    if (text.includes('임대차') || text.includes('임차인') || text.includes('임대인')) {
      return 'lease';
    }
    if (text.includes('매매') || text.includes('매도') || text.includes('매수')) {
      return 'sale';
    }
    if (text.includes('등기') || text.includes('소유권')) {
      return 'registration';
    }
    if (text.includes('중개') || text.includes('공인중개사')) {
      return 'brokerage';
    }
    if (text.includes('재건축') || text.includes('재개발')) {
      return 'redevelopment';
    }
    return 'general';
  }
}
