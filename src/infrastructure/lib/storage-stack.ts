import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  environment: string;
}

export class StorageStack extends cdk.Stack {
  public readonly dataBucket: s3.IBucket;
  public readonly sessionsTable: dynamodb.ITable;
  public readonly dataManagementTable: dynamodb.ITable;
  public readonly feedbackTable: dynamodb.ITable;
  public readonly synonymDictionaryTable: dynamodb.ITable;
  public readonly openSearchCollectionArn: string;
  public readonly openSearchCollectionEndpoint: string;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // ─── S3 Bucket ───────────────────────────────────────────────────────────────
    const bucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `real-estate-legal-data-${environment}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      lifecycleRules: [
        {
          id: 'archive-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(90),
          enabled: true,
        },
      ],
    });
    this.dataBucket = bucket;

    // ─── DynamoDB: Sessions ──────────────────────────────────────────────────────
    const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: `RealEstateLegal-Sessions-${environment}`,
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });
    this.sessionsTable = sessionsTable;

    // ─── DynamoDB: DataManagement ────────────────────────────────────────────────
    const dataManagementTable = new dynamodb.Table(this, 'DataManagementTable', {
      tableName: `RealEstateLegal-DataManagement-${environment}`,
      partitionKey: { name: 'dataType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: environment === 'prod',
    });

    dataManagementTable.addGlobalSecondaryIndex({
      indexName: 'vectorStatus-index',
      partitionKey: { name: 'dataType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'lastUpdated', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.dataManagementTable = dataManagementTable;

    // ─── DynamoDB: Feedback ──────────────────────────────────────────────────────
    const feedbackTable = new dynamodb.Table(this, 'FeedbackTable', {
      tableName: `RealEstateLegal-Feedback-${environment}`,
      partitionKey: { name: 'feedbackId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'sessionId-timestamp-index',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.feedbackTable = feedbackTable;

    // ─── DynamoDB: SynonymDictionary ─────────────────────────────────────────────
    const synonymDictionaryTable = new dynamodb.Table(this, 'SynonymDictionaryTable', {
      tableName: `RealEstateLegal-SynonymDictionary-${environment}`,
      partitionKey: { name: 'term', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });
    this.synonymDictionaryTable = synonymDictionaryTable;

    // ─── OpenSearch Serverless Collection ────────────────────────────────────────
    const collectionName = `real-estate-legal-${environment}`;

    // Encryption policy (required for OpenSearch Serverless)
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${collectionName}-encryption`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`],
          },
        ],
        AWSOwnedKey: true,
      }),
    });

    // Network policy
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${collectionName}-network`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/${collectionName}`],
            },
          ],
          AllowFromPublic: true,
        },
      ]),
    });

    // OpenSearch Serverless Collection
    const collection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
      name: collectionName,
      type: 'VECTORSEARCH',
      description: '부동산 법률 AI 자문 시스템 - 법령/판례 벡터 저장소',
    });

    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);

    this.openSearchCollectionArn = collection.attrArn;
    this.openSearchCollectionEndpoint = collection.attrCollectionEndpoint;

    // ─── Outputs ─────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DataBucketName', {
      value: bucket.bucketName,
      description: '법령/판례 원본 데이터 저장 S3 버킷',
    });

    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: sessionsTable.tableName,
      description: '세션 관리 DynamoDB 테이블',
    });

    new cdk.CfnOutput(this, 'OpenSearchCollectionEndpoint', {
      value: collection.attrCollectionEndpoint,
      description: 'OpenSearch Serverless 컬렉션 엔드포인트',
    });
  }
}
