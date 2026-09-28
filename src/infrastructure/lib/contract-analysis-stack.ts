/**
 * @fileoverview 부동산 계약서 AI 분석 전용 인프라 스택 (CDK)
 * @description 계약서 분석 서비스의 AWS 인프라를 정의한다.
 * 기존 법률/세무/판례 서비스와 OpenSearch, DynamoDB, S3, API Gateway 공유 인프라를
 * 활용하되, 별도 Lambda, API Gateway, SNS 토픽으로 장애 격리를 보장한다.
 *
 * 데이터 격리 규칙:
 * - OpenSearch: `contract-` 인덱스 접두사 (contract-toxic-rules, contract-standard-forms)
 * - DynamoDB: `CONTRACT#` 파티션 키 접두사
 * - S3: `contract-data/` 객체 접두사
 * - API Gateway: `/contract-analysis/*` 경로
 *
 * @requirements 16.1 - OpenSearch contract-* 전용 인덱스로 데이터 격리
 * @requirements 16.2 - DynamoDB CONTRACT# 파티션 키 접두사로 논리 분리
 * @requirements 16.3 - API Gateway /contract-analysis/* 경로 라우팅
 * @requirements 16.4 - S3 contract-data/ 접두사로 객체 격리
 * @requirements 16.5 - 기존 서비스와 독립적으로 배포/업데이트/롤백 가능
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

/**
 * ContractAnalysisStack 프로퍼티
 */
export interface ContractAnalysisStackProps extends cdk.StackProps {
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
  /** 공유 OpenSearch Serverless Collection ARN */
  openSearchCollectionArn: string;
  /** 공유 OpenSearch Serverless Collection 엔드포인트 */
  openSearchCollectionEndpoint: string;
  /** 판례 검색 서비스 분석 Lambda (판례 연동용, 선택) */
  caseSearchAnalyzeFunction?: lambda.IFunction;
}

/**
 * 계약서 분석 전용 인프라 스택
 *
 * 기존 공유 인프라 위에 계약서 분석 전용 컴퓨트/API/알림 리소스를 구성한다.
 * 장애 격리를 위해 모든 Lambda와 API Gateway는 별도로 배포된다.
 */
