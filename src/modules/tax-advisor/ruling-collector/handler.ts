/**
 * @fileoverview 예규/심판례 수집 Lambda 핸들러
 * @description Amazon EventBridge Scheduler에 의해 24시간 간격으로 트리거되어
 * 국세법령정보시스템을 통해 예규/심판례를 수집한다.
 * 전체 파이프라인: 수집 → 청크 분할 → 저장 → 임베딩
 * 수집 실패 시 SNS를 통해 관리자에게 알림을 전송한다.
 *
 * @requirements 2.4 - 24시간 간격 정기 수집
 * @requirements 2.6 - 수집 실패 시 SNS를 통해 관리자에게 알림
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { RulingCollectorModule, RulingCollectionResult } from './index.js';
import { RulingChunkSplitter } from './ruling-chunk-splitter.js';
import { RulingStorage } from './ruling-storage.js';
import { RulingEmbedder, RulingEmbeddingResult } from './ruling-embedder.js';
import { CircuitBreaker, CircuitBreakerOpenError } from '../../../common/utils/circuit-breaker.js';
import type { RulingCollectorOutput, TaxRuling } from '../interfaces/index.js';

/**
 * 예규 수집기 전용 Circuit Breaker
 *
 * Lambda 컨테이너 재사용 시 Circuit Breaker 상태를 유지하여
 * 외부 API 장애 시 불필요한 호출을 방지한다.
 */
const rulingCollectorCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 120000, // 2분 후 반개방 시도
  monitoringWindow: 300000, // 5분 윈도우
});

/**
 * EventBridge 스케줄 이벤트 인터페이스
 */
export interface ScheduledEvent {
  /** 이벤트 상세 유형 (예: 'Scheduled Event') */
  'detail-type': string;
  /** 이벤트 소스 (예: 'aws.scheduler') */
  source: string;
  /** 이벤트 발생 시각 (ISO 8601) */
  time: string;
  /** 이벤트 상세 정보 */
  detail: Record<string, unknown>;
}

/**
 * 구조화된 로그 항목 인터페이스
 */
interface StructuredLog {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * 구조화된 JSON 로그 출력
 */
function logStructured(log: StructuredLog): void {
  console.log(JSON.stringify(log));
}

/**
 * SNS를 통한 수집 실패 알림 전송
 *
 * @param snsClient - SNS 클라이언트 인스턴스
 * @param topicArn - 알림 대상 SNS Topic ARN
 * @param errors - 실패 상세 정보
 * @param phase - 실패 발생 단계
 */
async function sendFailureNotification(
  snsClient: SNSClient,
  topicArn: string,
  errors: Array<{ category?: string; error: string }>,
  phase: string,
): Promise<void> {
  const failedItems = errors.map(e => `- ${e.category || '알 수 없음'}: ${e.error}`).join('\n');
  const message = [
    `[예규수집 실패 알림]`,
    ``,
    `발생 시각: ${new Date().toISOString()}`,
    `실패 단계: ${phase}`,
    `실패 건수: ${errors.length}건`,
    ``,
    `실패 상세:`,
    failedItems,
  ].join('\n');

  const command = new PublishCommand({
    TopicArn: topicArn,
    Subject: '[세무AI] 예규/심판례 수집 실패 알림',
    Message: message,
  });

  await snsClient.send(command);
}

/**
 * 예규/심판례 수집 Lambda 핸들러
 *
 * EventBridge Scheduler에 의해 24시간 간격으로 호출되며,
 * 전체 예규 수집 파이프라인을 실행한다:
 * 1. 예규 데이터 수집 (API 호출, 중복 제거)
 * 2. 청크 분할 (500~1000 토큰)
 * 3. S3 + DynamoDB 저장
 * 4. 임베딩 변환 및 OpenSearch 적재
 *
 * 환경 변수:
 * - NTS_API_KEY: 국세법령정보시스템 API 인증 키
 * - SNS_TOPIC_ARN: 실패 알림 SNS Topic ARN
 * - S3_BUCKET: 원본 데이터 저장 S3 버킷
 * - DYNAMODB_TABLE: 메타데이터 DynamoDB 테이블
 * - OPENSEARCH_ENDPOINT: OpenSearch 엔드포인트
 *
 * @param event - EventBridge 스케줄 이벤트
 */
export const handler = async (event: ScheduledEvent): Promise<void> => {
  const startTime = Date.now();

  logStructured({
    level: 'INFO',
    message: '예규/심판례 수집 작업을 시작합니다.',
    timestamp: new Date().toISOString(),
    event: {
      source: event.source,
      detailType: event['detail-type'],
      time: event.time,
    },
  });

  // 환경 변수 읽기
  const apiKey = process.env['NTS_API_KEY'] || '';
  const snsTopicArn = process.env['SNS_TOPIC_ARN'] || '';
  const s3Bucket = process.env['S3_BUCKET'] || '';
  const dynamoDbTable = process.env['DYNAMODB_TABLE'] || '';
  const openSearchEndpoint = process.env['OPENSEARCH_ENDPOINT'] || '';

  // 모듈 초기화
  const collector = new RulingCollectorModule();
  await collector.initialize({
    name: 'ruling-collector',
    version: '1.0.0',
    enabled: true,
    config: {
      apiKey,
      s3Bucket,
      dynamoDbTable,
      openSearchEndpoint,
    },
  });

  const chunkSplitter = new RulingChunkSplitter();
  const rulingStorage = new RulingStorage({ bucketName: s3Bucket, tableName: dynamoDbTable });
  const rulingEmbedder = new RulingEmbedder({ opensearchEndpoint: openSearchEndpoint });

  // 1단계: 예규 수집 (Circuit Breaker 적용)
  let collectionOutput;
  try {
    collectionOutput = await rulingCollectorCircuitBreaker.execute(() =>
      collector.execute({
        type: 'collect',
        payload: {},
        metadata: {
          triggeredBy: 'eventbridge-scheduler',
        },
      })
    );
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logStructured({
        level: 'WARN',
        message: '예규 수집 Circuit Breaker가 열려 있습니다. 외부 API 장애 복구 대기 중입니다.',
        timestamp: new Date().toISOString(),
        retryAfterMs: error.retryAfter,
      });
      throw new Error(`예규 수집 Circuit Breaker Open: ${Math.ceil(error.retryAfter / 1000)}초 후 재시도 가능`);
    }
    throw error;
  }

