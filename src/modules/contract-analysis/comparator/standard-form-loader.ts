/**
 * 표준계약서 로더 (StandardFormLoader)
 *
 * 확정된 계약 유형에 대응하는 표준계약서 조항을 표준계약서_저장소
 * (OpenSearch `contract-standard-forms` 인덱스)에서 5초 이내에 로드한다.
 * S3 config 저장소(`contract-data/config/standard-forms/{type}.json`)를
 * 대안 소스로 사용할 수 있다.
 *
 * 주요 규칙(요구사항 8.1, 8.5, 8.6):
 *   - 로드는 5초 이내에 완료되어야 하며, 초과 시 타임아웃 오류로 처리한다.
 *   - 확정 계약 유형에 대응하는 표준양식이 존재하지 않으면(조항 0건)
 *     `exists=false`로 비교 생략 안내를 반환한다.
 *   - 로드가 실패하면 오류를 반환하되 업로드된 계약서 데이터는 보존한다
 *     (본 로더는 업로드 데이터를 변경하지 않는다).
 *
 * @module StandardFormLoader
 * @requirements 8.1, 8.5, 8.6
 */

import type { ContractType } from '../interfaces/index.js';
import type {
  ContractOpenSearchStore,
  StandardFormDocument,
} from '../storage/opensearch-store.js';

/** 표준계약서 로드 기본 타임아웃 (ms) - 요구사항 8.1: 5초 이내 */
export const STANDARD_FORM_LOAD_TIMEOUT_MS = 5000;

/**
 * 표준계약서 로드 결과
 */
export interface StandardFormLoadResult {
  /** 로드 성공 여부 */
  success: boolean;
  /** 표준양식 존재 여부 (조항 1건 이상이면 true) */
  exists: boolean;
  /** 로드된 표준계약서 조항 목록 (clause_order 오름차순) */
  clauses: StandardFormDocument[];
  /** 표준양식 버전 (메타데이터에서 추출) */
  version?: number;
  /** 사용자 안내 메시지 (없거나 실패 시) */
  message?: string;
  /** 오류 발생 시 원인 정보 */
  errorReason?: string;
}

/**
 * 표준계약서 조항 소스 어댑터
 *
 * OpenSearch 저장소를 기본 소스로 사용하되, 테스트나 S3 config 대안
 * 소스로 교체할 수 있도록 최소 인터페이스를 정의한다.
 */
export interface StandardFormSource {
  /**
   * 계약 유형별 표준계약서 조항을 조회한다.
   *
   * @param contractType - 계약 유형
   * @returns 표준계약서 조항 목록
   */
  getStandardForm(contractType: ContractType): Promise<StandardFormDocument[]>;
}

/**
 * 표준계약서 로더 설정
 */
export interface StandardFormLoaderConfig {
  /** 표준계약서 조항 소스 (OpenSearch 저장소 등) */
  source: StandardFormSource;
  /** 로드 타임아웃 (ms, 기본 5000) */
  timeoutMs?: number;
}

/**
 * 표준계약서 로더
 *
 * @requirements 8.1, 8.5, 8.6
 */
export class StandardFormLoader {
  private readonly source: StandardFormSource;
  private readonly timeoutMs: number;

  constructor(config: StandardFormLoaderConfig) {
    this.source = config.source;
    this.timeoutMs = config.timeoutMs ?? STANDARD_FORM_LOAD_TIMEOUT_MS;
  }

  /**
   * `ContractOpenSearchStore`를 소스로 사용하는 로더를 생성한다.
   *
   * @param store - 계약서 OpenSearch 저장소
   * @param timeoutMs - 로드 타임아웃 (ms)
   * @returns 표준계약서 로더 인스턴스
   */
  static fromOpenSearch(
    store: ContractOpenSearchStore,
    timeoutMs: number = STANDARD_FORM_LOAD_TIMEOUT_MS,
  ): StandardFormLoader {
    return new StandardFormLoader({
      source: {
        getStandardForm: (contractType) => store.getStandardForm(contractType),
      },
      timeoutMs,
    });
  }

  /**
   * 계약 유형에 대응하는 표준계약서를 5초 이내에 로드한다.
   *
   * 로드 결과가 0건이면 표준양식이 없는 것으로 판정하여 비교 생략을
   * 안내하고(exists=false), 타임아웃 또는 조회 오류 시 실패 결과를
   * 반환한다. 어떤 경우에도 업로드된 계약서 데이터는 변경하지 않는다.
   *
   * @param contractType - 확정된 계약 유형
   * @returns 표준계약서 로드 결과
   *
   * @requirements 8.1, 8.5, 8.6
   */
  async load(contractType: ContractType): Promise<StandardFormLoadResult> {
    try {
      const clauses = await this.withTimeout(
        this.source.getStandardForm(contractType),
        this.timeoutMs,
      );

      // 표준양식이 존재하지 않는 경우 (조항 0건): 비교 생략 안내
      if (!clauses || clauses.length === 0) {
        return {
          success: true,
          exists: false,
          clauses: [],
          message:
            '해당 계약 유형에 대응하는 표준계약서 양식이 없어 비교를 생략했어요.',
        };
      }

      return {
        success: true,
        exists: true,
        clauses,
        version: this.resolveVersion(clauses),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        exists: false,
        clauses: [],
        message:
          '표준계약서를 불러오지 못해 비교를 수행할 수 없어요. 업로드하신 계약서 데이터는 그대로 보존됩니다.',
        errorReason: reason,
      };
    }
  }

  /**
   * 표준계약서 조항 목록에서 대표 버전 번호를 추출한다.
   *
   * 조항별 메타데이터의 최대 버전 번호를 사용한다.
   *
   * @param clauses - 표준계약서 조항 목록
   * @returns 버전 번호 (없으면 undefined)
   */
  private resolveVersion(clauses: StandardFormDocument[]): number | undefined {
    let version: number | undefined;
    for (const clause of clauses) {
      const v = clause.metadata?.version;
      if (typeof v === 'number' && (version === undefined || v > version)) {
        version = v;
      }
    }
    return version;
  }

  /**
   * 주어진 Promise를 타임아웃과 함께 대기한다.
   *
   * 타임아웃이 먼저 도달하면 타임아웃 오류를 던진다.
   *
   * @param promise - 대상 Promise
   * @param timeoutMs - 타임아웃 (ms)
   * @returns Promise 결과
   * @throws 타임아웃 도달 시 오류
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `표준계약서 로드가 ${timeoutMs}ms 이내에 완료되지 않았습니다.`,
          ),
        );
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}