export class ContractAnalysisStack extends cdk.Stack {
  /** 업로드 처리 Lambda */
  public readonly contractUploadFunction: lambda.IFunction;
  /** 계약서 분석 오케스트레이터 Lambda */
  public readonly contractAnalyzeFunction: lambda.IFunction;
  /** 등기부등본 대조 Lambda */
  public readonly contractRegistryFunction: lambda.IFunction;
  /** 조항 판단/수정 제안 Lambda */
  public readonly contractAdviseFunction: lambda.IFunction;
  /** 버전 저장/비교 Lambda */
  public readonly contractVersionFunction: lambda.IFunction;
  /** 협상 시뮬레이션 Lambda */
  public readonly contractSimulateFunction: lambda.IFunction;
  /** 관리자 룰셋/표준계약서 적재 Lambda */
  public readonly contractAdminFunction: lambda.IFunction;
  /** 계약서 분석 API */
  public readonly api: apigateway.RestApi;
  /** 룰셋 적재 실패 알림 토픽 */
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ContractAnalysisStackProps) {
    super(scope, id, props);

    const {
      environment,
      dataBucket,
      sessionsTable,
      dataManagementTable,
      feedbackTable,
      openSearchCollectionArn,
      openSearchCollectionEndpoint,
      caseSearchAnalyzeFunction,
    } = props;

    // ─── SNS: 룰셋/표준계약서 적재 실패 알림 토픽 ─────────────────────────────
    // @requirements 15.3, 15.5 - 개별 패턴 적재 실패 시 관리자 알림
    const alertTopic = new sns.Topic(this, 'ContractAnalysisAlertTopic', {
      topicName: `contract-analysis-alerts-${environment}`,
      displayName: '계약서 분석 시스템 알림',
    });
    this.alertTopic = alertTopic;

    // ─── 공통 환경 변수 ──────────────────────────────────────────────────────
    // 데이터 격리 접두사를 환경 변수로 명시하여 런타임에서도 강제한다.
    const commonEnvVars: Record<string, string> = {
      ENVIRONMENT: environment,
      REGION: this.region,
      DATA_BUCKET_NAME: dataBucket.bucketName,
      SESSIONS_TABLE: sessionsTable.tableName,
      DATA_MANAGEMENT_TABLE: dataManagementTable.tableName,
      FEEDBACK_TABLE: feedbackTable.tableName,
      OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
      CONTRACT_ALERT_TOPIC_ARN: alertTopic.topicArn,
      SERVICE_PREFIX: 'CONTRACT',
      // 데이터 격리 접두사 (16.1, 16.2, 16.4)
      OPENSEARCH_INDEX_PREFIX: 'contract-',
      DYNAMO_PARTITION_PREFIX: 'CONTRACT#',
      S3_OBJECT_PREFIX: 'contract-data/',
      // 문서 인식/LLM 제공자 (로컬 기본: 멀티모달/Mock, 배포: Textract/Bedrock)
      OCR_PROVIDER: 'textract_precise',
      LLM_PROVIDER: 'bedrock',
    };

    // 판례 검색 서비스 연동 대상이 주입되면 환경 변수로 전달한다. (16.6)
    if (caseSearchAnalyzeFunction) {
      commonEnvVars.CASE_SEARCH_FUNCTION_NAME = caseSearchAnalyzeFunction.functionName;
    }

    // ─── 공유 IAM 정책 헬퍼 ──────────────────────────────────────────────────
    // 계약서 분석 Lambda가 공통으로 필요로 하는 권한을 역할에 부여한다.
    // 데이터 격리를 위해 S3는 contract-data/ 접두사로만 접근을 허용한다.

    /** OpenSearch(aoss) 접근 권한 - contract-* 인덱스 읽기/쓰기 */
    const opensearchStatement = () =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [openSearchCollectionArn],
      });

    /** DynamoDB 접근 권한 - CONTRACT# 접두사 항목 읽기/쓰기 */
    const dynamoStatement = (write: boolean) =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: write
          ? ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query']
          : ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          sessionsTable.tableArn,
          dataManagementTable.tableArn,
          `${sessionsTable.tableArn}/index/*`,
          `${dataManagementTable.tableArn}/index/*`,
        ],
        // CONTRACT# 파티션 키 접두사로만 접근 제한 (16.2)
        conditions: {
          'ForAllValues:StringLike': {
            'dynamodb:LeadingKeys': ['CONTRACT#*'],
          },
        },
      });

    /** S3 접근 권한 - contract-data/ 접두사 객체만 읽기/쓰기 (16.4) */
    const s3Statement = () =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [`${dataBucket.bucketArn}/contract-data/*`],
      });

    /** Bedrock 모델 호출 권한 - Claude 3.5 Sonnet + Titan Embeddings V2 */
    const bedrockStatement = () =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      });

    /** Textract 정밀 OCR 호출 권한 */
    const textractStatement = () =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'textract:DetectDocumentText',
          'textract:AnalyzeDocument',
        ],
        resources: ['*'], // Textract는 리소스 수준 권한을 지원하지 않음
      });

    /** 판례 검색 서비스 호출 권한 (16.6) */
    const caseServiceStatement = () =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: caseSearchAnalyzeFunction
          ? [caseSearchAnalyzeFunction.functionArn]
          : [`arn:aws:lambda:${this.region}:${this.account}:function:case-search-analyze-${environment}`],
      });

    /** SNS 게시 권한 */
    const snsStatement = () =>
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sns:Publish'],
        resources: [alertTopic.topicArn],
      });

    /**
     * 계약서 분석 Lambda 역할 생성 헬퍼.
     * 필요한 권한 조합을 옵션으로 선언적으로 부여한다.
     */
    const createRole = (
      roleId: string,
      opts: {
        opensearch?: boolean;
        dynamoWrite?: boolean;
        dynamoRead?: boolean;
        s3?: boolean;
        bedrock?: boolean;
        textract?: boolean;
        caseService?: boolean;
        sns?: boolean;
      },
    ): iam.Role => {
      const role = new iam.Role(this, roleId, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
      if (opts.opensearch) role.addToPolicy(opensearchStatement());
      if (opts.dynamoWrite) role.addToPolicy(dynamoStatement(true));
      else if (opts.dynamoRead) role.addToPolicy(dynamoStatement(false));
      if (opts.s3) role.addToPolicy(s3Statement());
      if (opts.bedrock) role.addToPolicy(bedrockStatement());
      if (opts.textract) role.addToPolicy(textractStatement());
      if (opts.caseService) role.addToPolicy(caseServiceStatement());
      if (opts.sns) role.addToPolicy(snsStatement());
      return role;
    };

    /**
     * 계약서 분석 Lambda 함수 생성 헬퍼.
     */
    const createFunction = (
      fnId: string,
      opts: {
        functionName: string;
        assetPath: string;
        role: iam.Role;
        timeoutSeconds: number;
        memorySize: number;
        description: string;
      },
    ): lambda.Function =>
      new lambda.Function(this, fnId, {
        functionName: opts.functionName,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'handler.handler',
        code: lambda.Code.fromAsset(opts.assetPath),
        role: opts.role,
        timeout: cdk.Duration.seconds(opts.timeoutSeconds),
        memorySize: opts.memorySize,
        environment: commonEnvVars,
        description: opts.description,
      });

    // 계약서 분석 Lambda는 단일 모듈 핸들러(handler.ts)가 경로별로 분기하지만,
    // 장애 격리와 리소스 튜닝을 위해 기능별로 개별 Lambda를 배포한다.
    const contractAsset = 'dist/modules/contract-analysis';

    // ─── Lambda: 업로드 처리 (POST /contract-analysis/upload) ────────────────
    // @requirements 1.1, 1.2 - S3 저장 + 고유 documentId 발급, DynamoDB 레코드
    this.contractUploadFunction = createFunction('ContractUploadFunction', {
      functionName: `contract-upload-${environment}`,
      assetPath: contractAsset,
      role: createRole('ContractUploadRole', { s3: true, dynamoWrite: true }),
      timeoutSeconds: 30,
      memorySize: 512,
      description: '계약서/등기부 파일 업로드 - S3 저장 및 documentId 발급',
    });

    // ─── Lambda: 분석 오케스트레이터 (POST /contract-analysis/analyze) ───────
    // @requirements 14.x - 전체 파이프라인 조율, 90초 이내 조항 분석
    this.contractAnalyzeFunction = createFunction('ContractAnalyzeFunction', {
      functionName: `contract-analyze-${environment}`,
      assetPath: contractAsset,
      role: createRole('ContractAnalyzeRole', {
        opensearch: true,
        dynamoWrite: true,
        s3: true,
        bedrock: true,
        textract: true,
        caseService: true,
        sns: true,
      }),
      timeoutSeconds: 120,
      memorySize: 1024,
      description: '계약서 분석 오케스트레이터 - 인식/탐지/평가/제안/판례 연동',
    });

    // ─── Lambda: 등기부등본 대조 (POST /contract-analysis/registry) ──────────
    // @requirements 5.x - 등기부 추출 + 전세사기 스코어링
    this.contractRegistryFunction = createFunction('ContractRegistryFunction', {
      functionName: `contract-registry-${environment}`,
      assetPath: contractAsset,
      role: createRole('ContractRegistryRole', {
        s3: true,
        dynamoWrite: true,
        bedrock: true,
        textract: true,
      }),
      timeoutSeconds: 60,
      memorySize: 1024,
      description: '등기부등본 대조 - 근저당/선순위 추출 및 전세사기 위험 스코어링',
    });

    // ─── Lambda: 조항 판단/수정 제안 (POST /contract-analysis/advise) ────────
    // @requirements 6.x - mode=suggest|judge, 특약 추천(GET /recommendations)
    this.contractAdviseFunction = createFunction('ContractAdviseFunction', {
      functionName: `contract-advise-${environment}`,
      assetPath: contractAsset,
      role: createRole('ContractAdviseRole', {
        opensearch: true,
        dynamoRead: true,
        bedrock: true,
        caseService: true,
      }),
      timeoutSeconds: 60,
      memorySize: 512,
      description: '조항 판단/수정 제안 및 실시간 특약 추천',
    });

    // ─── Lambda: 버전 저장/비교 (POST/GET /contract-analysis/versions) ───────
    // @requirements 12.x - 버전 관리 (CONTRACT# 파티션 키)
    this.contractVersionFunction = createFunction('ContractVersionFunction', {
      functionName: `contract-version-${environment}`,
      assetPath: contractAsset,
      role: createRole('ContractVersionRole', { dynamoWrite: true }),
      timeoutSeconds: 30,
      memorySize: 512,
      description: '계약서 버전 저장/비교 관리',
    });

    // ─── Lambda: 협상 시뮬레이션 (POST /contract-analysis/simulate) ──────────
    // @requirements 13.x - 조항 변경 시뮬레이션, 위험도 재계산
    this.contractSimulateFunction = createFunction('ContractSimulateFunction', {
      functionName: `contract-simulate-${environment}`,
      assetPath: contractAsset,
      role: createRole('ContractSimulateRole', {
        opensearch: true,
        dynamoRead: true,
        bedrock: true,
      }),
      timeoutSeconds: 60,
      memorySize: 1024,
      description: '협상 시나리오 시뮬레이션 - 변경 후 위험도 재계산',
    });

    // ─── Lambda: 관리자 룰셋/표준계약서 적재 (POST /admin/rulesets) ───────────
    // @requirements 15.x - 룰셋/표준계약서 임베딩 적재, 실패 시 SNS 알림
    this.contractAdminFunction = createFunction('ContractAdminFunction', {
      functionName: `contract-admin-${environment}`,
      assetPath: contractAsset,
      role: createRole('ContractAdminRole', {
        opensearch: true,
        dynamoWrite: true,
        s3: true,
        bedrock: true,
        sns: true,
      }),
      timeoutSeconds: 300,
      memorySize: 1024,
      description: '관리자 룰셋/표준계약서 갱신 - 임베딩 적재 및 버전 관리',
    });

    // ─── API Gateway: /contract-analysis/* ───────────────────────────────────
    // @requirements 16.3 - 계약서 분석 전용 경로 라우팅 (Rate Limiting, CORS)
    this.api = new apigateway.RestApi(this, 'ContractAnalysisApi', {
      restApiName: `contract-analysis-api-${environment}`,
      description: '부동산 계약서 AI 분석 API',
      deployOptions: {
        stageName: environment,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: environment !== 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Session-Id',
        ],
        maxAge: cdk.Duration.hours(1),
      },
      // 대용량 파일 업로드(최대 20MB) 대응을 위해 바이너리 미디어 타입 허용
      binaryMediaTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    });

    const integrate = (fn: lambda.IFunction) =>
      new apigateway.LambdaIntegration(fn as lambda.Function, { proxy: true });

    // /contract-analysis 루트 리소스
    const root = this.api.root.addResource('contract-analysis');

    // POST /contract-analysis/upload
    root.addResource('upload').addMethod('POST', integrate(this.contractUploadFunction));

    // POST /contract-analysis/analyze
    root.addResource('analyze').addMethod('POST', integrate(this.contractAnalyzeFunction));

    // POST /contract-analysis/registry
    root.addResource('registry').addMethod('POST', integrate(this.contractRegistryFunction));

    // POST /contract-analysis/advise
    root.addResource('advise').addMethod('POST', integrate(this.contractAdviseFunction));

    // GET /contract-analysis/recommendations (실시간 특약 추천)
    root.addResource('recommendations').addMethod('GET', integrate(this.contractAdviseFunction));

    // /contract-analysis/versions : POST 저장, GET compare 비교
    const versionsResource = root.addResource('versions');
    versionsResource.addMethod('POST', integrate(this.contractVersionFunction));
    versionsResource.addResource('compare').addMethod('GET', integrate(this.contractVersionFunction));

    // POST /contract-analysis/simulate
    root.addResource('simulate').addMethod('POST', integrate(this.contractSimulateFunction));

    // GET /contract-analysis/checklist (첨부서류 체크리스트)
    root.addResource('checklist').addMethod('GET', integrate(this.contractAnalyzeFunction));

    // POST /contract-analysis/admin/rulesets (관리자 룰셋/표준계약서 갱신)
    const adminResource = root.addResource('admin');
    adminResource.addResource('rulesets').addMethod('POST', integrate(this.contractAdminFunction));

    // ─── 스택 출력 ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ContractAnalysisApiUrl', {
      value: this.api.url,
      description: '계약서 분석 API 엔드포인트 URL',
    });

    new cdk.CfnOutput(this, 'ContractAnalysisAlertTopicArn', {
      value: alertTopic.topicArn,
      description: '계약서 분석 룰셋 적재 실패 알림 토픽 ARN',
    });

    new cdk.CfnOutput(this, 'ContractAnalyzeFunctionArn', {
      value: this.contractAnalyzeFunction.functionArn,
      description: '계약서 분석 오케스트레이터 Lambda ARN',
    });
  }
}
