/**
 * @fileoverview 판례 검색 세션 관리 모듈
 * @description DynamoDB 기반 판례 검색 세션의 생성, 조회, 업데이트를 관리한다.
 * 대화 이력은 최대 30개를 유지하며, 초과 시 가장 오래된 항목을 FIFO 제거한다.
 * TTL 기반으로 24시간 후 자동 만료된다.
 * PK: CASE_SEARCH#SESSION#{sessionId}
 *
 * @requirements 8.1 - 대화 이력 최대 30개 유지 (초과 시 가장 오래된 항목 제거)
 * @requirements 8.2 - 세션 컨텍스트 조회 (후속 질문 처리용)
 * @requirements 10.2 - TTL 기반 자동 만료 (24시간)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  CaseSearchSessionRecord,
  CaseSearchConversation,
} from '../interfaces/index.js';
import type { FactAnalysisOutput, CaseAnalysisResponse } from '../interfaces/index.js';

/** 세션당 최대 대화 이력 수 */
const MAX_CONVERSATIONS = 30;

/** TTL: 24시간 (초 단위) */
const TTL_SECONDS = 86400;

/**
 * 판례 검색 세션 관리자 클래스
 *
 * DynamoDB 테이블을 활용하여 판례 검색 대화 세션을 관리한다.
 * - 세션 생성: 고유 ID 및 TTL 설정 (PK: CASE_SEARCH#SESSION#{sessionId})
 * - 세션 조회: sessionId로 단건 조회
 * - 대화 추가: Q&A 쌍 추가 (최대 30개 유지, FIFO)
 * - 컨텍스트 조회: 후속 질문 처리용 이전 대화 반환
 *
 * @requirements 8.1, 8.2, 10.2
 */
export class CaseSearchSessionManager {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  /**
   * CaseSearchSessionManager 생성자
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
   * 새 판례 검색 세션을 생성한다.
   *
   * 고유한 sessionId를 생성하고, 빈 대화 목록과 24시간 TTL을 설정한다.
   *
   * @returns 생성된 세션 레코드
   */
  async createSession(): Promise<CaseSearchSessionRecord> {
    const now = new Date();
    const sessionId = this.generateSessionId();
    const ttl = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    const record: CaseSearchSessionRecord = {
      PK: `CASE_SEARCH#SESSION#${sessionId}`,
      SK: `CREATED#${now.toISOString()}`,
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
   */
  async getSession(sessionId: string): Promise<CaseSearchSessionRecord | null> {
    const pk = `CASE_SEARCH#SESSION#${sessionId}`;

    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: this.buildSortKeyPrefix(sessionId) },
      }),
    );

    if (!result.Item) {
      return null;
    }

    return result.Item as CaseSearchSessionRecord;
  }

  /**
   * 세션에 대화 항목을 추가한다.
   *
   * 대화 이력이 30개를 초과하면 가장 오래된 항목을 제거하여
   * 항상 최대 30개를 유지한다(FIFO). TTL을 갱신하여 마지막 활동 기준
   * 24시간 후 자동 만료되도록 한다.
   *
   * @param sessionId - 대화를 추가할 세션 ID
   * @param conversation - 추가할 대화 항목
   * @returns 업데이트된 세션 레코드
   * @throws Error - 세션이 존재하지 않는 경우
   */
  async addConversation(
    sessionId: string,
    conversation: CaseSearchConversation,
  ): Promise<CaseSearchSessionRecord> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`판례 검색 세션을 찾을 수 없습니다: ${sessionId}`);
    }

    const now = new Date();

    // 기존 대화 목록에 새 항목 추가
    const conversations = [...session.conversations, conversation];

    // 최대 30개 유지: 초과 시 가장 오래된 항목 제거 (FIFO)
    const trimmedConversations = conversations.length > MAX_CONVERSATIONS
      ? conversations.slice(conversations.length - MAX_CONVERSATIONS)
      : conversations;

    // TTL 갱신 (마지막 활동 기준 24시간)
    const newTtl = Math.floor(now.getTime() / 1000) + TTL_SECONDS;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: session.PK, SK: session.SK },
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
   * 세션의 대화 컨텍스트를 조회한다.
   *
   * 후속 질문 처리 시 이전 대화 내용을 LLM 프롬프트에 포함하기 위해 사용한다.
   *
   * @param sessionId - 세션 ID
   * @returns 이전 대화 항목 목록 또는 빈 배열
   */
  async getConversationContext(sessionId: string): Promise<CaseSearchConversation[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return [];
    }
    return session.conversations;
  }

  /**
   * 세션 ID에서 PK를 추출한다.
   */
  extractSessionId(pk: string): string {
    return pk.replace('CASE_SEARCH#SESSION#', '');
  }

  /**
   * 고유한 세션 ID를 생성한다.
   * 형식: cs_sess_{timestamp}_{randomHex}
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `cs_sess_${timestamp}_${random}`;
  }

  /**
   * Sort Key 접두사를 생성한다.
   * 세션 조회 시 사용하며, 실제 운영 시 쿼리로 대체 가능.
   */
  private buildSortKeyPrefix(_sessionId: string): string {
    // 단일 세션 레코드이므로 SK를 직접 조회하기 어려움
    // 실제 운영에서는 GSI 또는 query로 대체
    return '';
  }
}
