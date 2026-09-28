/**
 * @fileoverview 예규/심판례 데이터 저장 모듈
 * @description S3에 원본 예규/심판례 데이터를 저장하고, DynamoDB에 메타데이터를 기록한다.
 * 청크 분할된 데이터도 S3에 함께 저장한다.
 *
 * @requirements 2.3 - 문서번호, 회신일자, 문서 유형, 세목 분류, 질의 요지, 회신 내용, 참조 세법 조항 구조화 저장
 * @requirements 2.7 - 청크 분할 데이터 저장
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { TaxRuling } from '../interfaces/index.js';
import type { TaxDataManagementRecord } from '../interfaces/index.js';

/**
 * 예규 저장 설정 인터페이스
 */
export interface RulingStorageConfig {
  /** S3 버킷 이름 */
  bucketName: string;
  /** DynamoDB 테이블 이름 */
  tableName: string;
  /** AWS 리전 */
  region: string;
}

/** 기본 설정 */
const DEFAULT_CONFIG: RulingStorageConfig = {
  bucketName: process.env['S3_BUCKET'] || `real-estate-legal-data-${process.env['ENVIRONMENT'] || 'dev'}`,
  tableName: process.env['DYNAMODB_TABLE'] || 'DataManagement',
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
};

/**
 * 예규/심판례 데이터 저장 서비스
 *
 * S3에 원본 예규 데이터(JSON 형식) 및 청크 데이터를 저장하고,
 * DynamoDB에 메타데이터를 기록한다. 파티션 키는 TAX#DATA#ruling 형식을 사용한다.
 *
 * S3 경로:
 * - 원본: tax-data/raw/rulings/{ruling_id}/full.json
 * - 청크: tax-data/raw/rulings/{ruling_id}/chunks/{index}.json
 *
 * DynamoDB: PK=TAX#DATA#ruling, SK=documentId
 */
export class RulingStorage {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private config: RulingStorageConfig;

  constructor(config: Partial<RulingStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.s3Client = new S3Client({ region: this.config.region });
    const ddbClient = new DynamoDBClient({ region: this.config.region });
    this.dynamoClient = DynamoDBDocumentClient.from(ddbClient);
  }

  /**
   * 예규/심판례 목록을 S3와 DynamoDB에 저장한다.
   *
   * 각 예규를 S3에 원본 JSON으로 저장하고, DynamoDB에 메타데이터를 기록한다.
   *
   * @param rulings - 저장할 예규 목록
   */
  async save(rulings: TaxRuling[]): Promise<void> {
    if (rulings.length === 0) {
      return;
    }

    for (const ruling of rulings) {
      const rulingId = ruling.metadata.rulingId;

      // S3에 원본 데이터 저장
      await this.saveToS3(rulingId, ruling);

      // DynamoDB에 메타데이터 저장
      await this.saveMetadata(rulingId, ruling);
    }
  }

  /**
   * 예규의 청크 데이터를 S3에 저장한다.
   *
   * @param rulingId - 예규 고유 ID
   * @param chunks - 청크 내용 배열
   */
  async saveChunks(rulingId: string, chunks: string[]): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      const s3Key = `tax-data/raw/rulings/${rulingId}/chunks/${i}.json`;
      const body = JSON.stringify({
        rulingId,
        chunkIndex: i,
        totalChunks: chunks.length,
        content: chunks[i],
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
  }

  /**
   * 특정 예규의 메타데이터를 조회한다.
   *
   * @param rulingId - 예규 고유 ID
   * @returns 메타데이터 레코드 또는 null
   */
  async getMetadata(rulingId: string): Promise<TaxDataManagementRecord | null> {
    const command = new GetCommand({
      TableName: this.config.tableName,
      Key: {
        PK: 'TAX#DATA#ruling',
        SK: rulingId,
      },
    });

    const response = await this.dynamoClient.send(command);

    if (!response.Item) {
      return null;
    }

    return response.Item as TaxDataManagementRecord;
  }

  /**
   * 벡터 적재 상태를 업데이트한다.
   *
   * @param rulingId - 예규 고유 ID
   * @param status - 벡터 적재 상태
   */
  async updateVectorStatus(
    rulingId: string,
    status: 'completed' | 'in_progress' | 'failed',
  ): Promise<void> {
    const existing = await this.getMetadata(rulingId);
    if (!existing) {
      return;
    }

    const updated: TaxDataManagementRecord = {
      ...existing,
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
   * S3에 예규 원본 데이터를 저장한다.
   *
   * @param rulingId - 예규 고유 ID
   * @param ruling - 예규 데이터
   */
  private async saveToS3(rulingId: string, ruling: TaxRuling): Promise<void> {
    const s3Key = `tax-data/raw/rulings/${rulingId}/full.json`;
    const body = JSON.stringify({
      rulingId,
      ruling,
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
   * DynamoDB에 예규 메타데이터를 저장한다.
   *
   * @param rulingId - 예규 고유 ID
   * @param ruling - 예규 데이터
   */
  private async saveMetadata(rulingId: string, ruling: TaxRuling): Promise<void> {
    const now = new Date().toISOString();

    // 기존 메타데이터 조회하여 버전 결정
    const existing = await this.getMetadata(rulingId);
    const version = existing ? existing.version + 1 : 1;

    const record: TaxDataManagementRecord = {
      PK: 'TAX#DATA#ruling',
      SK: rulingId,
      title: `${ruling.documentType} - ${ruling.documentNumber}`,
      lastUpdated: now,
      vectorStatus: 'in_progress',
      version,
      taxType: ruling.taxCategory,
      metadata: {
        documentNumber: ruling.documentNumber,
        replyDate: ruling.replyDate,
        documentType: ruling.documentType,
        referencedLawArticles: ruling.referencedLawArticles,
        source: ruling.metadata.source,
        collectedAt: now,
      },
    };

    const command = new PutCommand({
      TableName: this.config.tableName,
      Item: record,
    });

    await this.dynamoClient.send(command);
  }
}
