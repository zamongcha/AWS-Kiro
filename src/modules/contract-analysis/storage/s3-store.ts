/**
 * @fileoverview 계약서 분석 S3 오브젝트 저장소 클라이언트
 * @description 기존 공유 S3 버킷 내에 계약서 분석 전용 접두사(`contract-data/`)를 사용하여
 * 계약서·등기부등본 원본과 인식 텍스트, 설정/처리 데이터를 격리 저장한다.
 *
 * S3 버킷 구조(design.md > Data Models > S3 버킷 구조):
 * ```
 * s3://real-estate-data-{env}/
 * └── contract-data/
 *     ├── uploads/{documentId}/original.{ext}     # 업로드 계약서 원본
 *     ├── uploads/{documentId}/registry.{ext}     # 등기부등본 원본
 *     ├── recognized/{documentId}/text.json       # 인식 텍스트 + 조항 분할
 *     ├── config/{category}/{contractType}.json   # 룰셋/표준계약서/필수특약/체크리스트
 *     └── processed/{contractType}/embeddings.json
 * ```
 *
 * @requirements 16.4 - S3 `contract-data/` 객체 접두사로 데이터 격리
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { ContractType } from '../interfaces/index.js';
import type { RecognizedClause } from '../interfaces/document-recognizer.js';

/** 계약서 분석 전용 S3 객체 접두사 (모든 키가 이 접두사로 시작해야 한다) */
export const CONTRACT_S3_PREFIX = 'contract-data/';

/** 업로드 가능한 파일 확장자 */
export type ContractFileExtension = 'jpg' | 'jpeg' | 'png' | 'pdf';

/** config 하위 카테고리 (독소조항 룰셋/표준계약서/필수특약/체크리스트) */
export type ContractConfigCategory =
  | 'toxic-rules'
  | 'standard-forms'
  | 'required-clauses'
  | 'checklists';

/** MIME 타입 → 파일 확장자 매핑 */
const MIME_TO_EXTENSION: Record<string, ContractFileExtension> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * 인식 텍스트 저장 페이로드
 *
 * `recognized/{documentId}/text.json`에 저장되는 인식 결과 + 조항 분할 데이터.
 */
export interface RecognizedTextPayload {
  /** 문서 식별자 */
  documentId: string;
  /** 인식된 전체 텍스트 원문 */
  fullText: string;
  /** 분할된 조항 목록 */
  clauses: RecognizedClause[];
  /** 인식 상태 */
  recognitionStatus: 'success' | 'low_quality' | 'failed';
  /** 저장 일시 (ISO 8601) */
  savedAt: string;
}

/**
 * 계약서 S3 저장소 설정 인터페이스
 */
export interface ContractS3StoreConfig {
  /** S3 버킷 이름 */
  bucketName: string;
  /** AWS 리전 */
  region: string;
}

/** 기본 설정 */
const DEFAULT_CONFIG: ContractS3StoreConfig = {
  bucketName: `real-estate-data-${process.env['ENVIRONMENT'] || 'dev'}`,
  region: process.env['AWS_REGION'] || 'ap-northeast-2',
};

/**
 * 계약서 S3 키 빌더
 *
 * 모든 객체 키가 `contract-data/` 접두사로 시작하도록 강제하며,
 * design.md의 S3 버킷 구조를 정확히 반영한다.
 */
export class ContractS3KeyBuilder {
  /**
   * 업로드 계약서 원본 키
   *
   * @param documentId - 문서 식별자
   * @param extension - 파일 확장자
   * @returns `contract-data/uploads/{documentId}/original.{ext}`
   */
  static originalUpload(documentId: string, extension: ContractFileExtension): string {
    return `${CONTRACT_S3_PREFIX}uploads/${documentId}/original.${extension}`;
  }

  /**
   * 등기부등본 원본 키
   *
   * @param documentId - 문서 식별자
   * @param extension - 파일 확장자
   * @returns `contract-data/uploads/{documentId}/registry.{ext}`
   */
  static registryUpload(documentId: string, extension: ContractFileExtension): string {
    return `${CONTRACT_S3_PREFIX}uploads/${documentId}/registry.${extension}`;
  }

