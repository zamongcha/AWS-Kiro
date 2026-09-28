/**
 * @fileoverview 계약서 분석 DynamoDB 저장소 클라이언트
 * @description 기존 시스템의 DynamoDB 테이블을 공유하며, 파티션 키에
 * `CONTRACT#` 접두사를 강제하여 데이터를 논리적으로 격리한다.
 *
 * 관리 레코드 종류:
 * - 계약서 문서 레코드   (PK: CONTRACT#DOC#{documentId},      SK: METADATA)
 * - 분석 결과 레코드     (PK: CONTRACT#DOC#{documentId},      SK: ANALYSIS#{timestamp})
 * - 룰셋 메타데이터      (PK: CONTRACT#RULESET#{type},        SK: version#{n})
 * - 표준계약서 메타데이터 (PK: CONTRACT#STANDARD#{type},       SK: version#{n})
 * - 시스템 설정 레코드   (PK: CONTRACT#CONFIG,                SK: fraud_threshold)
 *
 * @requirements 12.2 - 버전/문서 레코드 DynamoDB 저장
 * @requirements 14.8 - 오류 발생 시 문서 식별자 24시간 보존
 * @requirements 16.2 - DynamoDB `CONTRACT#` 파티션 키 접두사로 데이터 격리
 * @requirements 15.5 - 룰셋/표준계약서 갱신 시각·버전 메타데이터 관리
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ContractType } from '../interfaces/types.js';
import type {
  ContractDocumentRecord,
  ContractAnalysisRecord,
  ContractVersionRecord,
  RuleSetMetadataRecord,
  ContractConfigRecord,
} from '../interfaces/records.js';

/**
 * 계약서 데이터 격리 파티션 키 접두사
 *
 * 모든 파티션 키는 반드시 이 접두사로 시작해야 한다.
 */
export const CONTRACT_PK_PREFIX = 'CONTRACT#';

/** 전세사기 위험 점수 기본 임계값 */
export const DEFAULT_FRAUD_SCORE_THRESHOLD = 70;

/** 시스템 설정 레코드 정렬 키 (전세사기 임계값) */
const CONFIG_SK_FRAUD_THRESHOLD = 'fraud_threshold';

/** 오류 발생 시 문서 식별자 TTL 보존 기간 (24시간, 초 단위) */
const ERROR_TTL_SECONDS = 24 * 60 * 60;

/** 버전 정렬 키 zero-padding 자릿수 (VERSION#000001 형식) */
const VERSION_SK_PAD_WIDTH = 6;

/**
 * 계약서 DynamoDB 저장소 설정
 */
export interface ContractDynamoStoreConfig {
  /** DynamoDB 테이블 이름 */
  tableName: string;
  /** AWS 리전 */
  region: string;
}

/** 기본 설정 */
const DEFAULT_CONFIG: ContractDynamoStoreConfig = {
  tableName: process.env['DYNAMODB_TABLE'] || 'DataManagement',
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
};

/**
 * 계약서 분석 DynamoDB 저장소 클라이언트
 *
 * 기존 세무/판례 저장소와 동일한 SDK 버전(@aws-sdk/lib-dynamodb) 및
 * 클라이언트 초기화 패턴(`DynamoDBDocumentClient.from(...)`)을 사용한다.
 * 모든 쓰기 작업은 파티션 키가 `CONTRACT#` 접두사로 시작하는지 검증한다.
 */
export class ContractDynamoStore {
  private dynamoClient: DynamoDBDocumentClient;
  private config: ContractDynamoStoreConfig;

  constructor(config: Partial<ContractDynamoStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    const ddbClient = new DynamoDBClient({ region: this.config.region });
    this.dynamoClient = DynamoDBDocumentClient.from(ddbClient);
  }

  // ---------------------------------------------------------------------------
  // 키 빌더 (모든 PK가 CONTRACT# 접두사로 시작하도록 강제)
  // ---------------------------------------------------------------------------

