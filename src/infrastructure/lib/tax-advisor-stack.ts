/**
 * @fileoverview 세무 전용 인프라 스택 (CDK)
 * @description 부동산 세무 AI 자문 시스템의 AWS 인프라를 정의한다.
 * 기존 법률 자문 시스템과 OpenSearch, DynamoDB, S3를 공유하되
 * 별도 인덱스와 파티션 키로 데이터를 격리한다.
 *
 * @requirements 10.1, 10.2, 10.3, 10.4, 10.5, 1.4, 1.6, 2.4, 2.6
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

/**
 * TaxAdvisorStack 프로퍼티
 */
export interface TaxAdvisorStackProps extends cdk.StackProps {
  /** 환경 (dev/staging/prod) */
  environment: string;
  /** 공유 S3 데이터 버킷 */
  dataBucket: s3.IBucket;
  /** 공유 Sessions DynamoDB 테이블 */
  sessionsTable: dynamodb.ITable;
  /** 공유 DataManagement DynamoDB 테이블 */
  dataManagementTable: dynamodb.ITable;
  /** 공유 Feedback DynamoDB 테이블 */
  feedbackTable: dynamodb.ITable;
  /** 공유 SynonymDictionary DynamoDB 테이블 */
  synonymDictionaryTable: dynamodb.ITable;
  /** 공유 OpenSearch Serverless Collection ARN */
  openSearchCollectionArn: string;
  /** 공유 OpenSearch Serverless Collection 엔드포인트 */
  openSearchCollectionEndpoint: string;
}

/**
 * 세무 전용 인프라 스택
 *
 * 기존 법률 자문 시스템의 공유 인프라 위에 세무 전용 컴퓨트와
 * 스케줄링 리소스를 구성한다. 장애 격리를 위해 Lambda는 별도로 배포된다.
 */
