/**
 * @fileoverview 부동산 계산기 통합 서비스 CDK 스택 (독립 경량 스택)
 * @description 취득비용·양도소득세·중개수수료를 산출하는 결정론적 순수 계산 서비스의
 * AWS 인프라를 정의한다. 기존 AI 자문 서비스(법률/세무/판례/계약서 분석)와 완전히
 * 독립된 스택으로 배포·업데이트·롤백이 가능하다.
 *
 * 설계 원칙:
 * - 계산 Lambda(취득/양도/중개/계약서 연동)는 외부 의존이 전혀 없는 경량 순수 함수다.
 *   벡터/OpenSearch/S3/DynamoDB 의존이 없으므로 기본 실행 역할만 부여한다.
 * - AI 자문 보조 Lambda(ai-assist)만 세무 자문 서비스(real-estate-tax-ai-advisor)
 *   위임 호출 및 Bedrock 호출 권한이 필요하다. AI 채널 장애는 계산 결과에 전파되지
 *   않는다(핸들러/오케스트레이터 수준 격리).
 * - 계산 이력 저장은 선택 사항이다. `enableHistoryTable`가 true일 때만 `CALC#`
 *   파티션 키 접두사 기반 DynamoDB 테이블을 생성한다. 순수 계산 자체는 저장 없이 동작한다.
 * - 참고 스택인 case-search-stack와 동일하게 자체 API Gateway를 소유하여 장애를 격리한다
 *   (`/calculators/*` 경로, Rate Limiting, CORS). 공유 법률 API 스택(api-stack)은 수정하지 않는다.
 *
 * 모든 Lambda는 단일 모듈 핸들러(`src/modules/calculators/handler.ts`의 `handler`)를
 * 진입점으로 사용하며, 경로별로 오케스트레이터에 위임한다. 장애 격리와 리소스 튜닝을
 * 위해 기능별로 개별 Lambda를 배포한다(case-search가 동일 asset을 다수 Lambda로 배포하는 방식).
 *
 * @requirements 9.1 - RESTful API 엔드포인트로 계산 기능 제공
 * @requirements 9.2 - HTTP 메서드/경로 기반 라우팅(/calculators/*)
 * @requirements 9.4 - Rate Limiting, CORS, 표준 오류 응답
 * @requirements 9.6 - 기존 AI 자문 서비스와 독립 스택으로 배포/업데이트/롤백
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * CalculatorsStack 프로퍼티.
 *
 * 계산 서비스는 순수 함수이므로 공유 인프라(S3/OpenSearch/공유 DynamoDB) 의존이 없다.
 * AI 보조 경로만 세무 자문 서비스 위임을 위해 대상 Lambda(선택)를 주입받는다.
 */
export interface CalculatorsStackProps extends cdk.StackProps {
  /** 환경 (dev/staging/prod) */
  environment: string;
  /**
   * 세무 자문 서비스(real-estate-tax-ai-advisor) 질의 Lambda (AI 보조 위임용, 선택).
   * 주입 시 ai-assist Lambda가 해당 함수만 호출하도록 최소 권한을 부여한다.
   * 미주입 시 이름 규칙 기반 ARN으로 권한을 부여한다.
   */
  taxAdvisorQueryFunction?: lambda.IFunction;
  /**
   * 계산 이력 DynamoDB 테이블 생성 여부 (선택, 기본 false).
   * true일 때만 `CALC#` 파티션 키 접두사 기반 이력 테이블을 생성한다.
   */
  enableHistoryTable?: boolean;
}

/**
 * 부동산 계산기 통합 서비스 전용 인프라 스택.
 *
 * 경량 순수 계산 Lambda 5종과 자체 API Gateway를 구성한다. 계산 Lambda는
 * 외부 의존이 없고, AI 보조 Lambda만 세무 자문 위임/Bedrock 권한을 갖는다.
 */
export class CalculatorsStack extends cdk.Stack {
  /** 취득비용 계산 Lambda (POST /calculators/acquisition) */
  public readonly acquisitionFunction: lambda.IFunction;
  /** 양도소득세 계산 Lambda (POST /calculators/transfer-tax) */
  public readonly transferFunction: lambda.IFunction;
  /** 중개수수료 계산 Lambda (POST /calculators/brokerage) */
  public readonly brokerageFunction: lambda.IFunction;
  /** 계약서 연동 계산 Lambda (POST /calculators/from-contract) */
  public readonly bridgeFunction: lambda.IFunction;
  /** AI 자문 보조 Lambda (POST /calculators/ai-assist) */
  public readonly aiAssistFunction: lambda.IFunction;
  /** 계산기 API */
  public readonly api: apigateway.RestApi;
  /** (선택) 계산 이력 테이블 */
  public readonly historyTable?: dynamodb.Table;

