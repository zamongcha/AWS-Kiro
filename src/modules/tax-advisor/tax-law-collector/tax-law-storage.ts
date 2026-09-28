/**
 * @fileoverview 세법 데이터 저장 모듈
 * @description S3에 원본 세법 데이터를 저장하고, DynamoDB에 메타데이터를 기록한다.
 * 개정 여부를 감지하여 데이터 갱신이 필요한지 판단한다.
 *
 * @requirements 1.3 - 법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력, 적용 세목 구조화 저장
 * @requirements 1.4 - 매일 1회 세법 개정 여부 확인하여 데이터 갱신
 * @requirements 1.7 - S3에 원본, DynamoDB에 메타데이터
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { TaxLawArticle } from '../interfaces/index.js';
import type { TaxDataManagementRecord } from '../interfaces/index.js';

/**
 * 세법 저장 설정 인터페이스
 */
export interface TaxLawStorageConfig {
  /** S3 버킷 이름 */
  bucketName: string;
  /** DynamoDB 테이블 이름 */
  tableName: string;
  /** AWS 리전 */
  region: string;
}

/** 기본 설정 */
const DEFAULT_CONFIG: TaxLawStorageConfig = {
  bucketName: process.env['S3_BUCKET'] || `real-estate-legal-data-${process.env['ENVIRONMENT'] || 'dev'}`,
  tableName: process.env['DYNAMODB_TABLE'] || 'DataManagement',
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
};

/**
 * 세법 데이터 저장 서비스
 *
 * S3에 원본 세법 데이터(JSON 형식)를 저장하고,
 * DynamoDB에 메타데이터를 기록한다. 파티션 키는 TAX#DATA#law 형식을 사용하여
 * 법률 자문 시스템 데이터와 격리한다.
 *
 * S3 경로: tax-data/raw/tax-laws/{law_id}/{version}/full.json
 * DynamoDB: PK=TAX#DATA#law, SK=documentId
 */
export class TaxLawStorage {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private config: TaxLawStorageConfig;

  constructor(config: Partial<TaxLawStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.s3Client = new S3Client({ region: this.config.region });
    const ddbClient = new DynamoDBClient({ region: this.config.region });
    this.dynamoClient = DynamoDBDocumentClient.from(ddbClient);
  }

  /**
   * 세법 조문 목록을 S3와 DynamoDB에 저장한다.
   *
   * 법령별로 그룹핑하여 각 법령의 조문을 S3에 원본 JSON으로 저장하고,
   * DynamoDB에 메타데이터를 기록한다.
   *
   * @param articles - 저장할 세법 조문 목록
   */
  async save(articles: TaxLawArticle[]): Promise<void> {
    if (articles.length === 0) {
      return;
    }

    // 법령 ID별로 조문 그룹핑
    const lawGroups = this.groupArticlesByLaw(articles);

    for (const [lawId, lawArticles] of Object.entries(lawGroups)) {
      // 현재 메타데이터 조회하여 버전 결정
      const existingMetadata = await this.getMetadata(lawId);
      const version = existingMetadata ? existingMetadata.version + 1 : 1;

      // S3에 원본 데이터 저장
      await this.saveToS3(lawId, version, lawArticles);

      // DynamoDB에 메타데이터 저장
      const firstArticle = lawArticles[0];
      await this.saveMetadata(lawId, firstArticle, lawArticles.length, version);
    }
  }

  /**
   * 특정 세법의 메타데이터를 조회한다.
   *
   * @param lawId - 법령 고유 ID
   * @returns 메타데이터 레코드 또는 null
   */
  async getMetadata(lawId: string): Promise<TaxDataManagementRecord | null> {
    const command = new GetCommand({
      TableName: this.config.tableName,
      Key: {
        PK: 'TAX#DATA#law',
        SK: lawId,
      },
    });

    const response = await this.dynamoClient.send(command);

    if (!response.Item) {
      return null;
    }

    return response.Item as TaxDataManagementRecord;
  }

  /**
   * 세법 개정 여부를 확인한다.
   *
   * 저장된 시행일자와 새로 수집한 시행일자를 비교하여
   * 세법이 개정되었는지 판단한다.
   *
   * @param lawId - 법령 고유 ID
   * @param effectiveDate - 새로 수집된 시행일자
   * @returns 개정 여부 (true: 갱신 필요)
   */
  async checkRevisionNeeded(lawId: string, effectiveDate: string): Promise<boolean> {
    const metadata = await this.getMetadata(lawId);

    // 메타데이터가 없으면 신규 → 저장 필요
    if (!metadata) {
      return true;
    }

    // metadata의 추가 필드에서 effectiveDate 비교
    const storedEffectiveDate = metadata.metadata['effectiveDate'] as string | undefined;
    if (!storedEffectiveDate) {
      return true;
    }

    return storedEffectiveDate !== effectiveDate;
  }

  /**
   * 벡터 적재 상태를 업데이트한다.
   *
   * @param lawId - 법령 고유 ID
   * @param status - 벡터 적재 상태
   */
  async updateVectorStatus(
    lawId: string,
    status: 'completed' | 'in_progress' | 'failed',
  ): Promise<void> {
    const existing = await this.getMetadata(lawId);
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
   * S3에 세법 원본 데이터를 저장한다.
   *
   * @param lawId - 법령 ID
   * @param version - 문서 버전
   * @param articles - 조문 목록
   */
  private async saveToS3(lawId: string, version: number, articles: TaxLawArticle[]): Promise<void> {
    const s3Key = `tax-data/raw/tax-laws/${lawId}/${version}/full.json`;
    const body = JSON.stringify({
      lawId,
      version,
      lawName: articles[0].lawName,
      articleCount: articles.length,
      articles,
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
   * DynamoDB에 세법 메타데이터를 저장한다.
   *
   * @param lawId - 법령 ID
   * @param article - 대표 조문 (법령명, 세목 등 참조)
   * @param articleCount - 조문 수
   * @param version - 문서 버전
   */
  private async saveMetadata(
    lawId: string,
    article: TaxLawArticle,
    articleCount: number,
    version: number,
  ): Promise<void> {
    const now = new Date().toISOString();

    const record: TaxDataManagementRecord = {
      PK: 'TAX#DATA#law',
      SK: lawId,
      title: article.lawName,
      lastUpdated: now,
      vectorStatus: 'in_progress',
      version,
      taxType: article.applicableTaxType[0] || 'capital_gains',
      metadata: {
        effectiveDate: article.effectiveDate,
        articleCount,
        source: article.metadata.source,
        collectedAt: now,
        hasRateTable: article.hasRateTable,
      },
    };

    const command = new PutCommand({
      TableName: this.config.tableName,
      Item: record,
    });

    await this.dynamoClient.send(command);
  }

  /**
   * 세법 조문을 법령 ID별로 그룹핑한다.
   *
   * @param articles - 조문 목록
   * @returns 법령 ID → 조문 목록 매핑
   */
  private groupArticlesByLaw(articles: TaxLawArticle[]): Record<string, TaxLawArticle[]> {
    const groups: Record<string, TaxLawArticle[]> = {};

    for (const article of articles) {
      const lawId = article.metadata.lawId;
      if (!groups[lawId]) {
        groups[lawId] = [];
      }
      groups[lawId].push(article);
    }

    return groups;
  }
}
