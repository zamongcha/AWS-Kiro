/**
 * @fileoverview 법령 수집 Lambda 핸들러
 * @description Amazon EventBridge Scheduler에 의해 매일 1회 트리거되어
 * 국가법령정보센터 Open API를 통해 부동산 관련 법령을 수집한다.
 * 수집 실패 시 SNS를 통해 관리자에게 알림을 전송한다.
 *
 * @requirements 1.4 - 매일 1회 정기적으로 실행
 * @requirements 1.6 - 수집 실패 시 SNS를 통해 관리자에게 알림
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { LawCollectorModule, LawCollectionResult } from './index.js';
import { CircuitBreaker, CircuitBreakerOpenError } from '../../common/utils/circuit-breaker.js';

/**
 * 법령 수집기 전용 Circuit Breaker
 *
 * Lambda 컨테이너 재사용 시 Circuit Breaker 상태를 유지하여
 * 외부 API 장애 시 불필요한 호출을 방지한다.
 */
const lawCollectorCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 120000, // 2분 후 반개방 시도
  monitoringWindow: 300000, // 5분 윈도우
});

/**
 * EventBridge 스케줄 이벤트 인터페이스
 *
 * EventBridge Scheduler가 Lambda를 호출할 때 전달하는 이벤트 구조
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
 *
 * CloudWatch Logs에서 구조화된 쿼리가 가능하도록
 * JSON 형식으로 로그를 출력한다.
 */
function logStructured(log: StructuredLog): void {
  console.log(JSON.stringify(log));
}

/**
 * SNS를 통한 수집 실패 알림 전송
 *
 * 수집 실패한 법령 목록과 오류 상세 정보를 관리자에게 전달한다.
 *
 * @param snsClient - SNS 클라이언트 인스턴스
 * @param topicArn - 알림 대상 SNS Topic ARN
 * @param result - 수집 결과 (실패 정보 포함)
 */
async function sendFailureNotification(
  snsClient: SNSClient,
  topicArn: string,
  result: LawCollectionResult,
): Promise<void> {
  const failedLaws = result.errors.map(e => `- ${e.lawName}: ${e.error}`).join('\n');
  const message = [
    `[법령수집 실패 알림]`,
    ``,
    `발생 시각: ${new Date().toISOString()}`,
    `실패 건수: ${result.failureCount}건`,
    `성공 건수: ${result.successCount}건`,
    ``,
    `실패 상세:`,
    failedLaws,
  ].join('\n');

  const command = new PublishCommand({
    TopicArn: topicArn,
    Subject: '[법령수집] 수집 실패 알림',
    Message: message,
  });

  await snsClient.send(command);
}

/**
 * 법령 수집 Lambda 핸들러
 *
 * EventBridge Scheduler에 의해 매일 1회 호출되며,
 * 법령 수집 모듈을 실행하여 대상 법령을 수집한다.
 *
 * 환경 변수:
 * - LAW_API_KEY: 국가법령정보센터 API 인증 키
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
    message: '법령 수집 작업을 시작합니다.',
    timestamp: new Date().toISOString(),
    event: {
      source: event.source,
      detailType: event['detail-type'],
      time: event.time,
    },
  });

  // 환경 변수 읽기
  const apiKey = process.env['LAW_API_KEY'] || '';
  const snsTopicArn = process.env['SNS_TOPIC_ARN'] || '';
  const s3Bucket = process.env['S3_BUCKET'] || '';
  const dynamoDbTable = process.env['DYNAMODB_TABLE'] || '';
  const openSearchEndpoint = process.env['OPENSEARCH_ENDPOINT'] || '';

  // 모듈 초기화
  const collector = new LawCollectorModule();
  await collector.initialize({
    name: 'law-collector',
    version: '1.0.0',
    enabled: true,
    config: {
      apiKey,
      s3Bucket,
      dynamoDbTable,
      openSearchEndpoint,
    },
  });

  // 법령 수집 실행 (Circuit Breaker 적용)
  let output;
  try {
    output = await lawCollectorCircuitBreaker.execute(() =>
      collector.execute({
        type: 'collect',
        payload: {},
        metadata: {
          triggeredBy: 'eventbridge-scheduler',
          s3Bucket,
          dynamoDbTable,
          openSearchEndpoint,
        },
      })
    );
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logStructured({
        level: 'WARN',
        message: '법령 수집 Circuit Breaker가 열려 있습니다. 외부 API 장애 복구 대기 중입니다.',
        timestamp: new Date().toISOString(),
        retryAfterMs: error.retryAfter,
      });
      throw new Error(`법령 수집 Circuit Breaker Open: ${Math.ceil(error.retryAfter / 1000)}초 후 재시도 가능`);
    }
    throw error;
  }

  const result = output.data as LawCollectionResult;
  const elapsedMs = Date.now() - startTime;

  if (output.success) {
    // 수집 성공
    logStructured({
      level: 'INFO',
      message: '법령 수집이 완료되었습니다.',
      timestamp: new Date().toISOString(),
      result: {
        totalArticles: result.articles.length,
        successCount: result.successCount,
        failureCount: result.failureCount,
        elapsedMs,
      },
    });
  } else {
    // 수집 실패 (일부 또는 전체)
    logStructured({
      level: 'ERROR',
      message: '법령 수집 중 실패가 발생했습니다.',
      timestamp: new Date().toISOString(),
      result: {
        successCount: result.successCount,
        failureCount: result.failureCount,
        errors: result.errors,
        elapsedMs,
      },
    });

    // SNS 실패 알림 전송
    if (snsTopicArn) {
      try {
        const snsClient = new SNSClient({});
        await sendFailureNotification(snsClient, snsTopicArn, result);

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

    // 실패 시 에러를 throw하여 Lambda 재시도 정책 활용
    throw new Error(
      `법령 수집 실패: ${result.failureCount}건 실패 - ${result.errors.map(e => e.lawName).join(', ')}`,
    );
  }
};