  /**
   * 인식 텍스트 키
   *
   * @param documentId - 문서 식별자
   * @returns `contract-data/recognized/{documentId}/text.json`
   */
  static recognizedText(documentId: string): string {
    return `${CONTRACT_S3_PREFIX}recognized/${documentId}/text.json`;
  }

  /**
   * config 데이터 키 (룰셋/표준계약서/필수특약/체크리스트)
   *
   * @param category - config 하위 카테고리
   * @param contractType - 계약 유형
   * @returns `contract-data/config/{category}/{contractType}.json`
   */
  static config(category: ContractConfigCategory, contractType: ContractType): string {
    return `${CONTRACT_S3_PREFIX}config/${category}/${contractType}.json`;
  }

  /**
   * 처리(임베딩) 데이터 키
   *
   * @param contractType - 계약 유형
   * @returns `contract-data/processed/{contractType}/embeddings.json`
   */
  static processedEmbeddings(contractType: ContractType): string {
    return `${CONTRACT_S3_PREFIX}processed/${contractType}/embeddings.json`;
  }

  /**
   * 키가 계약서 분석 전용 접두사로 시작하는지 강제 검증한다.
   *
   * @param key - 검증할 S3 객체 키
   * @returns 접두사를 만족하는 키
   * @throws 접두사를 만족하지 않으면 오류
   */
  static enforcePrefix(key: string): string {
    if (!key.startsWith(CONTRACT_S3_PREFIX)) {
      throw new Error(
        `계약서 분석 S3 키는 반드시 '${CONTRACT_S3_PREFIX}' 접두사로 시작해야 합니다: ${key}`,
      );
    }
    return key;
  }
}

/**
 * 계약서 S3 오브젝트 저장소 서비스
 *
 * 계약서·등기부등본 원본 파일을 저장/조회하고, 문서 인식 텍스트(조항 분할 포함)를
 * JSON으로 저장/조회한다. 모든 객체는 `contract-data/` 접두사 하위에 격리 저장된다.
 * 기존 저장소 모듈(law-storage 등)과 동일한 SDK/초기화 패턴을 따른다.
 */
export class ContractS3Store {
  private s3Client: S3Client;
  private config: ContractS3StoreConfig;

  constructor(config: Partial<ContractS3StoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.s3Client = new S3Client({ region: this.config.region });
  }

  /**
   * MIME 타입을 파일 확장자로 변환한다.
   *
   * @param mimeType - 파일 MIME 타입 (image/jpeg | image/png | application/pdf)
   * @returns 대응 확장자
   * @throws 지원하지 않는 MIME 타입이면 오류
   */
  private resolveExtension(mimeType: string): ContractFileExtension {
    const extension = MIME_TO_EXTENSION[mimeType];
    if (!extension) {
      throw new Error(`지원하지 않는 파일 형식입니다: ${mimeType}`);
    }
    return extension;
  }

  /**
   * 계약서 원본 파일을 S3에 저장한다.
   *
   * @param documentId - 문서 식별자
   * @param body - 파일 바이너리 데이터
   * @param mimeType - 파일 MIME 타입
   * @returns 저장된 객체의 S3 키
   */
  async saveContractOriginal(
    documentId: string,
    body: Uint8Array | Buffer,
    mimeType: string,
  ): Promise<string> {
    const extension = this.resolveExtension(mimeType);
    const key = ContractS3KeyBuilder.enforcePrefix(
      ContractS3KeyBuilder.originalUpload(documentId, extension),
    );
    await this.putObject(key, body, mimeType);
    return key;
  }

  /**
   * 등기부등본 원본 파일을 S3에 저장한다.
   *
   * @param documentId - 문서 식별자
   * @param body - 파일 바이너리 데이터
   * @param mimeType - 파일 MIME 타입
   * @returns 저장된 객체의 S3 키
   */
  async saveRegistryOriginal(
    documentId: string,
    body: Uint8Array | Buffer,
    mimeType: string,
  ): Promise<string> {
    const extension = this.resolveExtension(mimeType);
    const key = ContractS3KeyBuilder.enforcePrefix(
      ContractS3KeyBuilder.registryUpload(documentId, extension),
    );
    await this.putObject(key, body, mimeType);
    return key;
  }

