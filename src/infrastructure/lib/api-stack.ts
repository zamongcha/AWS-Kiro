import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  environment: string;
  queryHandlerFunction: lambda.IFunction;
  adminFunction: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { environment, queryHandlerFunction, adminFunction } = props;

    // ─── REST API ────────────────────────────────────────────────────────────────
    this.api = new apigateway.RestApi(this, 'RealEstateLegalApi', {
      restApiName: `real-estate-legal-api-${environment}`,
      description: '부동산 법률 AI 자문 시스템 REST API',
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
          'X-Session-Id',
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // ─── Request/Response Models ─────────────────────────────────────────────────
    const questionRequestModel = this.api.addModel('QuestionRequestModel', {
      contentType: 'application/json',
      modelName: 'QuestionRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['question'],
        properties: {
          question: {
            type: apigateway.JsonSchemaType.STRING,
            minLength: 10,
            maxLength: 1000,
          },
          sessionId: {
            type: apigateway.JsonSchemaType.STRING,
          },
        },
      },
    });

    const feedbackRequestModel = this.api.addModel('FeedbackRequestModel', {
      contentType: 'application/json',
      modelName: 'FeedbackRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['sessionId', 'questionId', 'rating'],
        properties: {
          sessionId: {
            type: apigateway.JsonSchemaType.STRING,
          },
          questionId: {
            type: apigateway.JsonSchemaType.STRING,
          },
          rating: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ['helpful', 'not_helpful'],
          },
          comment: {
            type: apigateway.JsonSchemaType.STRING,
            maxLength: 500,
          },
        },
      },
    });

    // ─── Request Validator ───────────────────────────────────────────────────────
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: this.api,
      requestValidatorName: 'validate-body',
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // ─── Lambda Integrations ─────────────────────────────────────────────────────
    const queryHandlerIntegration = new apigateway.LambdaIntegration(queryHandlerFunction, {
      proxy: true,
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
          },
        },
      ],
    });

    const adminIntegration = new apigateway.LambdaIntegration(adminFunction, {
      proxy: true,
    });

    // ─── POST /questions ─────────────────────────────────────────────────────────
    const questionsResource = this.api.root.addResource('questions');
    questionsResource.addMethod('POST', queryHandlerIntegration, {
      requestModels: { 'application/json': questionRequestModel },
      requestValidator,
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        { statusCode: '400' },
        { statusCode: '500' },
      ],
    });

    // ─── GET /categories ─────────────────────────────────────────────────────────
    const categoriesResource = this.api.root.addResource('categories');
    categoriesResource.addMethod('GET', queryHandlerIntegration, {
      methodResponses: [
        { statusCode: '200' },
      ],
    });

    // ─── POST /feedback ──────────────────────────────────────────────────────────
    const feedbackResource = this.api.root.addResource('feedback');
    feedbackResource.addMethod('POST', queryHandlerIntegration, {
      requestModels: { 'application/json': feedbackRequestModel },
      requestValidator,
      methodResponses: [
        { statusCode: '200' },
        { statusCode: '400' },
      ],
    });

    // ─── GET /admin/status ───────────────────────────────────────────────────────
    const adminResource = this.api.root.addResource('admin');
    const adminStatusResource = adminResource.addResource('status');
    adminStatusResource.addMethod('GET', adminIntegration, {
      methodResponses: [
        { statusCode: '200' },
      ],
    });

    // ─── Outputs ─────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'REST API 엔드포인트 URL',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'REST API ID',
    });
  }
}
