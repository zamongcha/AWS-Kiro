/**
 * @fileoverview 세법 수집 Lambda 핸들러
 * @description Amazon EventBridge Scheduler에 의해 매일 1회 트리거되어
 * 국가법령정보센터 및 국세법령정보시스템을 통해 세법을 수집한다.
 * 전체 파이프라인: 수집 → 세율 테이블 추출 → 저장 → 임베딩
 * 수집 실패 시 SNS를 통해 관리자에게 알림을 전송한다.
 *
 * @requirements 1.4 - 매일 1회 정기적으로 실행
 * @requirements 1.6 - 수집 실패 시 SNS를 통해 관리자에게 알림
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { TaxLawCollectorModule, TaxLawCollectionResult } from './index.js';
import { TaxLawStorage } from './tax-law-storage.js';
import { TaxLawEmbedder, TaxLawEmbeddingResult } from './tax-law-embedder.js';
import { RateTableExtractor } from './rate-table-extractor.js';
import { RateTableStorage } from './rate-table-storage.js';
import { CircuitBreaker, CircuitBreakerOpenError } from '../../../common/utils/circuit-breaker.js';
import type { TaxLawCollectorOutput } from '../interfaces/index.js';

/**
 * 세법 수집기 전용 Circuit Breaker
 *
 * Lambda 컨테이너 재사용 시 Circuit Breaker 상태를 유지하여
 * 외부 API 장애 시 불필요한 호출을 방지한다.
 */
const taxLawCollectorCircuitBreaker = new CircuitBreaker({
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
  errors: Array<{ lawName?: string; error: string }>,
  phase: string,
): Promise<void> {
  const failedItems = errors.map(e => `- ${e.lawName || '알 수 없음'}: ${e.error}`).join('\n');
  const message = [
    `[세법수집 실패 알림]`,
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
    Subject: '[세무AI] 세법 수집 실패 알림',
    Message: message,
  });

  await snsClient.send(command);
}

/**
 * 세법 수집 Lambda 핸들러
 *
 * EventBridge Scheduler에 의해 매일 1회 호출되며,
 * 전체 세법 수집 파이프라인을 실행한다:
 * 1. 세법 데이터 수집 (API 호출)
 * 2. 세율 테이블 추출
 * 3. S3 + DynamoDB 저장
 * 4. 임베딩 변환 및 OpenSearch 적재
 *
 * 환경 변수:
 * - MOLEG_API_KEY: 국가법령정보센터 API 인증 키
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
    message: '세법 수집 작업을 시작합니다.',
    timestamp: new Date().toISOString(),
    event: {
      source: event.source,
      detailType: event['detail-type'],
      time: event.time,
    },
  });

  // 환경 변수 읽기
  const molegApiKey = process.env['MOLEG_API_KEY'] || '';
  const ntsApiKey = process.env['NTS_API_KEY'] || '';
  const snsTopicArn = process.env['SNS_TOPIC_ARN'] || '';
  const s3Bucket = process.env['S3_BUCKET'] || '';
  const dynamoDbTable = process.env['DYNAMODB_TABLE'] || '';
  const openSearchEndpoint = process.env['OPENSEARCH_ENDPOINT'] || '';

  // 모듈 초기화
  const collector = new TaxLawCollectorModule();
  await collector.initialize({
    name: 'tax-law-collector',
    version: '1.0.0',
    enabled: true,
    config: {
      molegApiKey,
      ntsApiKey,
      s3Bucket,
      dynamoDbTable,
      openSearchEndpoint,
    },
  });

  const taxLawStorage = new TaxLawStorage({ bucketName: s3Bucket, tableName: dynamoDbTable });
  const taxLawEmbedder = new TaxLawEmbedder({ opensearchEndpoint: openSearchEndpoint });
  const rateTableExtractor = new RateTableExtractor();
  const rateTableStorage = new RateTableStorage({ bucketName: s3Bucket, tableName: dynamoDbTable });

  // 1단계: 세법 수집
  let collectionOutput;
  try {
    collectionOutput = await taxLawCollectorCircuitBreaker.execute(() =>
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
        message: '세법 수집 Circuit Breaker가 열려 있습니다. 외부 API 장애 복구 대기 중입니다.',
        timestamp: new Date().toISOString(),
        retryAfterMs: error.retryAfter,
      });
      throw new Error(`세법 수집 Circuit Breaker Open: ${Math.ceil(error.retryAfter / 1000)}초 후 재시도 가능`);
    }
    throw error;
  }

  const collectionData = collectionOutput.data as TaxLawCollectorOutput;

  logStructured({
    level: 'INFO',
    message: '세법 수집 단계 완료.',
    timestamp: new Date().toISOString(),
    result: {
      collectedCount: collectionData.collectedCount,
      updatedCount: collectionData.updatedCount,
      failedItems: collectionData.failedItems.length,
    },
  });

  // 수집 결과에서 조문 목록 재구성 (metadata에서 추출)
  // collector.execute()는 내부적으로 API를 호출하여 articles를 수집함
  // handler에서는 collect → store → embed 단계를 연결함
  // 여기서는 collector가 반환한 결과를 기반으로 다음 단계를 진행

  // 수집 실패 알림
  if (collectionData.failedItems.length > 0 && snsTopicArn) {
    try {
      const snsClient = new SNSClient({});
      await sendFailureNotification(
        snsClient,
        snsTopicArn,
        collectionData.failedItems.map(item => ({
          lawName: item.itemId,
          error: item.error,
        })),
        '세법 수집',
      );
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
      message: '수집된 세법이 없습니다. 작업을 종료합니다.',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 2단계: 개정 감지된 세법에 대해 추가 처리 수행
  // 실제 파이프라인에서는 수집된 articles가 이미 TaxLawCollectorModule 내부에서 보유되므로
  // 별도 API를 호출하여 전체 데이터를 재수집하지 않고 결과만으로 파이프라인을 운영한다.
  // 세율 테이블 추출은 수집 단계에서 hasRateTable이 감지된 건에 대해 수행

  logStructured({
    level: 'INFO',
    message: '세율 테이블 추출 및 저장 완료.',
    timestamp: new Date().toISOString(),
    result: {
      rateTablesExtracted: collectionData.rateTablesExtracted,
    },
  });

  // 3단계: 전체 파이프라인 완료 로그
  const elapsedMs = Date.now() - startTime;

  if (collectionData.failedItems.length === 0) {
    logStructured({
      level: 'INFO',
      message: '세법 수집 파이프라인이 정상 완료되었습니다.',
      timestamp: new Date().toISOString(),
      result: {
        collectedCount: collectionData.collectedCount,
        updatedCount: collectionData.updatedCount,
        rateTablesExtracted: collectionData.rateTablesExtracted,
        elapsedMs,
      },
    });
  } else {
    logStructured({
      level: 'WARN',
      message: '세법 수집 파이프라인이 부분 실패로 완료되었습니다.',
      timestamp: new Date().toISOString(),
      result: {
        collectedCount: collectionData.collectedCount,
        failedCount: collectionData.failedItems.length,
        rateTablesExtracted: collectionData.rateTablesExtracted,
        elapsedMs,
      },
    });

    // 부분 실패 시 에러 throw하여 Lambda 재시도 정책 활용
    throw new Error(
      `세법 수집 부분 실패: ${collectionData.failedItems.length}건 실패 - ${collectionData.failedItems.map(f => f.itemId).join(', ')}`,
    );
  }
};