  /**
   * 인식 텍스트(조항 분할 포함)를 S3에 JSON으로 저장한다.
   *
   * @param documentId - 문서 식별자
   * @param payload - 인식 결과 페이로드 (savedAt 생략 시 현재 시각 부여)
   * @returns 저장된 객체의 S3 키
   */
  async saveRecognizedText(
    documentId: string,
    payload: Omit<RecognizedTextPayload, 'documentId' | 'savedAt'> &
      Partial<Pick<RecognizedTextPayload, 'savedAt'>>,
  ): Promise<string> {
    const key = ContractS3KeyBuilder.enforcePrefix(
      ContractS3KeyBuilder.recognizedText(documentId),
    );
    const fullPayload: RecognizedTextPayload = {
      documentId,
      fullText: payload.fullText,
      clauses: payload.clauses,
      recognitionStatus: payload.recognitionStatus,
      savedAt: payload.savedAt ?? new Date().toISOString(),
    };
    await this.putObject(key, JSON.stringify(fullPayload, null, 2), 'application/json');
    return key;
  }

  /**
   * 원본 파일(계약서/등기부등본)을 S3에서 조회한다.
   *
   * @param key - 조회할 객체의 S3 키 (`contract-data/` 접두사 필수)
   * @returns 파일 바이너리 데이터
   */
  async getOriginal(key: string): Promise<Uint8Array> {
    ContractS3KeyBuilder.enforcePrefix(key);
    const response = await this.getObject(key);
    return this.readBinaryBody(response);
  }

  /**
   * 인식 텍스트(조항 분할 포함)를 S3에서 조회한다.
   *
   * @param documentId - 문서 식별자
   * @returns 인식 결과 페이로드 또는 null (미존재 시)
   */
  async getRecognizedText(documentId: string): Promise<RecognizedTextPayload | null> {
    const key = ContractS3KeyBuilder.enforcePrefix(
      ContractS3KeyBuilder.recognizedText(documentId),
    );
    try {
      const response = await this.getObject(key);
      const text = await this.readTextBody(response);
      return JSON.parse(text) as RecognizedTextPayload;
    } catch (error) {
      // 객체 미존재 시 null 반환, 그 외 오류는 전파
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * S3 PutObject 공통 래퍼
   *
   * @param key - 저장 키
   * @param body - 본문
   * @param contentType - Content-Type 헤더
   */
  private async putObject(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await this.s3Client.send(command);
  }

  /**
   * S3 GetObject 공통 래퍼
   *
   * @param key - 조회 키
   * @returns GetObject 응답
   */
  private async getObject(key: string): Promise<GetObjectCommandOutput> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    });
    return this.s3Client.send(command);
  }

  /**
   * GetObject 응답 본문을 텍스트로 읽어들인다.
   *
   * @param response - GetObject 응답
   * @returns 문자열 본문
   */
  private async readTextBody(response: GetObjectCommandOutput): Promise<string> {
    const body = response.Body;
    if (!body) {
      return '';
    }
    // AWS SDK v3 런타임에서 제공하는 transformToString 사용
    return (body as unknown as { transformToString(): Promise<string> }).transformToString();
  }

  /**
   * GetObject 응답 본문을 바이너리로 읽어들인다.
   *
   * @param response - GetObject 응답
   * @returns 바이너리 본문
   */
  private async readBinaryBody(response: GetObjectCommandOutput): Promise<Uint8Array> {
    const body = response.Body;
    if (!body) {
      return new Uint8Array(0);
    }
    return (body as unknown as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  }

  /**
   * S3 오류가 "객체 미존재" 오류인지 판별한다.
   *
   * @param error - 오류 객체
   * @returns 미존재 오류 여부
   */
  private isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const name = (error as { name?: string }).name;
    const code = (error as { Code?: string }).Code;
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    return name === 'NoSuchKey' || code === 'NoSuchKey' || statusCode === 404;
  }
}
