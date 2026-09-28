import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  environment: string;
  dataBucket: s3.IBucket;
  sessionsTable: dynamodb.ITable;
  dataManagementTable: dynamodb.ITable;
  feedbackTable: dynamodb.ITable;
  synonymDictionaryTable: dynamodb.ITable;
  openSearchCollectionArn: string;
  openSearchCollectionEndpoint: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly queryHandlerFunction: lambda.IFunction;
  public readonly lawCollectorFunction: lambda.IFunction;
  public readonly caseCollectorFunction: lambda.IFunction;
  public readonly adminFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
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

    const commonEnvVars: Record<string, string> = {
      ENVIRONMENT: environment,
      REGION: this.region,
      DATA_BUCKET_NAME: dataBucket.bucketName,
      SESSIONS_TABLE_NAME: sessionsTable.tableName,
      DATA_MANAGEMENT_TABLE_NAME: dataManagementTable.tableName,
      FEEDBACK_TABLE_NAME: feedbackTable.tableName,
      SYNONYM_DICTIONARY_TABLE_NAME: synonymDictionaryTable.tableName,
      OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
    };

    // ─── 질문 처리 Lambda ────────────────────────────────────────────────────────
    const queryHandlerRole = new iam.Role(this, 'QueryHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    queryHandlerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: [
        sessionsTable.tableArn,
        feedbackTable.tableArn,
        synonymDictionaryTable.tableArn,
        `${sessionsTable.tableArn}/index/*`,
        `${feedbackTable.tableArn}/index/*`,
      ],
    }));

    queryHandlerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
      ],
    }));

    queryHandlerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
      ],
      resources: [openSearchCollectionArn],
    }));

    const queryHandler = new lambda.Function(this, 'QueryHandlerFunction', {
      functionName: `real-estate-legal-query-handler-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/query-handler'),
      role: queryHandlerRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: commonEnvVars,
      description: '사용자 질문 처리 - 검색/응답 생성/인용 파이프라인 조율',
    });
    this.queryHandlerFunction = queryHandler;

    // ─── 법령 수집 Lambda ────────────────────────────────────────────────────────
    const lawCollectorRole = new iam.Role(this, 'LawCollectorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    lawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        dataBucket.bucketArn,
        `${dataBucket.bucketArn}/raw/laws/*`,
        `${dataBucket.bucketArn}/processed/laws/*`,
      ],
    }));

    lawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: [
        dataManagementTable.tableArn,
        `${dataManagementTable.tableArn}/index/*`,
      ],
    }));

    lawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
      ],
    }));

    lawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
      ],
      resources: [openSearchCollectionArn],
    }));

    lawCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sns:Publish',
      ],
      resources: ['*'], // Scoped in scheduling stack via SNS topic ARN
    }));

    const lawCollector = new lambda.Function(this, 'LawCollectorFunction', {
      functionName: `real-estate-legal-law-collector-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/law-collector'),
      role: lawCollectorRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnvVars,
      description: '법령 수집기 - 국가법령정보센터 API에서 법령 데이터 수집 및 벡터화',
    });
    this.lawCollectorFunction = lawCollector;

    // ─── 판례 수집 Lambda ────────────────────────────────────────────────────────
    const caseCollectorRole = new iam.Role(this, 'CaseCollectorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    caseCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        dataBucket.bucketArn,
        `${dataBucket.bucketArn}/raw/cases/*`,
        `${dataBucket.bucketArn}/processed/cases/*`,
      ],
    }));

    caseCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: [
        dataManagementTable.tableArn,
        `${dataManagementTable.tableArn}/index/*`,
      ],
    }));

    caseCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
      ],
    }));

    caseCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
      ],
      resources: [openSearchCollectionArn],
    }));

    caseCollectorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sns:Publish',
      ],
      resources: ['*'], // Scoped in scheduling stack via SNS topic ARN
    }));

    const caseCollector = new lambda.Function(this, 'CaseCollectorFunction', {
      functionName: `real-estate-legal-case-collector-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/case-collector'),
      role: caseCollectorRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnvVars,
      description: '판례 수집기 - 대법원 종합법률정보 API에서 판례 데이터 수집 및 벡터화',
    });
    this.caseCollectorFunction = caseCollector;

    // ─── 관리 Lambda ─────────────────────────────────────────────────────────────
    const adminRole = new iam.Role(this, 'AdminRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    adminRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [
        dataManagementTable.tableArn,
        feedbackTable.tableArn,
        `${dataManagementTable.tableArn}/index/*`,
        `${feedbackTable.tableArn}/index/*`,
      ],
    }));

    const adminFunction = new lambda.Function(this, 'AdminFunction', {
      functionName: `real-estate-legal-admin-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/admin'),
      role: adminRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonEnvVars,
      description: '관리 기능 - 데이터 현황 조회, 피드백 관리',
    });
    this.adminFunction = adminFunction;

    // ─── Outputs ─────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'QueryHandlerFunctionArn', {
      value: queryHandler.functionArn,
      description: '질문 처리 Lambda ARN',
    });

    new cdk.CfnOutput(this, 'LawCollectorFunctionArn', {
      value: lawCollector.functionArn,
      description: '법령 수집기 Lambda ARN',
    });

    new cdk.CfnOutput(this, 'CaseCollectorFunctionArn', {
      value: caseCollector.functionArn,
      description: '판례 수집기 Lambda ARN',
    });
  }
}
