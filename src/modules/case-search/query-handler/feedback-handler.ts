/**
 * @fileoverview 판례 검색 피드백 핸들러
 * @description 사용자 피드백(helpful/not_helpful)을 DynamoDB에 저장한다.
 * PK: CASE_SEARCH#FEEDBACK#{sessionId}
 *
 * @requirements 9.2 - 피드백 수집 및 저장
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DisputeType } from '../interfaces/index.js';

/**
 * 피드백 입력 인터페이스
 */
export interface FeedbackInput {
  /** 세션 ID */
  sessionId: string;
  /** 질문 ID */
  questionId: string;
  /** 유용성 평가 */
  rating: 'helpful' | 'not_helpful';
  /** 분쟁 유형 (선택) */
  disputeType?: DisputeType;
}

/**
 * 피드백 레코드 인터페이스
 */
export interface FeedbackRecord {
  PK: string;
  SK: string;
  questionId: string;
  rating: 'helpful' | 'not_helpful';
  disputeType?: DisputeType;
  timestamp: string;
}

/**
 * 피드백 핸들러 클래스
 *
 * 사용자 피드백을 DynamoDB에 저장한다.
 */
export class FeedbackHandler {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(
    region: string = 'ap-northeast-2',
    tableName?: string,
    dynamoClient?: DynamoDBClient,
  ) {
    this.tableName = tableName || process.env['FEEDBACK_TABLE'] || 'Feedback';

    const client = dynamoClient || new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  /**
   * 피드백을 제출한다.
   *
   * @param input - 피드백 입력
   */
  async submitFeedback(input: FeedbackInput): Promise<void> {
    const now = new Date();

    const record: FeedbackRecord = {
      PK: `CASE_SEARCH#FEEDBACK#${input.sessionId}`,
      SK: `#${now.toISOString()}`,
      questionId: input.questionId,
      rating: input.rating,
      disputeType: input.disputeType,
      timestamp: now.toISOString(),
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      }),
    );
  }
}
