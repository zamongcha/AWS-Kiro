/**
 * @fileoverview 세율 테이블 로더 모듈
 * @description DynamoDB에서 세율 테이블을 로드하고
 * effectiveDate 기준 유효한 세율 테이블을 선택한다.
 *
 * @requirements 5.1 - 세율 테이블 기반 세액 산출
 * @requirements 5.2 - effectiveDate 기준 유효 테이블 선택
 */

import type { TaxType, TaxBracket, RateTableData } from '../interfaces/index.js';
import type { TaxRateRecord } from '../interfaces/index.js';
import { RateTableStorage } from '../tax-law-collector/rate-table-storage.js';

/**
 * 세율 테이블 로더 설정
 */
export interface RateTableLoaderConfig {
  /** DynamoDB 테이블 이름 */
  tableName?: string;
  /** S3 버킷 이름 */
  bucketName?: string;
  /** AWS 리전 */
  region?: string;
}

/**
 * 세율 테이블 로드 결과
 */
export interface LoadedRateTable {
  /** 세율 구간 배열 */
  brackets: TaxBracket[];
  /** 적용 기준일 */
  effectiveDate: string;
  /** 근거 세법 조항 */
  sourceArticle: string;
  /** 버전 */
  version: number;
}

/**
 * 세율 테이블 로더
 *
 * RateTableStorage를 통해 DynamoDB에서 세율 테이블을 로드한다.
 * effectiveDate 기준 유효한 세율 테이블을 선택하거나
 * 최신 세율 테이블을 반환한다.
 */
export class RateTableLoader {
  private storage: RateTableStorage;

  constructor(config?: RateTableLoaderConfig) {
    this.storage = new RateTableStorage(config);
  }

  /**
   * 세율 테이블을 로드한다.
   *
   * referenceDate가 지정되면 해당 날짜 기준 유효 테이블을,
   * 지정되지 않으면 최신 테이블을 로드한다.
   *
   * @param taxType - 세목 유형
   * @param referenceDate - 기준 날짜 (ISO 8601, 선택)
   * @returns 세율 테이블 또는 null
   */
  async loadRateTable(taxType: TaxType, referenceDate?: string): Promise<LoadedRateTable | null> {
    let record: TaxRateRecord | null;

    if (referenceDate) {
      record = await this.storage.getEffective(taxType, referenceDate);
    } else {
      record = await this.storage.getLatest(taxType);
    }

    if (!record) {
      return null;
    }

    return {
      brackets: record.brackets,
      effectiveDate: record.SK, // SK가 effectiveDate
      sourceArticle: record.sourceArticle,
      version: record.version,
    };
  }

  /**
   * 세율 테이블의 존재 여부를 확인한다.
   *
   * @param taxType - 세목 유형
   * @returns 세율 테이블 존재 여부
   */
  async hasRateTable(taxType: TaxType): Promise<boolean> {
    const record = await this.storage.getLatest(taxType);
    return record !== null;
  }
}
