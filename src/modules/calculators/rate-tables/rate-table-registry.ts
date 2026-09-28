/**
 * 기준표 레지스트리 구현 (RateTableRegistryImpl)
 *
 * 계산 로직과 분리된 상수 기준표(취득세·양도세·중개수수료)를 기준연도별 버전으로
 * 관리하고 조회하는 레지스트리이다. 시드 JSON 파일
 * (`data/{acquisition,transfer-tax,brokerage}/{연도}.json`)을 로드하여 기준연도별
 * 기준표를 제공하며, 요청 기준연도의 기준표가 존재하지 않으면 사용 가능한 기준연도
 * 목록을 안내할 수 있도록 조회 API를 노출한다.
 *
 * 시드 JSON은 { baseYear, version, metadata, data, constraints } 구조이며,
 * 각 계산기 유형별 데이터 스키마(AcquisitionRateData/TransferRateData/
 * BrokerageRateData)를 그대로 담는다. 세법·요율 개정 시 새 기준연도 JSON을
 * 추가하는 것만으로 계산 로직 변경 없이 기준표를 확장할 수 있다.
 *
 * @requirements 6.1 - 기준연도·버전 메타데이터를 포함한 상수 기준표 관리
 * @requirements 6.2 - 지정 기준연도 기준표 버전 제공
 * @requirements 6.3 - 세법 개정 시 로직 변경 없이 새 기준연도 기준표 추가
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  RateTable,
  RateTableRegistry,
  AcquisitionRateData,
  TransferRateData,
  BrokerageRateData,
} from '../interfaces/rate-tables.js';
import type { RateTableConstraints } from '../interfaces/input-validator.js';
import type { CalculatorType } from '../interfaces/types.js';

/**
 * 기준표 데이터 디렉토리 상대 경로 (본 파일 기준)
 */
const DATA_DIR = resolve(__dirname, 'data');

/**
 * 지원하는 기준연도 목록.
 * 새 기준연도 JSON을 추가할 때 이 목록에 연도를 추가한다.
 */
const SUPPORTED_BASE_YEARS: readonly number[] = [2024, 2025, 2026];

/**
 * 계산기 유형 → 데이터 디렉토리명 매핑.
 * `transfer_tax` 유형은 디렉토리명이 하이픈 표기(`transfer-tax`)이므로 별도 매핑한다.
 */
const CALCULATOR_DIR: Record<CalculatorType, string> = {
  acquisition: 'acquisition',
  transfer_tax: 'transfer-tax',
  brokerage: 'brokerage',
};

/**
 * 입력 검증기가 요구하는 기준표 제약의 기본 상한값.
 *
 * 시드 JSON의 `constraints`는 계산기 유형별로 필요한 필드만 포함할 수 있으므로
 * (예: 취득세는 maxArea, 양도세는 maxHoldingPeriod), 누락 필드는 안전한 기본값으로
 * 보정하여 `RateTableConstraints`(maxAmount/maxArea/maxHoldingPeriod)를 완성한다.
 */
const DEFAULT_CONSTRAINTS: RateTableConstraints = {
  maxAmount: 100_000_000_000,
  maxArea: 10_000,
  maxHoldingPeriod: 600,
};

/**
 * 시드 JSON 파일 원본 구조.
 */
interface RateTableSeed {
  baseYear: number;
  version: string;
  metadata?: {
    description?: string;
    effectiveFrom?: string;
  };
  data: AcquisitionRateData | TransferRateData | BrokerageRateData;
  constraints?: Partial<RateTableConstraints>;
}

/**
 * 기준표 레지스트리 구현 클래스.
 *
 * 생성 시 지원 기준연도의 시드 JSON을 모두 로드하여 메모리에 캐시하고,
 * 계산기 유형·기준연도 조합으로 기준표를 결정론적으로 조회한다. 파일 로드에
 * 실패한 항목은 캐시에서 제외되며 조회 시 미존재로 처리한다.
 */
export class RateTableRegistryImpl implements RateTableRegistry {
  /** `${type}:${baseYear}` 키로 캐시된 기준표 */
  private readonly cache = new Map<string, RateTable>();

  constructor() {
    this.loadAll();
  }

  /**
   * 지원 기준연도의 모든 계산기 유형 시드 JSON을 로드하여 캐시에 적재한다.
   * 개별 파일 로드 실패는 무시(캐시 미적재)하여 결정론적 조회를 보장한다.
   */
  private loadAll(): void {
    const types: CalculatorType[] = ['acquisition', 'transfer_tax', 'brokerage'];

    for (const type of types) {
      for (const baseYear of SUPPORTED_BASE_YEARS) {
        const rateTable = this.loadSeed(type, baseYear);
        if (rateTable) {
          this.cache.set(this.cacheKey(type, baseYear), rateTable);
        }
      }
    }
  }

  /**
   * 단일 시드 JSON을 로드하여 RateTable로 변환한다.
   *
   * @param type - 계산기 유형
   * @param baseYear - 기준연도
   * @returns 로드된 기준표, 실패 시 null
   */
  private loadSeed(type: CalculatorType, baseYear: number): RateTable | null {
    try {
      const filePath = resolve(DATA_DIR, CALCULATOR_DIR[type], `${baseYear}.json`);
      const raw = readFileSync(filePath, 'utf-8');
      const seed = JSON.parse(raw) as RateTableSeed;

      return {
        calculatorType: type,
        baseYear: seed.baseYear,
        version: seed.version,
        data: seed.data,
        constraints: this.normalizeConstraints(seed.constraints),
      };
    } catch {
      return null;
    }
  }

  /**
   * 시드 JSON의 부분 제약을 기본값으로 보정하여 완전한 RateTableConstraints를 만든다.
   *
   * @param partial - 시드 JSON의 부분 제약 (일부 필드 누락 가능)
   * @returns maxAmount/maxArea/maxHoldingPeriod가 모두 채워진 제약
   */
  private normalizeConstraints(
    partial?: Partial<RateTableConstraints>,
  ): RateTableConstraints {
    return {
      maxAmount: partial?.maxAmount ?? DEFAULT_CONSTRAINTS.maxAmount,
      maxArea: partial?.maxArea ?? DEFAULT_CONSTRAINTS.maxArea,
      maxHoldingPeriod:
        partial?.maxHoldingPeriod ?? DEFAULT_CONSTRAINTS.maxHoldingPeriod,
    };
  }

  /**
   * 캐시 키를 생성한다.
   */
  private cacheKey(type: CalculatorType, baseYear: number): string {
    return `${type}:${baseYear}`;
  }

  /**
   * 지정 계산기 유형·기준연도의 기준표를 조회한다.
   *
   * @param type - 계산기 유형
   * @param baseYear - 요청 기준연도
   * @returns 해당 기준연도 기준표, 미존재 시 null
   */
  getRateTable(type: CalculatorType, baseYear: number): RateTable | null {
    return this.cache.get(this.cacheKey(type, baseYear)) ?? null;
  }

  /**
   * 지정 계산기 유형에 대해 사용 가능한 기준연도 목록을 오름차순으로 반환한다.
   *
   * @param type - 계산기 유형
   * @returns 사용 가능 기준연도 목록 (없으면 빈 배열)
   */
  getAvailableBaseYears(type: CalculatorType): number[] {
    const years: number[] = [];
    for (const baseYear of SUPPORTED_BASE_YEARS) {
      if (this.cache.has(this.cacheKey(type, baseYear))) {
        years.push(baseYear);
      }
    }
    return years.sort((a, b) => a - b);
  }
}