  /**
   * 계약서 문서 파티션 키를 생성한다.
   *
   * @param documentId - 문서 식별자
   * @returns `CONTRACT#DOC#{documentId}`
   */
  buildDocumentPK(documentId: string): string {
    return this.assertContractPK(`${CONTRACT_PK_PREFIX}DOC#${documentId}`);
  }

  /**
   * 룰셋 메타데이터 파티션 키를 생성한다.
   *
   * @param contractType - 계약 유형
   * @returns `CONTRACT#RULESET#{contractType}`
   */
  buildRuleSetPK(contractType: ContractType): string {
    return this.assertContractPK(`${CONTRACT_PK_PREFIX}RULESET#${contractType}`);
  }

  /**
   * 표준계약서 메타데이터 파티션 키를 생성한다.
   *
   * @param contractType - 계약 유형
   * @returns `CONTRACT#STANDARD#{contractType}`
   */
  buildStandardPK(contractType: ContractType): string {
    return this.assertContractPK(`${CONTRACT_PK_PREFIX}STANDARD#${contractType}`);
  }

  /**
   * 시스템 설정 파티션 키를 생성한다.
   *
   * @returns `CONTRACT#CONFIG`
   */
  buildConfigPK(): string {
    return this.assertContractPK(`${CONTRACT_PK_PREFIX}CONFIG`);
  }

  /**
   * 계약서 버전 파티션 키를 생성한다.
   *
   * 버전 레코드는 문서 레코드(`CONTRACT#DOC#...`)와 달리 설계 정의에 따라
   * `CONTRACT#{documentId}` 형식의 파티션 키를 사용한다.
   *
   * @param documentId - 문서 식별자
   * @returns `CONTRACT#{documentId}`
   */
  buildVersionPK(documentId: string): string {
    return this.assertContractPK(`${CONTRACT_PK_PREFIX}${documentId}`);
  }

  /**
   * 계약서 버전 정렬 키를 생성한다.
   *
   * 버전 번호를 6자리 zero-padding 하여 문자열 정렬이 버전 번호 순서와
   * 일치하도록 한다(예: 1 → `VERSION#000001`).
   *
   * @param versionNumber - 버전 번호 (1 이상)
   * @returns `VERSION#{zeroPaddedVersion}`
   */
  buildVersionSK(versionNumber: number): string {
    return `VERSION#${String(versionNumber).padStart(VERSION_SK_PAD_WIDTH, '0')}`;
  }

  /**
   * 파티션 키가 `CONTRACT#` 접두사로 시작하는지 강제 검증한다.
   *
   * 데이터 격리 불변식을 위반하는 키는 저장 자체를 차단한다.
   *
   * @param pk - 검증할 파티션 키
   * @returns 검증을 통과한 파티션 키
   * @throws {Error} 접두사 위반 시
   */
  private assertContractPK(pk: string): string {
    if (!pk.startsWith(CONTRACT_PK_PREFIX)) {
      throw new Error(
        `계약서 저장소 파티션 키는 '${CONTRACT_PK_PREFIX}' 접두사로 시작해야 합니다: ${pk}`,
      );
    }
    return pk;
  }

  // ---------------------------------------------------------------------------
  // 계약서 문서 레코드 CRUD
  // ---------------------------------------------------------------------------

