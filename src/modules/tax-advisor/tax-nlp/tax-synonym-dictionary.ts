/**
 * 세무 동의어 사전 모듈
 *
 * 세무 전문 용어의 동의어를 관리하여 검색 쿼리를 확장한다.
 * JSON 파일에서 동의어 데이터를 로드하며,
 * DynamoDB SynonymDictionary 테이블(TAX# 접두사)에서도 로드 가능하다.
 *
 * @module TaxSynonymDictionary
 * @requirements 11.3, 11.6
 */

import type { TaxType } from '../interfaces/index.js';

/**
 * 동의어 엔트리 인터페이스
 */
export interface TaxSynonymEntry {
  /** 세무 전문 용어 */
  term: string;
  /** 동의어 목록 */
  synonyms: string[];
  /** 관련 세목 */
  taxType: TaxType;
}

/**
 * 세무 동의어 사전 클래스
 *
 * 세무 전문 용어와 그에 대응하는 동의어를 관리한다.
 * 사용자 질문에 포함된 세무 용어를 감지하고,
 * 해당 용어의 동의어로 검색 쿼리를 확장한다.
 */
export class TaxSynonymDictionary {
  private entries: TaxSynonymEntry[] = [];
  /** term → entry 역인덱스 */
  private termIndex: Map<string, TaxSynonymEntry> = new Map();
  /** synonym → entry 역인덱스 (동의어로도 원본 찾기 가능) */
  private synonymIndex: Map<string, TaxSynonymEntry> = new Map();

  /**
   * JSON 데이터에서 동의어 사전을 로드한다.
   *
   * @param data - TaxSynonymEntry 배열 형태의 동의어 데이터
   */
  loadFromJson(data: TaxSynonymEntry[]): void {
    this.entries = data;
    this.buildIndices();
  }

  /**
   * 검색 쿼리를 동의어로 확장한다.
   *
   * 질문 텍스트에 세무 전문 용어 또는 그 동의어가 포함되어 있으면,
   * 해당 엔트리의 모든 동의어와 원본 용어를 확장 결과에 포함시킨다.
   *
   * @param query - 원본 질문 텍스트
   * @returns 확장된 용어 배열 (원본 포함)
   *
   * @requirements 11.3, 11.6
   */
  expandQuery(query: string): string[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const expandedTerms: Set<string> = new Set();

    // 1. 정규 용어(term)가 질문에 포함되어 있는지 확인
    for (const entry of this.entries) {
      if (query.includes(entry.term)) {
        // 원본 용어 추가
        expandedTerms.add(entry.term);
        // 모든 동의어 추가
        for (const synonym of entry.synonyms) {
          expandedTerms.add(synonym);
        }
      }
    }

    // 2. 동의어가 질문에 포함되어 있는지 확인
    for (const [synonym, entry] of this.synonymIndex) {
      if (query.includes(synonym)) {
        // 원본 용어 추가
        expandedTerms.add(entry.term);
        // 같은 엔트리의 모든 동의어 추가
        for (const syn of entry.synonyms) {
          expandedTerms.add(syn);
        }
      }
    }

    return Array.from(expandedTerms);
  }

  /**
   * 특정 세목과 관련된 동의어만 확장한다.
   *
   * @param query - 원본 질문 텍스트
   * @param taxType - 필터링할 세목
   * @returns 해당 세목에 관련된 확장 용어 배열
   */
  expandQueryByTaxType(query: string, taxType: TaxType): string[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const expandedTerms: Set<string> = new Set();

    for (const entry of this.entries) {
      if (entry.taxType !== taxType) continue;

      if (query.includes(entry.term)) {
        expandedTerms.add(entry.term);
        for (const synonym of entry.synonyms) {
          expandedTerms.add(synonym);
        }
      }

      for (const synonym of entry.synonyms) {
        if (query.includes(synonym)) {
          expandedTerms.add(entry.term);
          for (const syn of entry.synonyms) {
            expandedTerms.add(syn);
          }
          break;
        }
      }
    }

    return Array.from(expandedTerms);
  }

  /**
   * DynamoDB SynonymDictionary 테이블에서 세무 동의어를 로드한다.
   *
   * TAX#SYNONYM# 접두사를 가진 항목만 조회하여 동의어 사전을 구성한다.
   * DynamoDB 클라이언트를 주입받아 사용한다.
   *
   * @param tableName - DynamoDB 테이블 이름
   * @param dynamoClient - DynamoDB DocumentClient 인스턴스 (선택)
   */
  async loadFromDynamoDB(
    tableName: string,
    dynamoClient?: { query: (params: unknown) => Promise<{ Items?: Record<string, unknown>[] }> },
  ): Promise<void> {
    if (!dynamoClient) {
      // DynamoDB 클라이언트가 없으면 스킵 (로컬 환경 대비)
      return;
    }

    const params = {
      TableName: tableName,
      KeyConditionExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': 'TAX#SYNONYM#',
      },
    };

    const result = await dynamoClient.query(params);
    if (result.Items && result.Items.length > 0) {
      const entries: TaxSynonymEntry[] = result.Items.map((item) => ({
        term: String(item['term'] ?? ''),
        synonyms: (item['synonyms'] as string[]) ?? [],
        taxType: String(item['taxType'] ?? 'acquisition') as TaxType,
      }));
      this.loadFromJson(entries);
    }
  }

  /**
   * 특정 용어의 동의어를 반환한다.
   *
   * 정규 용어 또는 동의어를 입력하면 해당 엔트리의 모든 동의어를 반환한다.
   * 원본 용어 자체는 결과에 포함하지 않는다.
   *
   * @param term - 조회할 용어 (정규 용어 또는 동의어)
   * @returns 동의어 배열 (없으면 빈 배열)
   */
  getSynonyms(term: string): string[] {
    const entry = this.termIndex.get(term);
    if (entry) {
      return [...entry.synonyms];
    }

    const synonymEntry = this.synonymIndex.get(term);
    if (synonymEntry) {
      // 원본 용어 + 다른 동의어 (자기 자신 제외)
      const result = [synonymEntry.term, ...synonymEntry.synonyms.filter((s) => s !== term)];
      return result;
    }

    return [];
  }

  /**
   * 용어를 기반으로 동의어 엔트리를 조회한다.
   *
   * @param term - 조회할 용어 (정규 용어 또는 동의어)
   * @returns 매칭된 엔트리 또는 undefined
   */
  findEntry(term: string): TaxSynonymEntry | undefined {
    return this.termIndex.get(term) ?? this.synonymIndex.get(term);
  }

  /**
   * 현재 로드된 엔트리 수를 반환한다.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * 모든 엔트리를 반환한다.
   */
  getAllEntries(): TaxSynonymEntry[] {
    return [...this.entries];
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * 역인덱스를 구축한다.
   */
  private buildIndices(): void {
    this.termIndex.clear();
    this.synonymIndex.clear();

    for (const entry of this.entries) {
      this.termIndex.set(entry.term, entry);
      for (const synonym of entry.synonyms) {
        this.synonymIndex.set(synonym, entry);
      }
    }
  }
}