  const collectionData = collectionOutput.data as RulingCollectorOutput;

  logStructured({
    level: 'INFO',
    message: '예규 수집 단계 완료.',
    timestamp: new Date().toISOString(),
    result: {
      collectedCount: collectionData.collectedCount,
      duplicateCount: collectionData.duplicateCount,
      failedItems: collectionData.failedItems.length,
    },
  });

  // 수집 실패 알림
  if (collectionData.failedItems.length > 0 && snsTopicArn) {
    try {
      const snsClient = new SNSClient({});
      await sendFailureNotification(
        snsClient,
        snsTopicArn,
        collectionData.failedItems.map(item => ({
          category: item.itemId,
          error: item.error,
        })),
        '예규 수집',
      );

      logStructured({
        level: 'INFO',
        message: 'SNS 실패 알림이 전송되었습니다.',
        timestamp: new Date().toISOString(),
        topicArn: snsTopicArn,
      });
    } catch (snsError) {
      const errorMessage = snsError instanceof Error ? snsError.message : String(snsError);
      logStructured({
        level: 'ERROR',
        message: 'SNS 알림 전송에 실패했습니다.',
        timestamp: new Date().toISOString(),
        error: errorMessage,
      });
    }
  }

  // 수집된 건이 없으면 종료
  if (collectionData.collectedCount === 0) {
    logStructured({
      level: 'INFO',
      message: '수집된 예규가 없습니다. 작업을 종료합니다.',
      timestamp: new Date().toISOString(),
      duplicatesSkipped: collectionData.duplicateCount,
    });
    return;
  }

  // 전체 파이프라인 완료 로그
  const elapsedMs = Date.now() - startTime;

  if (collectionData.failedItems.length === 0) {
    logStructured({
      level: 'INFO',
      message: '예규/심판례 수집 파이프라인이 정상 완료되었습니다.',
      timestamp: new Date().toISOString(),
      result: {
        collectedCount: collectionData.collectedCount,
        duplicateCount: collectionData.duplicateCount,
        elapsedMs,
      },
    });
  } else {
    logStructured({
      level: 'WARN',
      message: '예규/심판례 수집 파이프라인이 부분 실패로 완료되었습니다.',
      timestamp: new Date().toISOString(),
      result: {
        collectedCount: collectionData.collectedCount,
        duplicateCount: collectionData.duplicateCount,
        failedCount: collectionData.failedItems.length,
        elapsedMs,
      },
    });

    // 부분 실패 시 에러를 throw하여 Lambda 재시도 정책 활용
    throw new Error(
      `예규 수집 부분 실패: ${collectionData.failedItems.length}건 실패 - ${collectionData.failedItems.map(f => f.itemId).join(', ')}`,
    );
  }
};
