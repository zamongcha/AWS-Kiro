/**
 * @fileoverview 피드백 수집 및 검색 품질 관리 모듈
 * @description 사용자 피드백(답변 유용성 평가)을 DynamoDB Feedback 테이블에 수집/저장하고,
 * 피드백 통계를 집계하여 검색 품질 개선에 활용한다.
 *
 * @requirements 3.7 - 검색 로그 저장 (질문, 검색 결과, 클릭 패턴)
 * @requirements 3.8 - 피드백 수집 및 검색 품질 관리
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * 피드백 평가 타입
 */
export type FeedbackRating = 'helpful' | 'not_helpful';

/**
 * 피드백 제출 입력 인터페이스
 */
export interface FeedbackSubmission {
  /** 세션 ID */
  sessionId: string;
  /** 질문 ID */
  questionId: string;
  /** 유용성 평가 */
  rating: FeedbackRating;
  /** 추가 코멘트 (선택) */
  comment?: string;
  /** 원본 검색 질문 (선택) */
  searchQuery?: string;
}

/**
 * 피드백 레코드 인터페이스
 * DynamoDB Feedback 테이블에 저장되는 항목 구조
 */
export interface FeedbackRecord {
  /** 피드백 고유 ID (PK) */
  feedbackId: string;
  /** 세션 ID (GSI-PK) */
  sessionId: string;
  /** 피드백 일시 (GSI-SK, ISO 8601) */
  timestamp: string;
  /** 질문 ID */
  questionId: string;
  /** 유용성 평가 */
  rating: FeedbackRating;
  /** 추가 코멘트 */
  comment?: string;
  /** 원본 검색 질문 */
  searchQuery?: string;
  /** TTL (90일 후 자동 삭제) */
  ttl: number;
}

/**
 * 피드백 통계 인터페이스
 */
export interface FeedbackStats {
  /** 전체 피드백 수 */
  totalFeedbacks: number;
  /** '유용함' 평가 수 */
  helpfulCount: number;
  /** '유용하지 않음' 평가 수 */
  notHelpfulCount: number;
  /** 유용성 비율 (0.0~1.0, 전체 0건이면 0) */
  helpfulRate: number;
  /** 코멘트가 포함된 피드백 수 */
  withCommentCount: number;
  /** 통계 집계 시각 (ISO 8601) */
  calculatedAt: string;
}

/**
 * 피드백 수집기 설정 인터페이스
 */
export interface FeedbackCollectorConfig {
  /** DynamoDB Feedback 테이블 이름 */
  tableName: string;
  /** GSI 이름 (세션별 조회용) */
  sessionIndexName?: string;
  /** AWS 리전 */
  region?: string;
  /** TTL 기간 (일 단위, 기본 90일) */
  ttlDays?: number;
}

/**
 * 피드백 수집기 클래스
 *
 * 사용자 피드백을 DynamoDB Feedback 테이블에 저장하고,
 * 집계 통계를 제공하여 검색 품질 모니터링에 활용한다.
 */
export class FeedbackCollector {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly sessionIndexName: string;
  private readonly ttlDays: number;

  constructor(config: FeedbackCollectorConfig) {
    this.tableName = config.tableName;
    this.sessionIndexName = config.sessionIndexName || 'session-timestamp-index';
    this.ttlDays = config.ttlDays || 90;

    const client = new DynamoDBClient({
      region: config.region || process.env['AWS_REGION'] || 'ap-northeast-2',
    });
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * 피드백 제출
   *
   * 사용자 피드백을 DynamoDB Feedback 테이블에 저장한다.
   * feedbackId는 UUID v4로 자동 생성하며, TTL은 90일 후로 설정한다.
   *
   * @param submission - 피드백 제출 데이터
   * @returns 저장된 피드백 레코드
   */
  async submitFeedback(submission: FeedbackSubmission): Promise<FeedbackRecord> {
    const now = new Date();
    const ttlDate = new Date(now.getTime() + this.ttlDays * 24 * 60 * 60 * 1000);

    const record: FeedbackRecord = {
      feedbackId: this.generateId(),
      sessionId: submission.sessionId,
      timestamp: now.toISOString(),
      questionId: submission.questionId,
      rating: submission.rating,
      comment: submission.comment,
      searchQuery: submission.searchQuery,
      ttl: Math.floor(ttlDate.getTime() / 1000),
    };

    const command = new PutCommand({
      TableName: this.tableName,
      Item: record,
    });

    await this.docClient.send(command);
    return record;
  }

  /**
   * 피드백 통계 조회
   *
   * Feedback 테이블의 전체 데이터를 스캔하여
   * 유용성 평가 분포 및 코멘트 포함 비율을 집계한다.
   *
   * @returns 피드백 통계 요약
   */
  async getFeedbackStats(): Promise<FeedbackStats> {
    const records = await this.scanAllFeedbacks();

    let helpfulCount = 0;
    let notHelpfulCount = 0;
    let withCommentCount = 0;

    for (const record of records) {
      if (record.rating === 'helpful') {
        helpfulCount++;
      } else {
        notHelpfulCount++;
      }
      if (record.comment && record.comment.trim().length > 0) {
        withCommentCount++;
      }
    }

    const totalFeedbacks = records.length;
    const helpfulRate = totalFeedbacks > 0 ? helpfulCount / totalFeedbacks : 0;

    return {
      totalFeedbacks,
      helpfulCount,
      notHelpfulCount,
      helpfulRate,
      withCommentCount,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * 세션별 피드백 조회
   *
   * GSI를 사용하여 특정 세션에 대한 피드백 목록을 조회한다.
   *
   * @param sessionId - 세션 ID
   * @returns 해당 세션의 피드백 레코드 목록
   */
  async getFeedbackBySession(sessionId: string): Promise<FeedbackRecord[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: this.sessionIndexName,
      KeyConditionExpression: 'sessionId = :sid',
      ExpressionAttributeValues: {
        ':sid': sessionId,
      },
    });

    const response = await this.docClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map(item => ({
      feedbackId: item['feedbackId'] as string,
      sessionId: item['sessionId'] as string,
      timestamp: item['timestamp'] as string,
      questionId: item['questionId'] as string,
      rating: item['rating'] as FeedbackRating,
      comment: item['comment'] as string | undefined,
      searchQuery: item['searchQuery'] as string | undefined,
      ttl: item['ttl'] as number,
    }));
  }

  /**
   * Feedback 테이블 전체 스캔
   * 페이지네이션을 처리하여 모든 피드백 레코드를 반환한다.
   */
  private async scanAllFeedbacks(): Promise<FeedbackRecord[]> {
    const records: FeedbackRecord[] = [];
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
            feedbackId: item['feedbackId'] as string,
            sessionId: item['sessionId'] as string,
            timestamp: item['timestamp'] as string,
            questionId: item['questionId'] as string,
            rating: item['rating'] as FeedbackRating,
            comment: item['comment'] as string | undefined,
            searchQuery: item['searchQuery'] as string | undefined,
            ttl: item['ttl'] as number,
          });
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return records;
  }

  /**
   * 간단한 고유 ID 생성
   * crypto.randomUUID()가 가용하지 않을 경우 대체 로직을 제공한다.
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `fb-${timestamp}-${randomPart}`;
  }
}
