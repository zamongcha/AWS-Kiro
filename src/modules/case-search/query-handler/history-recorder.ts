/**
 * @fileoverview 판례 검색 이력 기록 모듈
 * @description 판례 검색 이력을 DynamoDB에 기록한다.
 * PK: CASE_SEARCH#HISTORY#{YYYY-MM-DD}
 * SK: #{ISO timestamp}#{requestId}
 *
 * 분쟁 유형, 검색 쿼리, 결과 수, 최고 유사도 점수를 기록하여
 * 서비스 개선에 활용한다.
 *
 * @requirements 8.1 - 검색 이력 기록
 * @requirements 10.2 - DynamoDB CASE_SEARCH# 접두사 데이터 격리
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DisputeType, CaseSearchHistoryRecord } from '../interfaces/index.js';

/**
 * 검색 이력 기록기 클래스
 *
 * 판례 검색 실행 이력을 DynamoDB에 기록한다.
 * 날짜별 파티션(CASE_SEARCH#HISTORY#{YYYY-MM-DD})으로 데이터를 구분한다.
 *
 * @requirements 8.1, 10.2
 */
export class SearchHistoryRecorder {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  /**
   * SearchHistoryRecorder 생성자
   *
   * @param region - AWS 리전 (기본값: 'ap-northeast-2')
   * @param tableName - DynamoDB 테이블 이름 (기본값: process.env['SESSIONS_TABLE'] || 'Sessions')
   * @param dynamoClient - 테스트용 DynamoDB 클라이언트 주입 (선택)
   */
  constructor(
    region: string = 'ap-northeast-2',
    tableName?: string,
    dynamoClient?: DynamoDBClient,
  ) {
    this.tableName = tableName || process.env['SESSIONS_TABLE'] || 'Sessions';

    const client = dynamoClient || new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  /**
   * 검색 이력을 기록한다.
   *
   * @param sessionId - 세션 ID
   * @param disputeTypes - 분류된 분쟁 유형 목록
   * @param searchQuery - 원본 상황 설명
   * @param resultCount - 검색 결과 수
   * @param topSimilarityScore - 최고 유사도 점수
   * @param processingTimeMs - 처리 소요 시간 (ms)
   *
   * @example
   * ```typescript
   * const recorder = new SearchHistoryRecorder();
   * await recorder.recordSearch(
   *   'cs_sess_123_abc',
   *   ['lease'],
   *   '임대인이 보증금을 반환하지 않습니다',
   *   5,
   *   0.87,
   *   2500
   * );
   * ```
   */
  async recordSearch(
    sessionId: string,
    disputeTypes: DisputeType[],
    searchQuery: string,
    resultCount: number,
    topSimilarityScore: number,
    processingTimeMs?: number,
  ): Promise<void> {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const requestId = this.generateRequestId();

    const record: CaseSearchHistoryRecord = {
      PK: `CASE_SEARCH#HISTORY#${dateStr}`,
      SK: `#${now.toISOString()}#${requestId}`,
      sessionId,
      disputeTypes,
      searchQuery,
      resultCount,
      topSimilarityScore,
      processingTimeMs: processingTimeMs ?? 0,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      }),
    );
  }

  /**
   * 고유한 요청 ID를 생성한다.
   * 형식: req_{randomHex}
   */
  private generateRequestId(): string {
    const random = Math.random().toString(36).substring(2, 10);
    return `req_${random}`;
  }
}
