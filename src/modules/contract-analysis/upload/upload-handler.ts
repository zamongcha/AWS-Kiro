/**
 * @fileoverview 계약서 업로드 처리기
 * @description 업로드 검증을 수행하고, 통과 시 원본 파일을 S3에 저장한 뒤
 * 중복되지 않는 고유 문서 식별자(documentId)를 발급하고 DynamoDB에
 * 처리 상태(uploaded) 문서 레코드를 저장한다. 검증 실패 시 파일을 저장하지 않고
 * 표준 오류 응답과 함께 처리를 중단한다.
 *
 * @requirements 1.1 - 업로드 파일 크기 제한 검증 (UploadValidator 위임)
 * @requirements 1.2 - 원본 파일 S3 저장 및 중복되지 않는 고유 문서 식별자 발급
 * @requirements 1.6 - 지원 형식 외 파일 거부 및 파일 미저장 상태로 처리 중단
 * @requirements 1.7 - 허용 크기 범위 밖 파일 거부 및 파일 미저장 상태로 처리 중단
 *
 * Property 1(문서 식별자 유일성) 대비: documentId는 crypto.randomUUID()로 발급한다.
 */

import { randomUUID } from 'crypto';
import type { ErrorResponse } from '../../../common/interfaces/service-module.js';
import type { ContractDocumentRecord } from '../interfaces/records.js';
import { ContractS3Store } from '../storage/s3-store.js';
import { ContractDynamoStore } from '../storage/dynamo-store.js';
import { UploadValidator } from './upload-validator.js';

/**
 * 업로드 요청 입력
 */
export interface UploadRequest {
  /** 파일 바이너리 데이터 */
  body: Uint8Array | Buffer;
  /** 파일 MIME 타입 (image/jpeg | image/png | application/pdf) */
  mimeType: string;
  /** 파일 크기 (바이트) */
  sizeBytes: number;
}

/**
 * 업로드 처리 결과
 *
 * 검증/저장 성공 시 발급된 documentId와 S3 키, 저장된 문서 레코드를 반환하고,
 * 실패 시 파일을 저장하지 않은 상태(fileStored=false)로 표준 오류 응답을 반환한다.
 */
export type UploadResult =
  | {
      success: true;
      documentId: string;
      s3Key: string;
      record: ContractDocumentRecord;
    }
  | {
      success: false;
      /** 파일이 저장되었는지 여부 (검증 실패 시 항상 false) */
      fileStored: boolean;
      error: ErrorResponse;
    };

/**
 * UploadHandler 의존성 주입 설정
 */
export interface UploadHandlerDeps {
  /** 업로드 검증기 */
  validator?: UploadValidator;
  /** S3 저장소 */
  s3Store?: ContractS3Store;
  /** DynamoDB 저장소 */
  dynamoStore?: ContractDynamoStore;
  /** 문서 식별자 생성기 (테스트 주입용, 기본값: crypto.randomUUID) */
  idGenerator?: () => string;
}

/**
 * 계약서 업로드 처리기
 *
 * 검증 → S3 저장 → documentId 발급 → DynamoDB 문서 레코드 저장(uploaded 상태) 순으로
 * 처리하며, 검증 실패 시 어떤 저장도 수행하지 않는다.
 */
export class UploadHandler {
  private readonly validator: UploadValidator;
  private readonly s3Store: ContractS3Store;
  private readonly dynamoStore: ContractDynamoStore;
  private readonly idGenerator: () => string;

  constructor(deps: UploadHandlerDeps = {}) {
    this.validator = deps.validator ?? new UploadValidator();
    this.s3Store = deps.s3Store ?? new ContractS3Store();
    this.dynamoStore = deps.dynamoStore ?? new ContractDynamoStore();
    this.idGenerator = deps.idGenerator ?? (() => randomUUID());
  }

  /**
   * 계약서 파일 업로드를 처리한다.
   *
   * 1. MIME 타입/크기 검증 → 실패 시 파일 미저장 상태로 오류 반환
   * 2. 검증 통과 시 원본을 S3에 저장
   * 3. 중복되지 않는 documentId 발급 후 DynamoDB에 uploaded 상태 레코드 저장
   *
   * @param request - 업로드 요청 (본문, MIME 타입, 크기)
   * @returns 업로드 처리 결과
   */
  async handle(request: UploadRequest): Promise<UploadResult> {
    // 1. 검증 (실패 시 파일을 저장하지 않고 즉시 중단)
    const validation = this.validator.validate({
      mimeType: request.mimeType,
      sizeBytes: request.sizeBytes,
    });

    if (validation.valid === false) {
      return {
        success: false,
        fileStored: false,
        error: validation.error,
      };
    }

    // 2. 고유 문서 식별자 발급
    const documentId = this.idGenerator();

    // 3. 원본 파일 S3 저장
    const s3Key = await this.s3Store.saveContractOriginal(
      documentId,
      request.body,
      request.mimeType,
    );

    // 4. DynamoDB 문서 레코드 저장 (처리 상태: uploaded)
    const record = await this.dynamoStore.saveDocument({
      documentId,
      s3Key,
      status: 'uploaded',
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      documentId,
      s3Key,
      record,
    };
  }
}