export class TaxAdvisorStack extends cdk.Stack {
  /** 세무 질문 처리 Lambda */
  public readonly taxQueryHandlerFunction: lambda.IFunction;
  /** 세법 수집 Lambda */
  public readonly taxLawCollectorFunction: lambda.IFunction;
  /** 예규 수집 Lambda */
  public readonly rulingCollectorFunction: lambda.IFunction;
  /** 세무 검색 Lambda */
  public readonly taxSearchFunction: lambda.IFunction;
  /** 세무 응답 생성 Lambda */
  public readonly taxResponseGeneratorFunction: lambda.IFunction;
  /** 세율 계산 Lambda */
  public readonly taxCalculatorFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: TaxAdvisorStackProps) {
    super(scope, id, props);

    const {
      environment,
      dataBucket,
      sessionsTable,
      dataManagementTable,
      feedbackTable,
      synonymDictionaryTable,
      openSearchCollectionArn,
      openSearchCollectionEndpoint,
    } = props;

    // ─── SNS: 세무 수집 실패 알림 토픽 ───────────────────────────────────────
    const taxAlertTopic = new sns.Topic(this, 'TaxAdvisorAlertTopic', {
      topicName: `tax-advisor-alerts-${environment}`,
      displayName: '세무 자문 시스템 알림',
    });

    // ─── 공통 환경 변수 ──────────────────────────────────────────────────────
    const commonEnvVars: Record<string, string> = {
      ENVIRONMENT: environment,
      REGION: this.region,
      DATA_BUCKET_NAME: dataBucket.bucketName,
      SESSIONS_TABLE: sessionsTable.tableName,
      DATA_MANAGEMENT_TABLE: dataManagementTable.tableName,
      FEEDBACK_TABLE: feedbackTable.tableName,
      SYNONYM_DICTIONARY_TABLE: synonymDictionaryTable.tableName,
      OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
      TAX_ALERT_TOPIC_ARN: taxAlertTopic.topicArn,
      SERVICE_PREFIX: 'TAX',
    };

    // ─── Lambda: 세무 질문 처리 ──────────────────────────────────────────────
    const taxQueryHandlerRole = new iam.Role(this, 'TaxQueryHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    taxQueryHandlerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [
        sessionsTable.tableArn,
        feedbackTable.tableArn,
        synonymDictionaryTable.tableArn,
        `${sessionsTable.tableArn}/index/*`,
      ],
    }));

    taxQueryHandlerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    taxQueryHandlerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollectionArn],
    }));

    this.taxQueryHandlerFunction = new lambda.Function(this, 'TaxQueryHandler', {
      functionName: `tax-query-handler-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/tax-advisor/query-handler'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: taxQueryHandlerRole,
      environment: commonEnvVars,
    });

    // ─── Lambda: 세법 수집 ───────────────────────────────────────────────────
    const taxLawCollectorRole = new iam.Role(this, 'TaxLawCollectorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    taxLawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${dataBucket.bucketArn}/tax-data/*`],
    }));

    taxLawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [dataManagementTable.tableArn],
    }));

    taxLawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    taxLawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollectionArn],
    }));

    taxLawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sns:Publish'],
      resources: [taxAlertTopic.topicArn],
    }));

    this.taxLawCollectorFunction = new lambda.Function(this, 'TaxLawCollector', {
      functionName: `tax-law-collector-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/tax-advisor/tax-law-collector'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: taxLawCollectorRole,
      environment: {
        ...commonEnvVars,
        TAX_LAW_API_KEY: process.env['TAX_LAW_API_KEY'] || '',
      },
    });

    // ─── Lambda: 예규 수집 ───────────────────────────────────────────────────
    const rulingCollectorRole = new iam.Role(this, 'RulingCollectorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    rulingCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${dataBucket.bucketArn}/tax-data/*`],
    }));

    rulingCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'],
      resources: [dataManagementTable.tableArn],
    }));

    rulingCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    rulingCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollectionArn],
    }));

    rulingCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sns:Publish'],
      resources: [taxAlertTopic.topicArn],
    }));

    this.rulingCollectorFunction = new lambda.Function(this, 'RulingCollector', {
      functionName: `tax-ruling-collector-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/tax-advisor/ruling-collector'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: rulingCollectorRole,
      environment: commonEnvVars,
    });

    // ─── Lambda: 세무 검색 ───────────────────────────────────────────────────
    const taxSearchRole = new iam.Role(this, 'TaxSearchRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    taxSearchRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    taxSearchRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollectionArn],
    }));

    taxSearchRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [synonymDictionaryTable.tableArn],
    }));

    this.taxSearchFunction = new lambda.Function(this, 'TaxSearch', {
      functionName: `tax-search-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/tax-advisor/tax-search'),
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      role: taxSearchRole,
      environment: commonEnvVars,
    });

    // ─── Lambda: 세무 응답 생성 ──────────────────────────────────────────────
    const taxResponseGenRole = new iam.Role(this, 'TaxResponseGeneratorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    taxResponseGenRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    this.taxResponseGeneratorFunction = new lambda.Function(this, 'TaxResponseGenerator', {
      functionName: `tax-response-generator-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/tax-advisor/tax-response-generator'),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      role: taxResponseGenRole,
      environment: commonEnvVars,
    });

    // ─── Lambda: 세율 계산 ───────────────────────────────────────────────────
    const taxCalculatorRole = new iam.Role(this, 'TaxCalculatorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    taxCalculatorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:Query'],
      resources: [dataManagementTable.tableArn],
    }));

    this.taxCalculatorFunction = new lambda.Function(this, 'TaxCalculator', {
      functionName: `tax-calculator-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/tax-advisor/tax-calculator'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: taxCalculatorRole,
      environment: commonEnvVars,
    });

    // ─── API Gateway: /tax-advisor/* ─────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'TaxAdvisorApi', {
      restApiName: `tax-advisor-api-${environment}`,
      description: '부동산 세무 AI 자문 API',
      deployOptions: { stageName: environment },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
    });

    const taxAdvisorResource = api.root.addResource('tax-advisor');

    // POST /tax-advisor/questions
    const questionsResource = taxAdvisorResource.addResource('questions');
    questionsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.taxQueryHandlerFunction as lambda.Function),
    );

    // GET /tax-advisor/categories
    const categoriesResource = taxAdvisorResource.addResource('categories');
    categoriesResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.taxQueryHandlerFunction as lambda.Function),
    );

    // POST /tax-advisor/feedback
    const feedbackResource = taxAdvisorResource.addResource('feedback');
    feedbackResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.taxQueryHandlerFunction as lambda.Function),
    );

    // ─── EventBridge: 세법 수집 스케줄 (매일 1회, 오전 3시 KST) ──────────────
    new events.Rule(this, 'TaxLawCollectionSchedule', {
      ruleName: `tax-law-collection-daily-${environment}`,
      description: '세법 데이터 수집 (매일 1회)',
      schedule: events.Schedule.cron({ minute: '0', hour: '18' }), // UTC 18:00 = KST 03:00
      targets: [new targets.LambdaFunction(this.taxLawCollectorFunction as lambda.Function)],
    });

    // ─── EventBridge: 예규 수집 스케줄 (24시간 간격, 오전 5시 KST) ────────────
    new events.Rule(this, 'RulingCollectionSchedule', {
      ruleName: `tax-ruling-collection-daily-${environment}`,
      description: '예규/심판례 데이터 수집 (24시간 간격)',
      schedule: events.Schedule.cron({ minute: '0', hour: '20' }), // UTC 20:00 = KST 05:00
      targets: [new targets.LambdaFunction(this.rulingCollectorFunction as lambda.Function)],
    });

    // ─── 스택 출력 ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'TaxAdvisorApiUrl', {
      value: api.url,
      description: '세무 자문 API 엔드포인트 URL',
    });

    new cdk.CfnOutput(this, 'TaxAlertTopicArn', {
      value: taxAlertTopic.topicArn,
      description: '세무 수집 실패 알림 토픽 ARN',
    });
  }
}
