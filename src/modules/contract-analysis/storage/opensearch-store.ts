/**
 * 계약서 분석 OpenSearch 저장소 클라이언트
 *
 * 기존 판례 검색(`src/modules/search/opensearch-client.ts`)이 court-cases
 * 인덱스를 다루는 방식을 참고하여, 계약서 분석 전용 인덱스
 * (`contract-toxic-rules`, `contract-standard-forms`)에 대한 접근을 담당한다.
 *
 * - 인덱스명 빌더는 항상 `contract-` 접두사를 강제하여 기존 서비스와
 *   데이터를 격리한다 (Property 38 대비).
 * - 독소조항 룰셋은 1024차원 임베딩 벡터에 대한 kNN 유사도 검색을 제공한다.
 * - 표준계약서 조항은 계약 유형별 조회를 제공한다.
 *
 * @module ContractOpenSearchStore
 * @requirements 16.1
 */

import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import type { ContractType, PartyPerspective } from '../interfaces/index.js';
import {
  CONTRACT_INDEX_PREFIX,
  CONTRACT_INDEX_MAPPINGS,
  STANDARD_FORMS_INDEX,
  TOXIC_RULES_INDEX,
} from './index-mappings.js';

/**
 * 계약서 OpenSearch 저장소 설정 인터페이스
 */
export interface ContractOpenSearchStoreConfig {
  /** OpenSearch Serverless 엔드포인트 URL */
  endpoint: string;
  /** kNN 검색 시 기본 최대 결과 수 (기본값: 10) */
  defaultMaxResults?: number;
  /** 유사도 임계값 (기본값: 0.75, 위험조항 탐지 기준과 일치) */
  similarityThreshold?: number;
}

/**
 * 독소조항 룰셋 문서 (contract-toxic-rules 인덱스 _source)
 */
export interface ToxicRuleDocument {
  /** 계약 유형 */
  contract_type: ContractType;
  /** 룰 식별자 */
  rule_id: string;
  /** 룰 분류 */
  rule_category?: string;
  /** 독소조항 패턴 텍스트 */
  pattern_text: string;
  /** 위험 유형 */
  risk_type: string;
  /** 위험 사유 */
  risk_reason: string;
  /** 필수 특약 여부 */
  is_required_clause?: boolean;
  /** 적용 당사자 관점 */
  applicable_perspective?: PartyPerspective[];
  /** 근거 법조항/판례 */
  legal_basis?: string[];
  /** 1024차원 임베딩 벡터 (적재 시 사용, 조회 결과에는 생략 가능) */
  embedding_vector?: number[];
  /** 적재 메타데이터 */
  metadata?: {
    version?: number;
    updated_at?: string;
    service_id?: string;
  };
}

/**
 * 표준계약서 조항 문서 (contract-standard-forms 인덱스 _source)
 */
export interface StandardFormDocument {
  /** 계약 유형 */
  contract_type: ContractType;
  /** 조항 식별자 */
  clause_id: string;
  /** 조항 제목 */
  clause_title: string;
  /** 조항 내용 */
  clause_content: string;
  /** 조항 순서 */
  clause_order: number;
  /** 1024차원 임베딩 벡터 */
  embedding_vector?: number[];
  /** 적재 메타데이터 */
  metadata?: {
    version?: number;
    updated_at?: string;
    service_id?: string;
  };
}

/**
 * 룰셋 kNN 검색 결과 (유사도 점수 포함)
 */
export interface ToxicRuleMatch {
  /** 문서 식별자 */
  id: string;
  /** 코사인 유사도 점수 (0.0 ~ 1.0) */
  score: number;
  /** 룰셋 문서 본문 */
  rule: ToxicRuleDocument;
}

/**
 * OpenSearch kNN 검색 히트 인터페이스
 */
interface OpenSearchHit<T> {
  _id: string;
  _score: number;
  _source: T;
}

/**
 * OpenSearch 검색 응답 인터페이스
 */
interface OpenSearchSearchResponse<T> {
  hits: {
    total: { value: number };
    hits: Array<OpenSearchHit<T>>;
  };
}

/**
 * 계약서 분석 OpenSearch 저장소 클라이언트
 *
 * 계약서 분석 전용 인덱스에 대한 인덱스 초기화, 룰셋 kNN 검색,
 * 표준계약서 조항 조회를 제공한다. 모든 인덱스 접근은 `contract-`
 * 접두사가 강제된 인덱스명 빌더를 통해서만 이루어진다.
 *
 * @requirements 16.1
 */
export class ContractOpenSearchStore {
  private client: OpenSearchClient;
  private defaultMaxResults: number;
  private similarityThreshold: number;

  constructor(config: ContractOpenSearchStoreConfig) {
    this.client = new OpenSearchClient({
      node: config.endpoint,
      ssl: { rejectUnauthorized: true },
    });

    this.defaultMaxResults = config.defaultMaxResults ?? 10;
    this.similarityThreshold = config.similarityThreshold ?? 0.75;
  }

