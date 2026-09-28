/**
 * 검색 모듈 인터페이스 정의
 *
 * RAG 기반 문서 검색에 필요한 입력, 출력, 결과 타입을 정의한다.
 */

/**
 * 검색 결과 문서 유형 열거형
 */
export enum SearchResultType {
  /** 법령 문서 */
  LAW = 'law',
  /** 판례 문서 */
  CASE = 'case',
}

/**
 * 검색 입력 인터페이스
 *
 * 사용자 질문과 필터링/옵션을 전달한다.
 */
export interface SearchInput {
  /** 사용자 질문 텍스트 */
  query: string;
  /** 검색 필터 */
  filters?: SearchFilters;
  /** 검색 옵션 */
  options?: SearchOptions;
}

/**
 * 검색 필터 인터페이스
 */
export interface SearchFilters {
  /** 법률 유형 필터 (예: 임대차, 매매 등) */
  lawType?: string[];
  /** 검색 기간 범위 */
  dateRange?: {
    /** 시작 일자 (ISO 8601) */
    from?: string;
    /** 종료 일자 (ISO 8601) */
    to?: string;
  };
  /** 법원 필터 */
  court?: string[];
}

/**
 * 검색 옵션 인터페이스
 */
export interface SearchOptions {
  /** 최대 결과 수 (기본값: 5) */
  maxResults?: number;
  /** 유사도 임계값 (0.0 ~ 1.0) */
  threshold?: number;
  /** 관련 문서 포함 여부 */
  includeRelated?: boolean;
}

/**
 * 검색 출력 인터페이스
 */
export interface SearchOutput {
  /** 검색 결과 목록 */
  results: SearchResult[];
  /** 전체 결과 수 */
  totalCount: number;
  /** 검색 소요 시간 (밀리초) */
  searchTime: number;
  /** 검색 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * 개별 검색 결과 인터페이스
 */
export interface SearchResult {
  /** 문서 고유 ID */
  id: string;
  /** 문서 유형 (법령/판례) */
  type: SearchResultType;
  /** 문서 내용 */
  content: string;
  /** 유사도 점수 (0.0 ~ 1.0) */
  score: number;
  /** 하이라이트된 텍스트 조각 */
  highlights?: string[];
  /** 문서 출처 정보 */
  source: SearchResultSource;
}

/**
 * 검색 결과 출처 정보 인터페이스
 */
export interface SearchResultSource {
  /** 출처 제목 (법령명 또는 사건번호) */
  title: string;
  /** 출처 URL */
  url?: string;
  /** 출처 날짜 (ISO 8601) */
  date?: string;
  /** 관련도 기준 미달 여부 */
  isLowRelevance?: boolean;
}