  /**
   * 계약서 문서 레코드를 저장한다.
   *
   * 상태가 `error`인 경우 문서 식별자를 24시간 동안 보존하도록 TTL을 부여한다.
   *
   * @param record - 저장할 문서 레코드 (PK/SK/ttl 미지정 시 자동 생성)
   * @returns 저장된 문서 레코드
   */
  async saveDocument(
    record: Omit<ContractDocumentRecord, 'PK' | 'SK' | 'ttl'> &
      Partial<Pick<ContractDocumentRecord, 'ttl'>>,
  ): Promise<ContractDocumentRecord> {
    const item: ContractDocumentRecord = {
      ...record,
      PK: this.buildDocumentPK(record.documentId),
      SK: 'METADATA',
      ttl: record.ttl ?? this.computeErrorTtl(),
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: item,
      }),
    );

    return item;
  }

  /**
   * 계약서 문서 레코드를 조회한다.
   *
   * @param documentId - 문서 식별자
   * @returns 문서 레코드 또는 null
   */
  async getDocument(documentId: string): Promise<ContractDocumentRecord | null> {
    const response = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: { PK: this.buildDocumentPK(documentId), SK: 'METADATA' },
      }),
    );

    return (response.Item as ContractDocumentRecord | undefined) ?? null;
  }

  /**
   * 계약서 문서 레코드를 삭제한다.
   *
   * @param documentId - 문서 식별자
   */
  async deleteDocument(documentId: string): Promise<void> {
    await this.dynamoClient.send(
      new DeleteCommand({
        TableName: this.config.tableName,
        Key: { PK: this.buildDocumentPK(documentId), SK: 'METADATA' },
      }),
    );
  }

  /**
   * 오류 발생 시 문서 식별자를 24시간 보존하도록 TTL을 갱신한다.
   *
   * @param documentId - 문서 식별자
   * @returns 갱신된 TTL(epoch 초)
   */
  async preserveOnError(documentId: string): Promise<number> {
    const existing = await this.getDocument(documentId);
    const ttl = this.computeErrorTtl();

    if (existing) {
      await this.saveDocument({ ...existing, status: 'error', ttl });
    }

    return ttl;
  }

  // ---------------------------------------------------------------------------
  // 분석 결과 레코드
  // ---------------------------------------------------------------------------

  /**
   * 분석 결과 레코드를 저장한다.
   *
   * 정렬 키는 `ANALYSIS#{timestamp}` 형식이며, 미지정 시 현재 시각(ISO 8601)을 사용한다.
   *
   * @param documentId - 문서 식별자
   * @param result - 분석 결과 (PK/SK 제외)
   * @param timestamp - 분석 시각 (ISO 8601, 기본값: 현재 시각)
   * @returns 저장된 분석 결과 레코드
   */
  async saveAnalysis(
    documentId: string,
    result: Omit<ContractAnalysisRecord, 'PK' | 'SK'>,
    timestamp: string = new Date().toISOString(),
  ): Promise<ContractAnalysisRecord> {
    const item: ContractAnalysisRecord = {
      ...result,
      PK: this.buildDocumentPK(documentId),
      SK: `ANALYSIS#${timestamp}`,
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: item,
      }),
    );

    return item;
  }

  /**
   * 특정 문서의 분석 결과 목록을 조회한다.
   *
   * @param documentId - 문서 식별자
   * @param latestFirst - true이면 최신순 정렬 (기본값: true)
   * @returns 분석 결과 레코드 배열
   */
  async listAnalyses(
    documentId: string,
    latestFirst = true,
  ): Promise<ContractAnalysisRecord[]> {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': this.buildDocumentPK(documentId),
          ':prefix': 'ANALYSIS#',
        },
        ScanIndexForward: !latestFirst,
      }),
    );

    return (response.Items ?? []) as ContractAnalysisRecord[];
  }

  // ---------------------------------------------------------------------------
  // 룰셋 / 표준계약서 메타데이터 레코드
  // ---------------------------------------------------------------------------

  /**
   * 룰셋 메타데이터 레코드를 저장한다.
   *
   * @param contractType - 계약 유형
   * @param metadata - 메타데이터 (PK/SK 제외)
   * @returns 저장된 메타데이터 레코드
   */
  async saveRuleSetMetadata(
    contractType: ContractType,
    metadata: Omit<RuleSetMetadataRecord, 'PK' | 'SK'>,
  ): Promise<RuleSetMetadataRecord> {
    return this.saveMetadataRecord(this.buildRuleSetPK(contractType), metadata);
  }

  /**
   * 표준계약서 메타데이터 레코드를 저장한다.
   *
   * @param contractType - 계약 유형
   * @param metadata - 메타데이터 (PK/SK 제외)
   * @returns 저장된 메타데이터 레코드
   */
  async saveStandardMetadata(
    contractType: ContractType,
    metadata: Omit<RuleSetMetadataRecord, 'PK' | 'SK'>,
  ): Promise<RuleSetMetadataRecord> {
    return this.saveMetadataRecord(this.buildStandardPK(contractType), metadata);
  }

  /**
   * 룰셋의 최신 메타데이터 레코드를 조회한다.
   *
   * @param contractType - 계약 유형
   * @returns 최신 메타데이터 레코드 또는 null
   */
  async getLatestRuleSetMetadata(
    contractType: ContractType,
  ): Promise<RuleSetMetadataRecord | null> {
    return this.getLatestMetadataRecord(this.buildRuleSetPK(contractType));
  }

  /**
   * 표준계약서의 최신 메타데이터 레코드를 조회한다.
   *
   * @param contractType - 계약 유형
   * @returns 최신 메타데이터 레코드 또는 null
   */
  async getLatestStandardMetadata(
    contractType: ContractType,
  ): Promise<RuleSetMetadataRecord | null> {
    return this.getLatestMetadataRecord(this.buildStandardPK(contractType));
  }

  /**
   * 메타데이터 레코드를 저장한다. (룰셋/표준계약서 공통)
   *
   * 정렬 키는 `version#{version}` 형식으로 구성된다.
   *
   * @param pk - 파티션 키
   * @param metadata - 메타데이터 (PK/SK 제외)
   * @returns 저장된 메타데이터 레코드
   */
  private async saveMetadataRecord(
    pk: string,
    metadata: Omit<RuleSetMetadataRecord, 'PK' | 'SK'>,
  ): Promise<RuleSetMetadataRecord> {
    const item: RuleSetMetadataRecord = {
      ...metadata,
      PK: pk,
      SK: `version#${metadata.version}`,
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: item,
      }),
    );

    return item;
  }

  /**
   * 특정 파티션 키의 최신 버전 메타데이터를 조회한다.
   *
   * 버전 번호로 정렬하여 가장 높은 버전을 반환한다.
   *
   * @param pk - 파티션 키
   * @returns 최신 메타데이터 레코드 또는 null
   */
  private async getLatestMetadataRecord(
    pk: string,
  ): Promise<RuleSetMetadataRecord | null> {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':prefix': 'version#',
        },
      }),
    );

    const items = (response.Items ?? []) as RuleSetMetadataRecord[];
    if (items.length === 0) {
      return null;
    }

    // 버전 번호 기준 최고값 선택 (SK 문자열 정렬은 자릿수에 따라 부정확하므로 숫자 비교)
    return items.reduce((latest, current) =>
      current.version > latest.version ? current : latest,
    );
  }

  // ---------------------------------------------------------------------------
  // 계약서 버전 레코드 (PK: CONTRACT#{documentId}, SK: VERSION#{zeroPadded})
  // ---------------------------------------------------------------------------

  /**
   * 계약서 버전 레코드를 저장한다.
   *
   * 파티션 키는 `CONTRACT#{documentId}`, 정렬 키는 버전 번호를 zero-padding
   * 한 `VERSION#{zeroPaddedVersion}` 형식으로 구성된다. 기존 버전을 변경하지
   * 않고 신규 항목만 추가한다.
   *
   * @param documentId - 문서 식별자
   * @param record - 버전 레코드 (PK/SK 제외)
   * @returns 저장된 버전 레코드
   *
   * @requirements 12.1, 12.2
   */
  async saveVersion(
    documentId: string,
    record: Omit<ContractVersionRecord, 'PK' | 'SK'>,
  ): Promise<ContractVersionRecord> {
    const item: ContractVersionRecord = {
      ...record,
      PK: this.buildVersionPK(documentId),
      SK: this.buildVersionSK(record.versionNumber),
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: item,
      }),
    );

    return item;
  }

  /**
   * 특정 문서의 버전 레코드 목록을 조회한다.
   *
   * 정렬 키(`VERSION#{zeroPadded}`)가 버전 번호 순으로 정렬되므로,
   * 기본적으로 버전 번호 오름차순으로 반환한다.
   *
   * @param documentId - 문서 식별자
   * @param ascending - true이면 버전 번호 오름차순 (기본값: true)
   * @returns 버전 레코드 배열
   *
   * @requirements 12.2
   */
  async listVersions(
    documentId: string,
    ascending = true,
  ): Promise<ContractVersionRecord[]> {
    const response = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': this.buildVersionPK(documentId),
          ':prefix': 'VERSION#',
        },
        ScanIndexForward: ascending,
      }),
    );

    return (response.Items ?? []) as ContractVersionRecord[];
  }

  /**
   * 특정 버전 번호의 버전 레코드를 조회한다.
   *
   * @param documentId - 문서 식별자
   * @param versionNumber - 버전 번호
   * @returns 버전 레코드 또는 null
   */
  async getVersion(
    documentId: string,
    versionNumber: number,
  ): Promise<ContractVersionRecord | null> {
    const response = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: {
          PK: this.buildVersionPK(documentId),
          SK: this.buildVersionSK(versionNumber),
        },
      }),
    );

    return (response.Item as ContractVersionRecord | undefined) ?? null;
  }

  /**
   * 특정 버전 번호의 버전 레코드를 삭제한다.
   *
   * @param documentId - 문서 식별자
   * @param versionNumber - 삭제할 버전 번호
   *
   * @requirements 12.4
   */
  async deleteVersion(
    documentId: string,
    versionNumber: number,
  ): Promise<void> {
    await this.dynamoClient.send(
      new DeleteCommand({
        TableName: this.config.tableName,
        Key: {
          PK: this.buildVersionPK(documentId),
          SK: this.buildVersionSK(versionNumber),
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // 시스템 설정 레코드
  // ---------------------------------------------------------------------------

  /**
   * 전세사기 위험 점수 임계값을 저장한다.
   *
   * @param threshold - 임계값 (기본 70)
   * @returns 저장된 설정 레코드
   */
  async saveFraudScoreThreshold(
    threshold: number = DEFAULT_FRAUD_SCORE_THRESHOLD,
  ): Promise<ContractConfigRecord> {
    const item: ContractConfigRecord = {
      PK: this.buildConfigPK(),
      SK: CONFIG_SK_FRAUD_THRESHOLD,
      fraudScoreThreshold: threshold,
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: item,
      }),
    );

    return item;
  }

  /**
   * 전세사기 위험 점수 임계값을 조회한다.
   *
   * 설정 레코드가 없으면 기본값 70을 반환한다.
   *
   * @returns 전세사기 위험 점수 임계값
   */
  async getFraudScoreThreshold(): Promise<number> {
    const response = await this.dynamoClient.send(
      new GetCommand({
        TableName: this.config.tableName,
        Key: { PK: this.buildConfigPK(), SK: CONFIG_SK_FRAUD_THRESHOLD },
      }),
    );

    const item = response.Item as ContractConfigRecord | undefined;
    return item?.fraudScoreThreshold ?? DEFAULT_FRAUD_SCORE_THRESHOLD;
  }

  // ---------------------------------------------------------------------------
  // 내부 유틸리티
  // ---------------------------------------------------------------------------

  /**
   * 오류 보존용 TTL(현재 시각 + 24시간)을 epoch 초 단위로 계산한다.
   *
   * @returns TTL epoch 초
   */
  private computeErrorTtl(): number {
    return Math.floor(Date.now() / 1000) + ERROR_TTL_SECONDS;
  }
}