  /**
   * 계약서 분석 전용 인덱스명을 생성한다.
   *
   * 입력 이름이 이미 `contract-` 접두사를 가지면 그대로 사용하고,
   * 그렇지 않으면 접두사를 강제로 부여한다. 반환값은 항상 `contract-`로
   * 시작함을 보장한다 (Property 38 대비).
   *
   * @param name - 논리 인덱스 이름 (예: 'toxic-rules' 또는 'contract-toxic-rules')
   * @returns `contract-` 접두사가 강제된 인덱스명
   *
   * @requirements 16.1
   */
  buildIndexName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('인덱스 이름이 비어있습니다.');
    }
    if (trimmed.startsWith(CONTRACT_INDEX_PREFIX)) {
      return trimmed;
    }
    return `${CONTRACT_INDEX_PREFIX}${trimmed}`;
  }

  /**
   * OpenSearch 클러스터 연결 상태를 확인한다.
   *
   * @returns 연결 성공 시 true, 실패 시 false
   */
  async ping(): Promise<boolean> {
    try {
      const response = await this.client.cluster.health();
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * 계약서 분석 전용 인덱스가 없으면 매핑과 함께 생성한다.
   *
   * 인덱스명은 buildIndexName을 통해 `contract-` 접두사가 강제되며,
   * 정의된 매핑(nori analyzer, knn_vector 1024차원)이 존재하는 경우
   * 해당 매핑으로 인덱스를 생성한다.
   *
   * @param name - 논리 인덱스 이름
   * @returns 새로 생성했으면 true, 이미 존재했으면 false
   *
   * @requirements 16.1
   */
  async ensureIndex(name: string): Promise<boolean> {
    const index = this.buildIndexName(name);

    const exists = await this.client.indices.exists({ index });
    if (exists.body === true) {
      return false;
    }

    const mapping = CONTRACT_INDEX_MAPPINGS[index];
    if (!mapping) {
      throw new Error(`정의되지 않은 계약서 분석 인덱스 매핑입니다: ${index}`);
    }

    await this.client.indices.create({
      index,
      body: {
        settings: { index: { knn: true } },
        ...mapping,
      },
    });

    return true;
  }

  /**
   * 독소조항 룰셋 인덱스에서 kNN 벡터 유사도 검색을 수행한다.
   *
   * 조항 임베딩 벡터(1024차원)와 코사인 유사도가 높은 독소조항 룰을
   * 검색한다. 계약 유형 필터가 주어지면 해당 유형의 룰만 대상으로 하며,
   * 결과는 유사도 점수 내림차순으로 정렬된다.
   *
   * @param queryVector - 조항 임베딩 벡터 (1024차원)
   * @param options - 검색 옵션 (계약 유형, 최대 결과 수, 임계값)
   * @returns 유사도 점수를 포함한 룰셋 매칭 결과 배열
   *
   * @requirements 16.1
   */
  async searchToxicRules(
    queryVector: number[],
    options?: {
      contractType?: ContractType;
      maxResults?: number;
      threshold?: number;
    }
  ): Promise<ToxicRuleMatch[]> {
    const index = this.buildIndexName(TOXIC_RULES_INDEX);
    const maxResults = options?.maxResults ?? this.defaultMaxResults;
    const threshold = options?.threshold ?? this.similarityThreshold;

    const knnQuery: Record<string, unknown> = {
      knn: {
        embedding_vector: {
          vector: queryVector,
          k: maxResults,
        },
      },
    };

    // 계약 유형 필터가 있으면 kNN + term 필터로 결합
    const query = options?.contractType
      ? {
          bool: {
            must: [knnQuery],
            filter: [{ term: { contract_type: options.contractType } }],
          },
        }
      : knnQuery;

    const response = await this.client.search({
      index,
      body: {
        size: maxResults,
        query,
        _source: { excludes: ['embedding_vector'] },
      },
    });

    const body = response.body as OpenSearchSearchResponse<ToxicRuleDocument>;
    const hits = body.hits?.hits ?? [];

    return [...hits]
      .sort((a, b) => b._score - a._score)
      .slice(0, maxResults)
      .filter((hit) => hit._score >= threshold)
      .map((hit) => ({
        id: hit._id,
        score: hit._score,
        rule: hit._source,
      }));
  }

  /**
   * 표준계약서 인덱스에서 계약 유형별 조항을 조회한다.
   *
   * 지정된 계약 유형의 표준계약서 조항을 clause_order 오름차순으로
   * 반환한다. 비교 분석기가 업로드 계약서와 조항 단위로 대조할 때 사용한다.
   *
   * @param contractType - 계약 유형
   * @param maxClauses - 최대 조항 수 (기본값: 200)
   * @returns 표준계약서 조항 문서 배열 (clause_order 오름차순)
   *
   * @requirements 16.1
   */
  async getStandardForm(
    contractType: ContractType,
    maxClauses = 200
  ): Promise<StandardFormDocument[]> {
    const index = this.buildIndexName(STANDARD_FORMS_INDEX);

    const response = await this.client.search({
      index,
      body: {
        size: maxClauses,
        query: {
          term: { contract_type: contractType },
        },
        sort: [{ clause_order: { order: 'asc' } }],
        _source: { excludes: ['embedding_vector'] },
      },
    });

    const body = response.body as OpenSearchSearchResponse<StandardFormDocument>;
    const hits = body.hits?.hits ?? [];

    return hits.map((hit) => hit._source);
  }
}
