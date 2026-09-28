/**
 * 계약서 분석 OpenSearch 인덱스 매핑 정의
 *
 * 계약서 분석 전용 OpenSearch Serverless 인덱스(`contract-toxic-rules`,
 * `contract-standard-forms`)의 매핑을 정의한다. 한국어 형태소 분석을 위한
 * nori analyzer와 kNN 벡터 검색(1024차원, hnsw/nmslib)을 사용하며, 모든
 * 인덱스명은 `contract-` 접두사로 격리된다.
 *
 * design.md "Data Models > OpenSearch Serverless 인덱스 설계" 섹션의 매핑을
 * 그대로 반영한다.
 *
 * @module ContractIndexMappings
 * @requirements 16.1
 */

/**
 * 계약서 분석 kNN 벡터 차원 수 (Titan Text Embeddings V2 기준)
 */
export const CONTRACT_EMBEDDING_DIMENSION = 1024;

/**
 * 계약서 분석 인덱스명 접두사
 *
 * 모든 계약서 분석 전용 인덱스는 이 접두사로 시작하여 기존 서비스
 * (판례 검색 court-cases, 세무 tax-*)와 데이터를 격리한다.
 */
export const CONTRACT_INDEX_PREFIX = 'contract-';

/**
 * 독소조항 룰셋 인덱스명
 */
export const TOXIC_RULES_INDEX = 'contract-toxic-rules';

/**
 * 표준계약서 조항 인덱스명
 */
export const STANDARD_FORMS_INDEX = 'contract-standard-forms';

/**
 * kNN 벡터 필드 공통 정의 (hnsw / nmslib, 1024차원)
 */
const knnVectorField = {
  type: 'knn_vector',
  dimension: CONTRACT_EMBEDDING_DIMENSION,
  method: {
    name: 'hnsw',
    engine: 'nmslib',
    parameters: { ef_construction: 512, m: 16 },
  },
} as const;

/**
 * 적재 메타데이터 공통 정의 (버전/갱신시각/서비스 식별자)
 */
const metadataField = {
  type: 'object',
  properties: {
    version: { type: 'integer' },
    updated_at: { type: 'date' },
    service_id: { type: 'keyword', index: true },
  },
} as const;

/**
 * 독소조항 룰셋 인덱스(contract-toxic-rules) 매핑
 *
 * 계약 유형별 독소조항 패턴을 nori 분석 텍스트와 1024차원 임베딩 벡터로
 * 저장하여 룰셋 매칭 및 kNN 벡터 유사도 검색을 지원한다.
 *
 * @requirements 16.1
 */
export const TOXIC_RULES_MAPPING = {
  mappings: {
    properties: {
      contract_type: { type: 'keyword' },
      rule_id: { type: 'keyword' },
      rule_category: { type: 'keyword' },
      pattern_text: { type: 'text', analyzer: 'nori' },
      risk_type: { type: 'keyword' },
      risk_reason: { type: 'text', analyzer: 'nori' },
      is_required_clause: { type: 'boolean' },
      applicable_perspective: { type: 'keyword' },
      legal_basis: { type: 'keyword' },
      embedding_vector: knnVectorField,
      metadata: metadataField,
    },
  },
} as const;

/**
 * 표준계약서 인덱스(contract-standard-forms) 매핑
 *
 * 계약 유형별 표준계약서 조항을 nori 분석 텍스트와 1024차원 임베딩 벡터로
 * 저장하여 조항 단위 조회 및 비교 분석을 지원한다.
 *
 * @requirements 16.1
 */
export const STANDARD_FORMS_MAPPING = {
  mappings: {
    properties: {
      contract_type: { type: 'keyword' },
      clause_id: { type: 'keyword' },
      clause_title: { type: 'keyword' },
      clause_content: { type: 'text', analyzer: 'nori' },
      clause_order: { type: 'integer' },
      embedding_vector: knnVectorField,
      metadata: metadataField,
    },
  },
} as const;

/**
 * 인덱스명 → 매핑 정의 조회 맵
 *
 * 인덱스 초기화(생성) 시 인덱스명으로 해당 매핑을 조회하기 위해 사용한다.
 */
export const CONTRACT_INDEX_MAPPINGS: Record<string, object> = {
  [TOXIC_RULES_INDEX]: TOXIC_RULES_MAPPING,
  [STANDARD_FORMS_INDEX]: STANDARD_FORMS_MAPPING,
};