  constructor(scope: Construct, id: string, props: CalculatorsStackProps) {
    super(scope, id, props);

    const { environment, taxAdvisorQueryFunction, enableHistoryTable = false } = props;

    // 계산 서비스 asset (esbuild 번들 출력: dist/modules/calculators/handler.js)
    const calcAsset = 'dist/modules/calculators';

    // ─── 공통 환경 변수 ──────────────────────────────────────────────────────
    // 계산 Lambda는 순수 함수이므로 별도 데이터 저장/조회 설정이 필요 없다.
    const commonEnvVars: Record<string, string> = {
      ENVIRONMENT: environment,
      REGION: this.region,
      SERVICE_PREFIX: 'CALC',
    };

    // ─── (선택) 계산 이력 DynamoDB 테이블 ────────────────────────────────────
    // 계산 이력 저장이 필요한 경우에만 생성한다. 순수 계산은 저장 없이 동작한다.
    // PK: CALC#{calculatorType}#{sessionId}, SK: HISTORY#{timestamp}
    if (enableHistoryTable) {
      this.historyTable = new dynamodb.Table(this, 'CalculatorHistoryTable', {
        tableName: `calculators-history-${environment}`,
        partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        timeToLiveAttribute: 'ttl',
        removalPolicy:
          environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      });
      commonEnvVars.CALC_HISTORY_TABLE = this.historyTable.tableName;
    }

    // ─── IAM 역할 헬퍼 ───────────────────────────────────────────────────────

    /** 기본 실행 역할만 갖는 경량 계산 Lambda 역할을 생성한다(외부 의존 없음). */
    const createLightRole = (roleId: string): iam.Role => {
      const role = new iam.Role(this, roleId, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaBasicExecutionRole',
          ),
        ],
      });
      // 이력 테이블이 활성화된 경우에만 CALC# 접두사 쓰기 권한을 부여한다(선택).
      if (this.historyTable) {
        role.addToPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:PutItem'],
            resources: [this.historyTable.tableArn],
            conditions: {
              'ForAllValues:StringLike': {
                'dynamodb:LeadingKeys': ['CALC#*'],
              },
            },
          }),
        );
      }
      return role;
    };

    // ─── 계산 Lambda 함수 헬퍼(경량, 외부 의존 없음) ─────────────────────────
    const createCalcFunction = (
      fnId: string,
      opts: {
        functionName: string;
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
        code: lambda.Code.fromAsset(calcAsset),
        role: opts.role,
        timeout: cdk.Duration.seconds(opts.timeoutSeconds),
        memorySize: opts.memorySize,
        environment: commonEnvVars,
        description: opts.description,
      });

    // ─── 계산 Lambda: 취득비용 (POST /calculators/acquisition) ───────────────
    this.acquisitionFunction = createCalcFunction('CalculatorsAcquisitionFunction', {
      functionName: `calculators-acquisition-${environment}`,
      role: createLightRole('CalculatorsAcquisitionRole'),
      timeoutSeconds: 10,
      memorySize: 256,
      description: '취득비용 계산 - POST /calculators/acquisition (순수 함수, 외부 의존 없음)',
    });

    // ─── 계산 Lambda: 양도소득세 (POST /calculators/transfer-tax) ────────────
    this.transferFunction = createCalcFunction('CalculatorsTransferFunction', {
      functionName: `calculators-transfer-${environment}`,
      role: createLightRole('CalculatorsTransferRole'),
      timeoutSeconds: 10,
      memorySize: 256,
      description: '양도소득세 계산 - POST /calculators/transfer-tax (순수 함수, 외부 의존 없음)',
    });

    // ─── 계산 Lambda: 중개수수료 (POST /calculators/brokerage) ───────────────
    this.brokerageFunction = createCalcFunction('CalculatorsBrokerageFunction', {
      functionName: `calculators-brokerage-${environment}`,
      role: createLightRole('CalculatorsBrokerageRole'),
      timeoutSeconds: 10,
      memorySize: 256,
      description: '중개수수료 계산 - POST /calculators/brokerage (순수 함수, 외부 의존 없음)',
    });

    // ─── 계산 Lambda: 계약서 연동 (POST /calculators/from-contract) ──────────
    // 계약서 표준 스키마를 소비하는 결정론적 매핑·계산 경로. 외부 의존 없음.
    this.bridgeFunction = createCalcFunction('CalculatorsBridgeFunction', {
      functionName: `calculators-bridge-${environment}`,
      role: createLightRole('CalculatorsBridgeRole'),
      timeoutSeconds: 10,
      memorySize: 256,
      description: '계약서 연동 계산 - POST /calculators/from-contract (순수 함수, 외부 의존 없음)',
    });

    // ─── AI 보조 Lambda: 세무 자문 위임/Bedrock 권한 ─────────────────────────
    // 계산과 분리된 별도 설명 채널. 세무 자문 서비스 위임 호출 또는 직접 Bedrock 호출.
    const aiAssistRole = new iam.Role(this, 'CalculatorsAiAssistRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });

    // 세무 자문 서비스(real-estate-tax-ai-advisor) 질의 Lambda 위임 호출 권한.
    // 주입되면 해당 함수만, 미주입 시 이름 규칙 기반 ARN으로 최소 권한을 부여한다.
    const taxAdvisorFunctionArn = taxAdvisorQueryFunction
      ? taxAdvisorQueryFunction.functionArn
      : `arn:aws:lambda:${this.region}:${this.account}:function:tax-advisor-query-${environment}`;

    aiAssistRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [taxAdvisorFunctionArn],
      }),
    );

    // Bedrock: Claude 3.5 Sonnet (AI 보조 설명 생성용)
    aiAssistRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
        ],
      }),
    );

    const aiAssistEnvVars: Record<string, string> = {
      ...commonEnvVars,
      // 배포 시 세무 자문 서비스 위임을 기본 제공자로 사용한다(로컬은 Gemini).
      AI_ADVISOR_PROVIDER: 'tax_advisor_delegation',
    };
    if (taxAdvisorQueryFunction) {
      aiAssistEnvVars.TAX_ADVISOR_FUNCTION_NAME = taxAdvisorQueryFunction.functionName;
    }

    this.aiAssistFunction = new lambda.Function(this, 'CalculatorsAiAssistFunction', {
      functionName: `calculators-ai-assist-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(calcAsset),
      role: aiAssistRole,
      // AI 보조 채널은 30초 타임아웃(오케스트레이터 Circuit Breaker와 정합)
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: aiAssistEnvVars,
      description: 'AI 자문 보조 - POST /calculators/ai-assist (세무 자문 위임/Bedrock, 계산과 격리)',
    });

    // ─── API Gateway: /calculators/* (자체 API, 장애 격리) ───────────────────
    // 참고 스택 case-search와 동일하게 자체 API Gateway를 소유한다.
    // Rate Limiting/CORS를 스택 수준에서 설정하여 공유 법률 API를 수정하지 않는다.
    this.api = new apigateway.RestApi(this, 'CalculatorsApi', {
      restApiName: `calculators-api-${environment}`,
      description: '부동산 계산기 통합 서비스 API (취득/양도/중개/계약서 연동/AI 보조)',
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
    });

    const integrate = (fn: lambda.IFunction) =>
      new apigateway.LambdaIntegration(fn as lambda.Function, { proxy: true });

    // /calculators 루트 리소스
    const root = this.api.root.addResource('calculators');

    // POST /calculators/acquisition
    root.addResource('acquisition').addMethod('POST', integrate(this.acquisitionFunction));

    // POST /calculators/transfer-tax
    root.addResource('transfer-tax').addMethod('POST', integrate(this.transferFunction));

    // POST /calculators/brokerage
    root.addResource('brokerage').addMethod('POST', integrate(this.brokerageFunction));

    // POST /calculators/from-contract
    root.addResource('from-contract').addMethod('POST', integrate(this.bridgeFunction));

    // POST /calculators/ai-assist
    root.addResource('ai-assist').addMethod('POST', integrate(this.aiAssistFunction));

    // GET /calculators/rate-tables (기준연도별 기준표 조회 - 취득 계산 Lambda 재사용)
    root.addResource('rate-tables').addMethod('GET', integrate(this.acquisitionFunction));

    // ─── 스택 출력 ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CalculatorsApiUrl', {
      value: this.api.url,
      description: '계산기 통합 서비스 API 엔드포인트 URL',
    });

    new cdk.CfnOutput(this, 'CalculatorsAcquisitionFunctionArn', {
      value: this.acquisitionFunction.functionArn,
      description: '취득비용 계산 Lambda ARN',
    });

    new cdk.CfnOutput(this, 'CalculatorsAiAssistFunctionArn', {
      value: this.aiAssistFunction.functionArn,
      description: 'AI 자문 보조 Lambda ARN',
    });

    if (this.historyTable) {
      new cdk.CfnOutput(this, 'CalculatorsHistoryTableName', {
        value: this.historyTable.tableName,
        description: '(선택) 계산 이력 DynamoDB 테이블 이름',
      });
    }
  }
}
