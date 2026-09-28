/**
 * @fileoverview 세션 관리 모듈
 * @description DynamoDB 기반 사용자 대화 세션의 생성, 조회, 업데이트를 관리한다.
 * 대화 이력은 최대 50개를 유지하며, 초과 시 가장 오래된 항목을 제거한다.
 * TTL 기반으로 24시간 후 자동 만료된다.
 *
 * @requirements 6.6 - 대화 이력 최대 50개 유지 (초과 시 가장 오래된 항목 제거)
 * @requirements 6.8 - TTL 기반 자동 만료 (24시간)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Citation, ConversationEntry } from '../../common/interfaces/data-models.js';

/** 세션당 최대 대화 이력 수 */
const MAX_CONVERSATIONS = 50;

/** TTL: 24시간 (초 단위) */
const TTL_SECONDS = 86400;

/**
 * DynamoDB에 저장되는 세션 레코드 인터페이스
 */
export interface StoredSessionRecord {
  /** 세션 고유 ID */
  sessionId: string;
  /** 생성 일시 (ISO 8601) */
  createdAt: string;
  /** 대화 항목 목록 (최대 50개) */
  conversations: ConversationEntry[];
  /** 마지막 활동 일시 (ISO 8601) */
  lastActivityAt: string;
  /** TTL (Unix timestamp, 초 단위) */
  ttl: number;
}

/**
 * 세션 관리자 클래스
 *
 * DynamoDB Sessions 테이블을 활용하여 사용자 대화 세션을 관리한다.
 * - 세션 생성: 고유 ID 및 TTL 설정
 * - 세션 조회: sessionId로 단건 조회
 * - 대화 추가: Q&A 쌍 추가 (최대 50개 유지)
 *
 * @requirements 6.6, 6.8
 */
export class SessionManager {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  /**
   * SessionManager 생성자
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
   * 새 세션을 생성한다.
   *
   * 고유한 sessionId를 생성하고, 빈 대화 목록과 24시간 TTL을 설정한다.
   *
   * @returns 생성된 세션 레코드
   *
   * @example
   * ```typescript
   * const manager = new SessionManager();
   * const session = await manager.createSession();
   * console.log(session.sessionId); // "sess_1234567890_abc123"
   * ```
   */
  async createSession(): Promise<StoredSessionRecord> {
    const now = new Date();
    const sessionId = this.generateSessionId();
    const ttl = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    const record: StoredSessionRecord = {
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
   * sessionId로 세션을 조회한다.
   *
   * @param sessionId - 조회할 세션 ID
   * @returns 세션 레코드 또는 null (존재하지 않는 경우)
   *
   * @example
   * ```typescript
   * const session = await manager.getSession("sess_1234567890_abc123");
   * if (session) {
   *   console.log(session.conversations.length);
   * }
   * ```
   */
  async getSession(sessionId: string): Promise<StoredSessionRecord | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { sessionId },
      }),
    );

    if (!result.Item) {
      return null;
    }

    return result.Item as StoredSessionRecord;
  }

  /**
   * 세션에 대화 항목을 추가한다.
   *
   * 대화 이력이 50개를 초과하면 가장 오래된 항목을 제거하여
   * 항상 최대 50개를 유지한다. TTL을 갱신하여 마지막 활동 기준
   * 24시간 후 자동 만료되도록 한다.
   *
   * @param sessionId - 대화를 추가할 세션 ID
   * @param question - 사용자 질문
   * @param answer - AI 답변
   * @param citations - 인용 정보 목록
   * @returns 업데이트된 세션 레코드
   * @throws Error - 세션이 존재하지 않는 경우
   *
   * @example
   * ```typescript
   * const updated = await manager.addConversation(
   *   "sess_1234567890_abc123",
   *   "임대차보호법에서 보증금 반환 기한은?",
   *   "주택임대차보호법 제3조의2에 따르면...",
   *   [{ type: CitationType.LAW, source: "주택임대차보호법", content: "...", confidence: 0.9 }]
   * );
   * ```
   */
  async addConversation(
    sessionId: string,
    question: string,
    answer: string,
    citations: Citation[],
  ): Promise<StoredSessionRecord> {
    // 현재 세션 조회
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`세션을 찾을 수 없습니다: ${sessionId}`);
    }

    const now = new Date();
    const newEntry: ConversationEntry = {
      id: this.generateConversationId(),
      timestamp: now.toISOString(),
      question,
      answer,
      citations,
    };

    // 기존 대화 목록에 새 항목 추가
    const conversations = [...session.conversations, newEntry];

    // 최대 50개 유지: 초과 시 가장 오래된 항목 제거
    const trimmedConversations = conversations.length > MAX_CONVERSATIONS
      ? conversations.slice(conversations.length - MAX_CONVERSATIONS)
      : conversations;

    // TTL 갱신 (마지막 활동 기준 24시간)
    const newTtl = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { sessionId },
        UpdateExpression: 'SET conversations = :conversations, lastActivityAt = :lastActivity, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#ttl': 'ttl',
        },
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
   * 고유한 세션 ID를 생성한다.
   * 형식: sess_{timestamp}_{randomHex}
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `sess_${timestamp}_${random}`;
  }

  /**
   * 고유한 대화 항목 ID를 생성한다.
   * 형식: conv_{timestamp}_{randomHex}
   */
  private generateConversationId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `conv_${timestamp}_${random}`;
  }
}
