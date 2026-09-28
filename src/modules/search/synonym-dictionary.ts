/**
 * 동의어 사전 모듈
 *
 * 부동산 법률 용어의 동의어를 관리하고, 검색 쿼리를 확장하여
 * 동일 개념을 다르게 표현한 질문에도 동일한 검색 결과를 제공한다.
 *
 * DynamoDB `SynonymDictionary` 테이블 또는 JSON 데이터에서 동의어 사전을 로드하고,
 * 메모리에 캐싱하여 반복 호출 시 성능을 보장한다.
 *
 * @module SynonymDictionary
 * @requirements 9.3
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * 동의어 항목 인터페이스
 */
export interface SynonymEntry {
  /** 대표 용어 */
  term: string;
  /** 동의어 목록 */
  synonyms: string[];
}

/**
 * 동의어 사전 클래스
 *
 * 부동산 법률 용어의 동의어를 관리하며, 검색 쿼리 확장 기능을 제공한다.
 * DynamoDB에서 사전을 로드하거나, JSON 데이터로부터 초기화할 수 있다.
 * 첫 로드 이후 메모리에 캐싱하여 빠른 조회를 지원한다.
 *
 * @requirements 9.3
 */
export class SynonymDictionary {
  /**
   * 대표 용어 → 동의어 배열 매핑
   * term을 키로 하여 해당 용어의 모든 동의어를 저장한다.
   */
  private termToSynonyms: Map<string, string[]> = new Map();

  /**
   * 역방향 매핑: 동의어 → 대표 용어
   * 어떤 동의어가 주어지더라도 대표 용어를 찾을 수 있도록 한다.
   */
  private synonymToTerm: Map<string, string> = new Map();

  /** 사전이 로드되었는지 여부 */
  private loaded: boolean = false;

  /** DynamoDB Document Client (lazy 초기화) */
  private docClient: DynamoDBDocumentClient | null = null;

  /**
   * DynamoDB Document Client를 반환한다.
   * 최초 호출 시 생성되며, 이후 재사용된다.
   */
  private getDocClient(): DynamoDBDocumentClient {
    if (!this.docClient) {
      const client = new DynamoDBClient({});
      this.docClient = DynamoDBDocumentClient.from(client);
    }
    return this.docClient;
  }

