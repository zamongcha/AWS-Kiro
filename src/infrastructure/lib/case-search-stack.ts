/**
 * @fileoverview 판례 검색 서비스 CDK 스택
 * @description 판례 검색 전용 Lambda 함수 및 API Gateway 경로를 정의한다.
 * 기존 StorageStack의 공유 인프라(OpenSearch, DynamoDB, S3)를 활용하되
 * 별도 Lambda, API Gateway 경로로 장애 격리를 보장한다.
 *
 * @requirements 10.1 - 기존 인프라 공유, 독립 모듈 동작
 * @requirements 10.3 - API Gateway /case-search/* 경로 추가
 * @requirements 10.6 - 판례 검색 모듈 장애 시 기존 법률 자문 모듈에 영향 없도록 격리
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CaseSearchStackProps extends cdk.StackProps {
  environment: string;
  dataBucket: s3.IBucket;
  sessionsTable: dynamodb.ITable;
  feedbackTable: dynamodb.ITable;
  synonymDictionaryTable: dynamodb.ITable;
  openSearchCollectionArn: string;
  openSearchCollectionEndpoint: string;
}

export class CaseSearchStack extends cdk.Stack {
  public readonly caseSearchAnalyzeFunction: lambda.IFunction;
  public readonly caseSearchCategoryFunction: lambda.IFunction;
  public readonly caseSearchFeedbackFunction: lambda.IFunction;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: CaseSearchStackProps) {
    super(scope, id, props);

    const {
      environment,
      sessionsTable,
      feedbackTable,
      synonymDictionaryTable,
      openSearchCollectionArn,
      openSearchCollectionEndpoint,
    } = props;

    const commonEnvVars: Record<string, string> = {
      ENVIRONMENT: environment,
      REGION: this.region,
      SESSIONS_TABLE: sessionsTable.tableName,
      FEEDBACK_TABLE: feedbackTable.tableName,
      SYNONYM_TABLE: synonymDictionaryTable.tableName,
      OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
    };

    // ─── 판례 검색 분석 Lambda ──────────────────────────────────────────────────
    const analyzeRole = new iam.Role(this, 'CaseSearchAnalyzeRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // DynamoDB: CASE_SEARCH# 접두사 읽기/쓰기
    analyzeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: [
        sessionsTable.tableArn,
        `${sessionsTable.tableArn}/index/*`,
      ],
    }));

    // Bedrock: Claude 3.5 Sonnet + Titan Embeddings V2
    analyzeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
      ],
    }));

    // OpenSearch: 읽기 전용
    analyzeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollectionArn],
    }));

    const analyzeFunction = new lambda.Function(this, 'CaseSearchAnalyzeFunction', {
      functionName: `case-search-analyze-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/case-search/query-handler'),
      role: analyzeRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: commonEnvVars,
      description: '판례 검색 분석 - POST /case-search/analyze, POST /case-search/follow-up',
    });
    this.caseSearchAnalyzeFunction = analyzeFunction;

    // ─── 카테고리 탐색 Lambda ───────────────────────────────────────────────────
    const categoryRole = new iam.Role(this, 'CaseSearchCategoryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    categoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['aoss:APIAccessAll'],
      resources: [openSearchCollectionArn],
    }));

    categoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
      ],
    }));

    const categoryFunction = new lambda.Function(this, 'CaseSearchCategoryFunction', {
      functionName: `case-search-category-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/case-search/query-handler'),
      role: categoryRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: commonEnvVars,
      description: '카테고리 탐색 - GET /case-search/categories/*, GET /case-search/cases/*',
    });
    this.caseSearchCategoryFunction = categoryFunction;

    // ─── 피드백 Lambda ──────────────────────────────────────────────────────────
    const feedbackRole = new iam.Role(this, 'CaseSearchFeedbackRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    feedbackRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem'],
      resources: [feedbackTable.tableArn],
    }));

    const feedbackFunction = new lambda.Function(this, 'CaseSearchFeedbackFunction', {
      functionName: `case-search-feedback-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/modules/case-search/query-handler'),
      role: feedbackRole,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: commonEnvVars,
      description: '피드백 수집 - POST /case-search/feedback',
    });
    this.caseSearchFeedbackFunction = feedbackFunction;

    // ─── API Gateway ────────────────────────────────────────────────────────────
    this.api = new apigateway.RestApi(this, 'CaseSearchApi', {
      restApiName: `case-search-api-${environment}`,
      description: '판례 검색 및 분석 서비스 API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: environment,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // /case-search 리소스
    const caseSearchResource = this.api.root.addResource('case-search');

    // POST /case-search/analyze
    const analyzeResource = caseSearchResource.addResource('analyze');
    analyzeResource.addMethod('POST', new apigateway.LambdaIntegration(analyzeFunction));

    // POST /case-search/follow-up
    const followUpResource = caseSearchResource.addResource('follow-up');
    followUpResource.addMethod('POST', new apigateway.LambdaIntegration(analyzeFunction));

    // GET /case-search/categories
    const categoriesResource = caseSearchResource.addResource('categories');
    categoriesResource.addMethod('GET', new apigateway.LambdaIntegration(categoryFunction));

    // GET /case-search/categories/{type}
    const categoryTypeResource = categoriesResource.addResource('{type}');
    categoryTypeResource.addMethod('GET', new apigateway.LambdaIntegration(categoryFunction));

    // GET /case-search/categories/{type}/subcategories
    const subCategoriesResource = categoryTypeResource.addResource('subcategories');
    subCategoriesResource.addMethod('GET', new apigateway.LambdaIntegration(categoryFunction));

    // GET /case-search/cases/{caseId}
    const casesResource = caseSearchResource.addResource('cases');
    const caseDetailResource = casesResource.addResource('{caseId}');
    caseDetailResource.addMethod('GET', new apigateway.LambdaIntegration(categoryFunction));

    // POST /case-search/feedback
    const feedbackResource = caseSearchResource.addResource('feedback');
    feedbackResource.addMethod('POST', new apigateway.LambdaIntegration(feedbackFunction));

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CaseSearchApiUrl', {
      value: this.api.url,
      description: '판례 검색 API URL',
    });

    new cdk.CfnOutput(this, 'CaseSearchAnalyzeFunctionArn', {
      value: analyzeFunction.functionArn,
      description: '판례 검색 분석 Lambda ARN',
    });

    new cdk.CfnOutput(this, 'CaseSearchCategoryFunctionArn', {
      value: categoryFunction.functionArn,
      description: '카테고리 탐색 Lambda ARN',
    });
  }
}
