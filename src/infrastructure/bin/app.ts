import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { ComputeStack } from '../lib/compute-stack';
import { ApiStack } from '../lib/api-stack';
import { SchedulingStack } from '../lib/scheduling-stack';
import { TaxAdvisorStack } from '../lib/tax-advisor-stack';
import { CaseSearchStack } from '../lib/case-search-stack';
import { ContractAnalysisStack } from '../lib/contract-analysis-stack';
import { CalculatorsStack } from '../lib/calculators-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') || 'dev';

const defaultEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-2',
};

// ─── 공유 인프라: 스토리지 스택 ─────────────────────────────────────────────────
const storageStack = new StorageStack(app, `RealEstateLegal-Storage-${env}`, {
  env: defaultEnv,
  environment: env,
});

// ─── 법률 자문: 컴퓨트 스택 ──────────────────────────────────────────────────────
const computeStack = new ComputeStack(app, `RealEstateLegal-Compute-${env}`, {
  env: defaultEnv,
  environment: env,
  dataBucket: storageStack.dataBucket,
  sessionsTable: storageStack.sessionsTable,
  dataManagementTable: storageStack.dataManagementTable,
  feedbackTable: storageStack.feedbackTable,
  synonymDictionaryTable: storageStack.synonymDictionaryTable,
  openSearchCollectionArn: storageStack.openSearchCollectionArn,
  openSearchCollectionEndpoint: storageStack.openSearchCollectionEndpoint,
});

computeStack.addDependency(storageStack);

// ─── 법률 자문: API 스택 ─────────────────────────────────────────────────────────
const apiStack = new ApiStack(app, `RealEstateLegal-Api-${env}`, {
  env: defaultEnv,
  environment: env,
  queryHandlerFunction: computeStack.queryHandlerFunction,
  adminFunction: computeStack.adminFunction,
});

apiStack.addDependency(computeStack);

// ─── 법률 자문: 스케줄링 스택 ────────────────────────────────────────────────────
const schedulingStack = new SchedulingStack(app, `RealEstateLegal-Scheduling-${env}`, {
  env: defaultEnv,
  environment: env,
  lawCollectorFunction: computeStack.lawCollectorFunction,
  caseCollectorFunction: computeStack.caseCollectorFunction,
});

schedulingStack.addDependency(computeStack);

// ─── 세무 자문: 전용 스택 ────────────────────────────────────────────────────────
// 기존 StorageStack의 공유 인프라(OpenSearch, DynamoDB, S3)를 활용하되
// 별도 Lambda, API Gateway, EventBridge로 장애 격리를 보장한다.
// OpenSearch는 동일 컬렉션의 별도 인덱스(tax-laws, tax-rulings)를 사용한다.
const taxAdvisorStack = new TaxAdvisorStack(app, `RealEstateTax-Advisor-${env}`, {
  env: defaultEnv,
  environment: env,
  dataBucket: storageStack.dataBucket,
  sessionsTable: storageStack.sessionsTable,
  dataManagementTable: storageStack.dataManagementTable,
  feedbackTable: storageStack.feedbackTable,
  synonymDictionaryTable: storageStack.synonymDictionaryTable,
  openSearchCollectionArn: storageStack.openSearchCollectionArn,
  openSearchCollectionEndpoint: storageStack.openSearchCollectionEndpoint,
});

taxAdvisorStack.addDependency(storageStack);

// ─── 판례 검색: 전용 스택 ────────────────────────────────────────────────────────
// 기존 StorageStack의 공유 인프라(OpenSearch, DynamoDB, S3)를 활용하되
// 별도 Lambda, API Gateway로 장애 격리를 보장한다.
// OpenSearch는 동일 컬렉션의 court-cases 인덱스를 읽기 전용으로 공유한다.
const caseSearchStack = new CaseSearchStack(app, `RealEstateCaseSearch-${env}`, {
  env: defaultEnv,
  environment: env,
  dataBucket: storageStack.dataBucket,
  sessionsTable: storageStack.sessionsTable,
  feedbackTable: storageStack.feedbackTable,
  synonymDictionaryTable: storageStack.synonymDictionaryTable,
  openSearchCollectionArn: storageStack.openSearchCollectionArn,
  openSearchCollectionEndpoint: storageStack.openSearchCollectionEndpoint,
});

caseSearchStack.addDependency(storageStack);

// ─── 계약서 분석: 전용 스택 ──────────────────────────────────────────────────────
// 기존 StorageStack의 공유 인프라(OpenSearch, DynamoDB, S3)를 활용하되
// 별도 Lambda, API Gateway, SNS로 장애 격리를 보장한다.
// 데이터 격리: OpenSearch contract-* 인덱스, DynamoDB CONTRACT# 파티션 키,
// S3 contract-data/ 접두사, API Gateway /contract-analysis/* 경로.
// 판례 연동은 판례 검색 서비스(case-search-analyze) Lambda를 호출하며,
// 장애 시 판례 연동을 제외한 분석을 계속한다.
const contractAnalysisStack = new ContractAnalysisStack(app, `RealEstateContractAnalysis-${env}`, {
  env: defaultEnv,
  environment: env,
  dataBucket: storageStack.dataBucket,
  sessionsTable: storageStack.sessionsTable,
  dataManagementTable: storageStack.dataManagementTable,
  feedbackTable: storageStack.feedbackTable,
  openSearchCollectionArn: storageStack.openSearchCollectionArn,
  openSearchCollectionEndpoint: storageStack.openSearchCollectionEndpoint,
  caseSearchAnalyzeFunction: caseSearchStack.caseSearchAnalyzeFunction,
});

contractAnalysisStack.addDependency(storageStack);
contractAnalysisStack.addDependency(caseSearchStack);

// ─── 계산기 통합: 전용 스택 (독립 경량 스택) ─────────────────────────────────────
// 취득비용·양도소득세·중개수수료를 산출하는 결정론적 순수 계산 서비스.
// 기존 AI 자문 서비스와 완전히 독립된 스택으로 배포/업데이트/롤백이 가능하다.
// 계산 Lambda는 외부 의존(OpenSearch/S3/DynamoDB)이 없는 경량 함수이며,
// AI 보조 Lambda만 세무 자문 서비스(real-estate-tax-ai-advisor) 위임/Bedrock 권한을 갖는다.
// 자체 API Gateway(/calculators/*, Rate Limiting, CORS)를 소유하여 장애를 격리한다.
const calculatorsStack = new CalculatorsStack(app, `RealEstateCalculators-${env}`, {
  env: defaultEnv,
  environment: env,
  // AI 보조 경로의 세무 자문 위임 대상(선택). 세무 자문 스택의 질의 Lambda를 주입한다.
  taxAdvisorQueryFunction: taxAdvisorStack.taxQueryHandlerFunction,
  // 계산 이력 테이블은 선택 사항이며 기본 비활성화(순수 계산은 저장 없이 동작).
  enableHistoryTable: false,
});

// AI 보조 위임 대상 Lambda ARN 참조를 위해 세무 자문 스택에 의존한다.
// (계산 경로 자체는 순수 함수이므로 어떤 스택에도 의존하지 않는다.)
calculatorsStack.addDependency(taxAdvisorStack);

app.synth();
