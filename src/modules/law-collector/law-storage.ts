/**
 * @fileoverview 법령 데이터 저장 모듈
 * @description S3에 원본 법령 데이터를 저장하고, DynamoDB에 메타데이터를 기록한다.
 * 또한 개정 여부를 감지하여 데이터 갱신이 필요한지 판단한다.
 *
 * @requirements 1.3 - 법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력을 구조화하여 저장
 * @requirements 1.4 - 매일 1회 법령 개정 여부를 확인하고 변경 사항이 있으면 데이터를 갱신
 * @requirements 1.7 - 수집된 데이터는 Amazon S3에 원본, DynamoDB에 메타데이터
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LawArticle } from '../../common/interfaces/index.js';

/**
 * 법령 메타데이터 인터페이스
 *
 * DynamoDB DataManagement 테이블에 저장되는 법령 메타데이터.
 */
export interface LawMetadata {
  /** 데이터 유형 (PK) */
  dataType: 'law';
  /** 법령 문서 고유 ID (SK) */
  documentId: string;
  /** 법령명 */
  title: string;
  /** 시행일자 (ISO 8601) */
  effectiveDate: string;
  /** 조문 수 */
  articleCount: number;
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
 * 법령 저장 설정 인터페이스
 */
export interface LawStorageConfig {
  /** S3 버킷 이름 */
  bucketName: string;
  /** DynamoDB 테이블 이름 */
  tableName: string;
  /** AWS 리전 */
  region: string;
}

/** 기본 설정 */
const DEFAULT_CONFIG: LawStorageConfig = {
  bucketName: `real-estate-legal-data-${process.env['ENVIRONMENT'] || 'dev'}`,
  tableName: 'DataManagement',
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
};

/**
 * 법령 데이터 저장 서비스
 *
 * S3에 원본 법령 데이터(JSON 형식)를 저장하고,
 * DynamoDB에 메타데이터(법령명, 시행일자, 조문 수, 수집일시, 상태)를 기록한다.
 * 개정 여부 감지를 통해 데이터 갱신 시점을 판단한다.
 */
export class LawStorage {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private config: LawStorageConfig;

  constructor(config: Partial<LawStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.s3Client = new S3Client({ region: this.config.region });
    const ddbClient = new DynamoDBClient({ region: this.config.region });
    this.dynamoClient = DynamoDBDocumentClient.from(ddbClient);
  }

  /**
   * 법령 데이터 저장
   *
   * 법령 조문 목록을 S3에 원본 JSON으로 저장하고,
   * DynamoDB에 메타데이터를 기록한다.
   * S3 경로: raw/laws/{law_id}/{version}/full.json
   *
   * @param articles - 저장할 법령 조문 목록
   */
  async saveLawData(articles: LawArticle[]): Promise<void> {
    if (articles.length === 0) {
      return;
    }

    // 법령 ID를 첫 번째 조문의 id에서 추출 (법령 단위로 그룹핑)
    const lawGroups = this.groupArticlesByLaw(articles);

    for (const [lawId, lawArticles] of Object.entries(lawGroups)) {
      // 현재 메타데이터 조회하여 버전 결정
      const existingMetadata = await this.getLawMetadata(lawId);
      const version = existingMetadata ? existingMetadata.version + 1 : 1;

      // S3에 원본 데이터 저장
      await this.saveToS3(lawId, version, lawArticles);

      // DynamoDB에 메타데이터 저장
      const lawName = lawArticles[0].lawName;
      const effectiveDate = lawArticles[0].effectiveDate;
      await this.saveMetadata(lawId, lawName, effectiveDate, lawArticles.length, version);
    }
  }

  /**
   * 법령 메타데이터 조회
   *
   * DynamoDB에서 특정 법령의 메타데이터를 조회한다.
   *
   * @param lawId - 법령 고유 ID
   * @returns 메타데이터 또는 null (미존재 시)
   */
  async getLawMetadata(lawId: string): Promise<LawMetadata | null> {
    const command = new GetCommand({
      TableName: this.config.tableName,
      Key: {
        dataType: 'law',
        documentId: lawId,
      },
    });

    const response = await this.dynamoClient.send(command);

    if (!response.Item) {
      return null;
    }

    return response.Item as LawMetadata;
  }

  /**
   * 개정 여부 감지
   *
   * 저장된 시행일자와 새로 수집한 시행일자를 비교하여
   * 법령이 개정되었는지 판단한다.
   *
   * @param lawId - 법령 고유 ID
   * @param effectiveDate - 새로 수집된 시행일자
   * @returns 개정 여부 (true: 갱신 필요)
   */
  async checkRevisionNeeded(lawId: string, effectiveDate: string): Promise<boolean> {
    const metadata = await this.getLawMetadata(lawId);

    // 메타데이터가 없으면 신규 → 저장 필요
    if (!metadata) {
      return true;
    }

    // 시행일자가 다르면 개정된 것으로 판단
    return metadata.effectiveDate !== effectiveDate;
  }

  /**
   * S3에 법령 원본 데이터 저장
   *
   * @param lawId - 법령 ID
   * @param version - 문서 버전
   * @param articles - 조문 목록
   */
  private async saveToS3(lawId: string, version: number, articles: LawArticle[]): Promise<void> {
    const s3Key = `raw/laws/${lawId}/${version}/full.json`;
    const body = JSON.stringify({
      lawId,
      version,
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
   * DynamoDB에 메타데이터 저장
   *
   * @param lawId - 법령 ID
   * @param lawName - 법령명
   * @param effectiveDate - 시행일자
   * @param articleCount - 조문 수
   * @param version - 문서 버전
   */
  private async saveMetadata(
    lawId: string,
    lawName: string,
    effectiveDate: string,
    articleCount: number,
    version: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const metadata: LawMetadata = {
      dataType: 'law',
      documentId: lawId,
      title: lawName,
      effectiveDate,
      articleCount,
      collectedAt: now,
      lastUpdated: now,
      vectorStatus: 'in_progress',
      version,
    };

    const command = new PutCommand({
      TableName: this.config.tableName,
      Item: metadata,
    });

    await this.dynamoClient.send(command);
  }

  /**
   * 벡터 적재 상태 업데이트
   *
   * 임베딩 및 OpenSearch 적재 완료 후 상태를 갱신한다.
   *
   * @param lawId - 법령 ID
   * @param status - 벡터 적재 상태
   */
  async updateVectorStatus(
    lawId: string,
    status: 'completed' | 'in_progress' | 'failed',
  ): Promise<void> {
    const metadata = await this.getLawMetadata(lawId);
    if (!metadata) {
      return;
    }

    const updated: LawMetadata = {
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
   * 법령별 조문 그룹핑
   *
   * 조문 목록을 법령 ID 기준으로 그룹핑한다.
   * 법령 ID는 조문 ID에서 마지막 '_조문번호' 부분을 제거하여 추출한다.
   *
   * @param articles - 조문 목록
   * @returns 법령 ID → 조문 목록 매핑
   */
  private groupArticlesByLaw(articles: LawArticle[]): Record<string, LawArticle[]> {
    const groups: Record<string, LawArticle[]> = {};

    for (const article of articles) {
      // 법령 ID 추출: "{lawId}_{articleNumber}" 형식에서 lawId 부분
      const lastUnderscore = article.id.lastIndexOf('_');
      const lawId = lastUnderscore > 0 ? article.id.substring(0, lastUnderscore) : article.id;

      if (!groups[lawId]) {
        groups[lawId] = [];
      }
      groups[lawId].push(article);
    }

    return groups;
  }
}
