/**
 * @fileoverview 세율 테이블 저장 모듈
 * @description 추출된 세율 테이블을 DynamoDB에 저장하고 버전을 관리한다.
 * 새 버전 생성 시 이전 버전의 expiryDate를 설정하며,
 * S3에 백업을 저장한다.
 *
 * @requirements 1.9 - 세율 테이블 추출 후 저장
 * @requirements 9.8 - 세율 테이블 버전 관리
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { RateTableData, TaxType } from '../interfaces/index.js';
import type { TaxRateRecord } from '../interfaces/index.js';

/**
 * 세율 테이블 저장 설정
 */
export interface RateTableStorageConfig {
  /** DynamoDB 테이블 이름 */
  tableName: string;
  /** S3 버킷 이름 */
  bucketName: string;
  /** AWS 리전 */
  region: string;
}

/** 기본 설정 */
const DEFAULT_CONFIG: RateTableStorageConfig = {
  tableName: process.env['DYNAMODB_TABLE'] || 'DataManagement',
  bucketName: process.env['S3_BUCKET'] || `real-estate-legal-data-${process.env['ENVIRONMENT'] || 'dev'}`,
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
};

/**
 * 세율 테이블 저장 서비스
 *
 * DynamoDB에 세율 테이블을 저장하고 버전 관리를 수행한다.
 * - PK: TAX#RATE#{taxType}
 * - SK: effectiveDate
 * - 버전 관리: 신규 저장 시 이전 버전 expiryDate 설정
 * - S3 백업: tax-data/rate-tables/{taxType}/{effectiveDate}.json
 */
export class RateTableStorage {
  private s3Client: S3Client;
  private dynamoClient: DynamoDBDocumentClient;
  private config: RateTableStorageConfig;

  constructor(config: Partial<RateTableStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.s3Client = new S3Client({ region: this.config.region });
    const ddbClient = new DynamoDBClient({ region: this.config.region });
    this.dynamoClient = DynamoDBDocumentClient.from(ddbClient);
  }

  /**
   * 세율 테이블을 DynamoDB에 저장한다.
   *
   * 동일 세목의 이전 버전이 존재하면 expiryDate를 설정하고
   * 새 버전의 version 번호를 증가시킨다. S3에도 백업을 저장한다.
   *
   * @param rateTable - 저장할 세율 테이블 데이터
   */
  async save(rateTable: RateTableData): Promise<void> {
    const pk = `TAX#RATE#${rateTable.taxType}`;
    const sk = rateTable.effectiveDate;

    // 이전 최신 버전 조회
    const latestRecord = await this.getLatest(rateTable.taxType);

    // 버전 결정
    const newVersion = latestRecord ? latestRecord.version + 1 : 1;

    // 이전 버전의 expiryDate 설정
    if (latestRecord && !latestRecord.expiryDate) {
      await this.setExpiryDate(latestRecord.PK, latestRecord.SK, rateTable.effectiveDate);
    }

    // DynamoDB에 새 레코드 저장
    const record: TaxRateRecord = {
      PK: pk,
      SK: sk,
      version: newVersion,
      brackets: rateTable.brackets,
      specialRates: rateTable.specialRates || [],
      deductions: rateTable.deductions || [],
      sourceArticle: rateTable.sourceArticle,
      expiryDate: rateTable.expiryDate,
    };

    const putCommand = new PutCommand({
      TableName: this.config.tableName,
      Item: record,
    });

    await this.dynamoClient.send(putCommand);

    // S3 백업 저장
    await this.saveBackupToS3(rateTable, newVersion);
  }

  /**
   * 특정 세목의 최신 세율 테이블을 조회한다.
   *
   * effectiveDate 기준 내림차순으로 정렬하여 첫 번째 레코드를 반환한다.
   * expiryDate가 설정되지 않은(현재 유효한) 레코드를 우선 반환한다.
   *
   * @param taxType - 세목 유형
   * @returns 최신 세율 테이블 레코드 또는 null
   */
  async getLatest(taxType: TaxType): Promise<TaxRateRecord | null> {
    const pk = `TAX#RATE#${taxType}`;

    const command = new QueryCommand({
      TableName: this.config.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': pk,
      },
      ScanIndexForward: false, // 내림차순 (최신 먼저)
      Limit: 1,
    });

    const response = await this.dynamoClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    return response.Items[0] as TaxRateRecord;
  }

  /**
   * 특정 세목의 특정 날짜 기준 유효 세율 테이블을 조회한다.
   *
   * effectiveDate <= referenceDate 이고 expiryDate가 없거나 expiryDate > referenceDate인
   * 레코드를 조회한다.
   *
   * @param taxType - 세목 유형
   * @param referenceDate - 기준 날짜 (ISO 8601)
   * @returns 유효한 세율 테이블 레코드 또는 null
   */
  async getEffective(taxType: TaxType, referenceDate: string): Promise<TaxRateRecord | null> {
    const pk = `TAX#RATE#${taxType}`;

    const command = new QueryCommand({
      TableName: this.config.tableName,
      KeyConditionExpression: 'PK = :pk AND SK <= :date',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':date': referenceDate,
      },
      ScanIndexForward: false,
      Limit: 5,
    });

    const response = await this.dynamoClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    // expiryDate가 없거나 referenceDate 이후인 레코드를 찾음
    for (const item of response.Items) {
      const record = item as TaxRateRecord;
      if (!record.expiryDate || record.expiryDate > referenceDate) {
        return record;
      }
    }

    // 모두 만료된 경우 가장 최신 레코드 반환
    return response.Items[0] as TaxRateRecord;
  }

  /**
   * 특정 세목의 모든 세율 테이블 버전을 조회한다.
   *
   * @param taxType - 세목 유형
   * @returns 세율 테이블 레코드 배열 (effectiveDate 내림차순)
   */
  async getAllVersions(taxType: TaxType): Promise<TaxRateRecord[]> {
    const pk = `TAX#RATE#${taxType}`;

    const command = new QueryCommand({
      TableName: this.config.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': pk,
      },
      ScanIndexForward: false,
    });

    const response = await this.dynamoClient.send(command);
    return (response.Items || []) as TaxRateRecord[];
  }

  /**
   * 이전 버전의 만료일을 설정한다.
   *
   * @param pk - 파티션 키
   * @param sk - 정렬 키
   * @param expiryDate - 만료일 (ISO 8601)
   */
  private async setExpiryDate(pk: string, sk: string, expiryDate: string): Promise<void> {
    const command = new UpdateCommand({
      TableName: this.config.tableName,
      Key: { PK: pk, SK: sk },
      UpdateExpression: 'SET expiryDate = :expiry',
      ExpressionAttributeValues: {
        ':expiry': expiryDate,
      },
    });

    await this.dynamoClient.send(command);
  }

  /**
   * S3에 세율 테이블 백업을 저장한다.
   *
   * 경로: tax-data/rate-tables/{taxType}/{effectiveDate}.json
   *
   * @param rateTable - 세율 테이블 데이터
   * @param version - 버전 번호
   */
  private async saveBackupToS3(rateTable: RateTableData, version: number): Promise<void> {
    const s3Key = `tax-data/rate-tables/${rateTable.taxType}/${rateTable.effectiveDate}.json`;
    const body = JSON.stringify({
      ...rateTable,
      version,
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
