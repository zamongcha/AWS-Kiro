/**
 * @fileoverview 세무 세션 관리 모듈
 * @description DynamoDB 기반 세무 자문 대화 세션의 생성, 조회, 업데이트를 관리한다.
 * 대화 이력은 최대 50개를 유지하며, 초과 시 가장 오래된 항목을 제거한다(FIFO).
 * TTL 기반으로 24시간 후 자동 만료된다.
 * 파티션 키: TAX#SESSION#{sessionId}
 *
 * @requirements 8.6, 8.8, 10.2
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { TaxCitation, TaxCalculationResult, TaxSavingTip } from '../interfaces/index.js';

/** 세션당 최대 대화 이력 수 */
const MAX_CONVERSATIONS = 50;

/** TTL: 24시간 (초 단위) */
const TTL_SECONDS = 86400;

/** 세무 파티션 키 접두사 */
const TAX_SESSION_PREFIX = 'TAX#SESSION#';

/**
 * 세무 대화 항목 인터페이스
 */
export interface TaxConversationEntry {
  /** 대화 항목 ID */
  questionId: string;
  /** 질문 텍스트 */
  question: string;
  /** 답변 텍스트 */
  answer: string;
  /** 인용 목록 */
  citations: TaxCitation[];
  /** 계산 결과 (해당 시) */
  calculationResult?: TaxCalculationResult;
  /** 절세 포인트 (해당 시) */
  taxSavingTips?: TaxSavingTip[];
  /** 타임스탬프 */
  timestamp: string;
  /** 피드백 */
  feedback?: 'helpful' | 'not_helpful';
}

/**
 * DynamoDB에 저장되는 세무 세션 레코드 인터페이스
 */
export interface TaxSessionRecord {
  /** 파티션 키: TAX#SESSION#{sessionId} */
  PK: string;
  /** 세션 고유 ID */
  sessionId: string;
  /** 생성 일시 (ISO 8601) */
  createdAt: string;
  /** 대화 항목 목록 (최대 50개) */
  conversations: TaxConversationEntry[];
  /** 마지막 활동 일시 (ISO 8601) */
  lastActivityAt: string;
  /** TTL (Unix timestamp, 초 단위) */
  ttl: number;
}

/**
 * 세무 세션 관리자 클래스
 *
 * DynamoDB를 활용하여 세무 자문 대화 세션을 관리한다.
 * 모든 파티션 키는 "TAX#SESSION#" 접두사를 사용하여 법률 자문 데이터와 격리한다.
 *
 * @requirements 8.6, 8.8, 10.2
 */
export class TaxSessionManager {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(
    region: string = 'ap-northeast-2',
    tableName?: string,
    dynamoClient?: DynamoDBClient,
  ) {
    this.tableName = tableName || process.env['SESSIONS_TABLE'] || 'Sessions';

    const client = dynamoClient || new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * 새 세무 세션을 생성한다.
   */
  async createSession(): Promise<TaxSessionRecord> {
    const now = new Date();
    const sessionId = this.generateSessionId();
    const ttl = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    const record: TaxSessionRecord = {
      PK: `${TAX_SESSION_PREFIX}${sessionId}`,
      sessionId,
      createdAt: now.toISOString(),
      conversations: [],
      lastActivityAt: now.toISOString(),
      ttl,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      }),
    );

    return record;
  }

  /**
   * sessionId로 세무 세션을 조회한다.
   */
  async getSession(sessionId: string): Promise<TaxSessionRecord | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `${TAX_SESSION_PREFIX}${sessionId}` },
      }),
    );

    if (!result.Item) {
      return null;
    }

    return result.Item as TaxSessionRecord;
  }

  /**
   * 세션에 대화 항목을 추가한다.
   * 대화 이력이 50개를 초과하면 가장 오래된 항목을 제거한다 (FIFO).
   */
  async addConversation(
    sessionId: string,
    question: string,
    answer: string,
    citations: TaxCitation[],
    calculationResult?: TaxCalculationResult,
    taxSavingTips?: TaxSavingTip[],
  ): Promise<TaxSessionRecord> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`세무 세션을 찾을 수 없습니다: ${sessionId}`);
    }

    const now = new Date();
    const newEntry: TaxConversationEntry = {
      questionId: this.generateConversationId(),
      question,
      answer,
      citations,
      calculationResult,
      taxSavingTips,
      timestamp: now.toISOString(),
    };

    const conversations = [...session.conversations, newEntry];

    // 최대 50개 유지: 초과 시 가장 오래된 항목 제거 (FIFO)
    const trimmedConversations = conversations.length > MAX_CONVERSATIONS
      ? conversations.slice(conversations.length - MAX_CONVERSATIONS)
      : conversations;

    const newTtl = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `${TAX_SESSION_PREFIX}${sessionId}` },
        UpdateExpression: 'SET conversations = :conversations, lastActivityAt = :lastActivity, #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':conversations': trimmedConversations,
          ':lastActivity': now.toISOString(),
          ':ttl': newTtl,
        },
      }),
    );

    return {
      ...session,
      conversations: trimmedConversations,
      lastActivityAt: now.toISOString(),
      ttl: newTtl,
    };
  }

  /**
   * 세션의 대화 컨텍스트를 문자열 배열로 반환한다.
   */
  getConversationContext(session: TaxSessionRecord): string[] {
    return session.conversations.map(
      (conv) => `Q: ${conv.question}\nA: ${conv.answer}`,
    );
  }

  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `tax_${timestamp}_${random}`;
  }

  private generateConversationId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `tconv_${timestamp}_${random}`;
  }
}
