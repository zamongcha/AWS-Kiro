/**
 * 판례 검색 서비스 기본 타입 정의
 *
 * 분쟁 유형, 당사자 관계, 검색 쿼리, 검색 결과, 유사도 상세 등
 * 판례 검색 모듈 전반에서 사용되는 핵심 타입을 정의한다.
 */

/**
 * 부동산 분쟁 유형
 *
 * 판례 검색 시 분류되는 5가지 분쟁 유형.
 */
export type DisputeType = 'lease' | 'sale' | 'registration' | 'brokerage' | 'redevelopment';

/**
 * 당사자 관계 인터페이스
 *
 * 분쟁에 관련된 당사자 목록과 관계 설명을 포함한다.
 */
export interface PartyRelation {
  /** 당사자 목록 */
  parties: string[];
  /** 관계 설명 */
  relationship: string;
}

/**
 * 검색 쿼리 인터페이스
 *
 * 사실관계 분석 결과로부터 생성된 검색 쿼리 정보를 담는다.
 */
export interface SearchQuery {
  /** 검색 쿼리 텍스트 */
  queryText: string;
  /** 강조 키워드 */
  emphasis: string[];
  /** 분쟁 유형 필터 */
  disputeTypeFilter: DisputeType;
}

/**
 * 판례 검색 결과 인터페이스
 *
 * OpenSearch에서 검색된 개별 판례 정보를 담는다.
 */
export interface CaseSearchResult {
  /** 판례 고유 ID */
  caseId: string;
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 법원 등급 (대법원/하급심) */
  courtLevel: 'supreme' | 'lower';
  /** 선고일자 (ISO 8601) */
  judgmentDate: string;
  /** 사건 유형 */
  caseType: DisputeType;
  /** 판결 요지 */
  summary: string;
  /** 판결 전문 (분석용) */
  fullText: string;
  /** 참조 법령 목록 */
  referencedLaws: string[];
  /** 사실관계 유사도 점수 (0.0~1.0) */
  similarityScore: number;
  /** 매칭된 사실관계 요소 */
  matchedFacts: string[];
}

/**
 * 유사도 상세 인터페이스
 *
 * 사용자 상황과 판례 간의 유사점과 차이점을 구조화한다.
 */
export interface SimilarityDetail {
  /** 유사점 목록 */
  similarities: string[];
  /** 차이점 목록 */
  differences: string[];
}
