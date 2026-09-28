import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export interface SchedulingStackProps extends cdk.StackProps {
  environment: string;
  lawCollectorFunction: lambda.IFunction;
  caseCollectorFunction: lambda.IFunction;
}

export class SchedulingStack extends cdk.Stack {
  public readonly failureAlertTopic: sns.ITopic;

  constructor(scope: Construct, id: string, props: SchedulingStackProps) {
    super(scope, id, props);

    const { environment, lawCollectorFunction, caseCollectorFunction } = props;

    // ─── SNS Topic: 실패 알림 ────────────────────────────────────────────────────
    const failureAlertTopic = new sns.Topic(this, 'FailureAlertTopic', {
      topicName: `real-estate-legal-failure-alerts-${environment}`,
      displayName: '부동산 법률 AI - 수집 실패 알림',
    });
    this.failureAlertTopic = failureAlertTopic;

    // 관리자 이메일 구독 (실제 배포 시 파라미터로 주입)
    const adminEmail = this.node.tryGetContext('adminEmail');
    if (adminEmail) {
      failureAlertTopic.addSubscription(
        new subscriptions.EmailSubscription(adminEmail)
      );
    }

    // ─── EventBridge: 법령 수집 스케줄 (매일 1회, KST 03:00 = UTC 18:00) ─────────
    const lawCollectorRule = new events.Rule(this, 'LawCollectorSchedule', {
      ruleName: `real-estate-legal-law-collector-schedule-${environment}`,
      description: '법령 수집기 매일 1회 실행 (KST 03:00)',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '18', // UTC 18:00 = KST 03:00
        day: '*',
        month: '*',
        year: '*',
      }),
      enabled: true,
    });

    lawCollectorRule.addTarget(new targets.LambdaFunction(lawCollectorFunction, {
      retryAttempts: 2,
      maxEventAge: cdk.Duration.hours(1),
    }));

    // ─── EventBridge: 판례 수집 스케줄 (24시간 간격, KST 04:00 = UTC 19:00) ──────
    const caseCollectorRule = new events.Rule(this, 'CaseCollectorSchedule', {
      ruleName: `real-estate-legal-case-collector-schedule-${environment}`,
      description: '판례 수집기 24시간 간격 실행 (KST 04:00)',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '19', // UTC 19:00 = KST 04:00
        day: '*',
        month: '*',
        year: '*',
      }),
      enabled: true,
    });

    caseCollectorRule.addTarget(new targets.LambdaFunction(caseCollectorFunction, {
      retryAttempts: 2,
      maxEventAge: cdk.Duration.hours(1),
    }));

    // ─── CloudWatch Alarms: Lambda 실패 감지 ─────────────────────────────────────
    const lawCollectorErrorAlarm = new cloudwatch.Alarm(this, 'LawCollectorErrorAlarm', {
      alarmName: `real-estate-legal-law-collector-errors-${environment}`,
      alarmDescription: '법령 수집기 실행 오류 감지',
      metric: lawCollectorFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    lawCollectorErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(failureAlertTopic));

    const caseCollectorErrorAlarm = new cloudwatch.Alarm(this, 'CaseCollectorErrorAlarm', {
      alarmName: `real-estate-legal-case-collector-errors-${environment}`,
      alarmDescription: '판례 수집기 실행 오류 감지',
      metric: caseCollectorFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    caseCollectorErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(failureAlertTopic));

    // ─── CloudWatch Alarms: Lambda 타임아웃 감지 ─────────────────────────────────
    const lawCollectorDurationAlarm = new cloudwatch.Alarm(this, 'LawCollectorDurationAlarm', {
      alarmName: `real-estate-legal-law-collector-duration-${environment}`,
      alarmDescription: '법령 수집기 실행 시간 초과 경고',
      metric: lawCollectorFunction.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 270000, // 4.5분 (5분 타임아웃 근접 경고)
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    lawCollectorDurationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(failureAlertTopic));

    const caseCollectorDurationAlarm = new cloudwatch.Alarm(this, 'CaseCollectorDurationAlarm', {
      alarmName: `real-estate-legal-case-collector-duration-${environment}`,
      alarmDescription: '판례 수집기 실행 시간 초과 경고',
      metric: caseCollectorFunction.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 270000, // 4.5분 (5분 타임아웃 근접 경고)
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    caseCollectorDurationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(failureAlertTopic));

    // ─── Outputs ─────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'FailureAlertTopicArn', {
      value: failureAlertTopic.topicArn,
      description: '수집 실패 알림 SNS 토픽 ARN',
    });

    new cdk.CfnOutput(this, 'LawCollectorScheduleArn', {
      value: lawCollectorRule.ruleArn,
      description: '법령 수집 스케줄 규칙 ARN',
    });

    new cdk.CfnOutput(this, 'CaseCollectorScheduleArn', {
      value: caseCollectorRule.ruleArn,
      description: '판례 수집 스케줄 규칙 ARN',
    });
  }
}