  /**
   * 동의어 사전을 초기화한다.
   *
   * DynamoDB `SynonymDictionary` 테이블에서 로드를 시도하고,
   * 실패 시 초기 JSON 데이터 파일로부터 로드한다.
   * 이미 로드된 경우에는 아무 동작도 하지 않는다.
   *
   * @param tableName - DynamoDB 테이블 이름 (기본값: 'SynonymDictionary')
   */
  async initialize(tableName?: string): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      await this.loadFromDynamoDB(tableName || 'SynonymDictionary');
    } catch {
      // DynamoDB 로드 실패 시 빈 상태로 초기화 (런타임에서 JSON 파일을 별도 로드)
      this.loaded = true;
    }
  }

  /**
   * DynamoDB `SynonymDictionary` 테이블에서 동의어 사전을 로드한다.
   *
   * 테이블의 모든 항목을 스캔하여 메모리에 캐싱한다.
   * 이미 로드된 경우 기존 데이터를 덮어쓴다.
   *
   * @param tableName - DynamoDB 테이블 이름
   * @throws DynamoDB 접근 오류 시 예외를 전파한다
   */
  async loadFromDynamoDB(tableName: string): Promise<void> {
    const docClient = this.getDocClient();
    const entries: SynonymEntry[] = [];

    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const command = new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await docClient.send(command);

      if (response.Items) {
        for (const item of response.Items) {
          const term = item['term'] as string | undefined;
          const synonyms = item['synonyms'] as string[] | undefined;

          if (term && synonyms && Array.isArray(synonyms)) {
            entries.push({ term, synonyms });
          }
        }
      }

      lastEvaluatedKey = response.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);

    this.loadFromJson(entries);
  }

  /**
   * JSON 데이터로부터 동의어 사전을 로드한다.
   *
   * 테스트 또는 초기 데이터 적재 시 사용한다.
   * 기존에 로드된 데이터가 있으면 초기화 후 새로 로드한다.
   *
   * @param data - 동의어 항목 배열
   */
  loadFromJson(data: SynonymEntry[]): void {
    // 기존 데이터 초기화
    this.termToSynonyms.clear();
    this.synonymToTerm.clear();

    for (const entry of data) {
      const { term, synonyms } = entry;

      if (!term || !synonyms || synonyms.length === 0) {
        continue;
      }

      // 대표 용어에 대한 동의어 목록 등록
      this.termToSynonyms.set(term, [...synonyms]);

      // 역방향 매핑: 각 동의어 → 대표 용어
      for (const synonym of synonyms) {
        this.synonymToTerm.set(synonym, term);
      }

      // 대표 용어 자체도 역방향 매핑에 등록 (자기 자신 → 자기 자신)
      this.synonymToTerm.set(term, term);
    }

    this.loaded = true;
  }

  /**
   * 검색 쿼리를 동의어로 확장한다.
   *
   * 쿼리 문자열에 포함된 용어 중 사전에 등록된 것을 찾아,
   * 해당 용어의 모든 동의어를 포함한 확장된 쿼리 목록을 반환한다.
   *
   * 예: "임대인이 보증금을 돌려주지 않습니다"
   * → ["임대인이 보증금을 돌려주지 않습니다", "집주인", "건물주", "소유자", "대여인",
   *     "전세금", "전세보증금", "임대보증금", "계약보증금"]
   *
   * @param query - 원본 검색 쿼리
   * @returns 원본 쿼리와 확장된 동의어를 포함한 문자열 배열
   *
   * @requirements 9.3
   */
  expandQuery(query: string): string[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const result: string[] = [query];
    const addedSynonyms = new Set<string>();

    // 사전에 등록된 모든 대표 용어와 동의어를 순회하며 쿼리에 포함된 것 찾기
    // 길이가 긴 용어부터 매칭 (더 구체적인 용어 우선)
    const allTerms = Array.from(this.synonymToTerm.keys()).sort(
      (a, b) => b.length - a.length
    );

    for (const matchedTerm of allTerms) {
      if (!query.includes(matchedTerm)) {
        continue;
      }

      // 매칭된 용어의 대표 용어 찾기
      const representativeTerm = this.synonymToTerm.get(matchedTerm);
      if (!representativeTerm) {
        continue;
      }

      // 대표 용어의 동의어 목록 가져오기
      const synonyms = this.termToSynonyms.get(representativeTerm);
      if (!synonyms) {
        continue;
      }

      // 대표 용어와 모든 동의어를 결과에 추가 (중복 제거)
      const allRelated = [representativeTerm, ...synonyms];
      for (const related of allRelated) {
        // 원본 쿼리에 이미 포함된 용어나 이미 추가한 동의어는 제외
        if (related === matchedTerm || addedSynonyms.has(related)) {
          continue;
        }
        addedSynonyms.add(related);
        result.push(related);
      }
    }

    return result;
  }

  /**
   * 특정 용어의 모든 동의어를 반환한다.
   *
   * 대표 용어를 입력하면 해당 동의어 목록을 반환하고,
   * 동의어를 입력하면 해당 그룹의 모든 관련 용어(대표 용어 + 다른 동의어)를 반환한다.
   *
   * @param term - 조회할 용어 (대표 용어 또는 동의어)
   * @returns 해당 용어의 동의어 배열 (자기 자신 제외). 사전에 없으면 빈 배열.
   */
  getSynonyms(term: string): string[] {
    // 1. 대표 용어로 직접 조회
    const directSynonyms = this.termToSynonyms.get(term);
    if (directSynonyms) {
      return [...directSynonyms];
    }

    // 2. 동의어에서 대표 용어를 찾아 역조회
    const representativeTerm = this.synonymToTerm.get(term);
    if (representativeTerm) {
      const synonyms = this.termToSynonyms.get(representativeTerm);
      if (synonyms) {
        // 자기 자신을 제외하고 대표 용어 + 나머지 동의어 반환
        const result = [representativeTerm, ...synonyms].filter(
          (s) => s !== term
        );
        return result;
      }
    }

    return [];
  }

  /**
   * 새로운 동의어 그룹을 사전에 추가한다.
   *
   * 이미 등록된 용어인 경우 기존 동의어에 새 동의어를 병합한다.
   *
   * @param term - 대표 용어
   * @param synonyms - 추가할 동의어 배열
   */
  addSynonym(term: string, synonyms: string[]): void {
    if (!term || !synonyms || synonyms.length === 0) {
      return;
    }

    const existing = this.termToSynonyms.get(term);

    if (existing) {
      // 기존 동의어 그룹에 새 동의어 병합 (중복 제거)
      const merged = new Set([...existing, ...synonyms]);
      const mergedArray = Array.from(merged);
      this.termToSynonyms.set(term, mergedArray);

      // 새로 추가된 동의어에 대한 역방향 매핑 등록
      for (const synonym of synonyms) {
        this.synonymToTerm.set(synonym, term);
      }
    } else {
      // 새 동의어 그룹 등록
      this.termToSynonyms.set(term, [...synonyms]);

      // 역방향 매핑 등록
      for (const synonym of synonyms) {
        this.synonymToTerm.set(synonym, term);
      }
      this.synonymToTerm.set(term, term);
    }
  }

  /**
   * 사전이 로드되었는지 확인한다.
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 사전에 등록된 대표 용어 수를 반환한다.
   */
  getTermCount(): number {
    return this.termToSynonyms.size;
  }
}
