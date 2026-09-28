/**
 * @fileoverview 데이터 관리 현황 대시보드
 * @description DynamoDB DataManagement 테이블에서 법령/판례 데이터의 수집 상태,
 * 벡터 적재 상태, 최종 갱신 일시 등을 집계하여 반환한다.
 *
 * @requirements 7.1 - 수집된 법령 수, 판례 수 조회
 * @requirements 7.2 - 최종 갱신 일시 조회
 * @requirements 7.3 - 벡터 적재 상태 조회
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * 벡터 적재 상태 타입
 */
export type VectorStatus = 'completed' | 'in_progress' | 'failed';

/**
 * 데이터 관리 레코드 인터페이스
 * DynamoDB DataManagement 테이블의 항목 구조
 */
export interface DataManagementRecord {
  /** 데이터 유형 (PK): 'law' | 'case' */
  dataType: 'law' | 'case';
  /** 문서 고유 ID (SK) */
  documentId: string;
  /** 문서 제목 */
  title: string;
  /** 최종 갱신 일시 (ISO 8601) */
  lastUpdated: string;
  /** 벡터 적재 상태 */
  vectorStatus: VectorStatus;
  /** 문서 버전 */
  version: number;
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * 벡터 상태 집계 인터페이스
 */
export interface VectorStatusSummary {
  /** 적재 완료 건수 */
  completed: number;
  /** 적재 진행 중 건수 */
  inProgress: number;
  /** 적재 실패 건수 */
  failed: number;
}

/**
 * 데이터 현황 인터페이스
 */
export interface DataStatus {
  /** 수집된 법령 총 수 */
  totalLaws: number;
  /** 수집된 판례 총 수 */
  totalCases: number;
  /** 법령 최종 갱신 일시 (ISO 8601, 없으면 null) */
  lastLawUpdate: string | null;
  /** 판례 최종 갱신 일시 (ISO 8601, 없으면 null) */
  lastCaseUpdate: string | null;
  /** 법령 벡터 적재 상태 집계 */
  lawVectorStatus: VectorStatusSummary;
  /** 판례 벡터 적재 상태 집계 */
  caseVectorStatus: VectorStatusSummary;
  /** 조회 시각 (ISO 8601) */
  queriedAt: string;
}

/**
 * 데이터 대시보드 설정 인터페이스
 */
export interface DataDashboardConfig {
  /** DynamoDB 테이블 이름 */
  tableName: string;
  /** AWS 리전 */
  region?: string;
}

/**
 * 데이터 대시보드 클래스
 *
 * DynamoDB DataManagement 테이블을 조회하여 법령/판례 데이터의
 * 수집 현황과 벡터 적재 상태를 집계한다.
 */
export class DataDashboard {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: DataDashboardConfig) {
    this.tableName = config.tableName;

    const client = new DynamoDBClient({
      region: config.region || process.env['AWS_REGION'] || 'ap-northeast-2',
    });
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * 데이터 현황 조회
   *
   * DataManagement 테이블의 전체 레코드를 스캔하여
   * 법령 수, 판례 수, 최종 갱신 일시, 벡터 적재 상태를 집계한다.
   *
   * @returns 데이터 현황 요약
   */
  async getStatus(): Promise<DataStatus> {
    const records = await this.scanAllRecords();

    let totalLaws = 0;
    let totalCases = 0;
    let lastLawUpdate: string | null = null;
    let lastCaseUpdate: string | null = null;
    const lawVectorStatus: VectorStatusSummary = { completed: 0, inProgress: 0, failed: 0 };
    const caseVectorStatus: VectorStatusSummary = { completed: 0, inProgress: 0, failed: 0 };

    for (const record of records) {
      if (record.dataType === 'law') {
        totalLaws++;
        this.incrementVectorStatus(lawVectorStatus, record.vectorStatus);
        if (!lastLawUpdate || record.lastUpdated > lastLawUpdate) {
          lastLawUpdate = record.lastUpdated;
        }
      } else if (record.dataType === 'case') {
        totalCases++;
        this.incrementVectorStatus(caseVectorStatus, record.vectorStatus);
        if (!lastCaseUpdate || record.lastUpdated > lastCaseUpdate) {
          lastCaseUpdate = record.lastUpdated;
        }
      }
    }

    return {
      totalLaws,
      totalCases,
      lastLawUpdate,
      lastCaseUpdate,
      lawVectorStatus,
      caseVectorStatus,
      queriedAt: new Date().toISOString(),
    };
  }

  /**
   * DataManagement 테이블 전체 스캔
   * 페이지네이션을 처리하여 모든 레코드를 반환한다.
   */
  private async scanAllRecords(): Promise<DataManagementRecord[]> {
    const records: DataManagementRecord[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const command = new ScanCommand({
        TableName: this.tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await this.docClient.send(command);

      if (response.Items) {
        for (const item of response.Items) {
          records.push({
            dataType: item['dataType'] as 'law' | 'case',
            documentId: item['documentId'] as string,
            title: (item['title'] as string) || '',
            lastUpdated: (item['lastUpdated'] as string) || '',
            vectorStatus: (item['vectorStatus'] as VectorStatus) || 'failed',
            version: (item['version'] as number) || 1,
            metadata: item['metadata'] as Record<string, unknown> | undefined,
          });
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return records;
  }

  /**
   * 벡터 적재 상태 카운터 증가
   */
  private incrementVectorStatus(summary: VectorStatusSummary, status: VectorStatus): void {
    switch (status) {
      case 'completed':
        summary.completed++;
        break;
      case 'in_progress':
        summary.inProgress++;
        break;
      case 'failed':
        summary.failed++;
        break;
    }
  }
}
