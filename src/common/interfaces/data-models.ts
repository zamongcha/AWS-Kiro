/**
 * 부동산 법률 AI 자문 시스템 데이터 모델 정의
 *
 * 법령, 판례, 세션, 대화, 인용 관련 핵심 데이터 타입을 정의한다.
 */

/**
 * 개정 유형 열거형
 */
export enum RevisionType {
  /** 제정 */
  ENACTED = 'enacted',
  /** 개정 */
  AMENDED = 'amended',
  /** 폐지 */
  REPEALED = 'repealed',
}

/**
 * 인용 유형 열거형
 */
export enum CitationType {
  /** 법령 인용 */
  LAW = 'law',
  /** 판례 인용 */
  CASE = 'case',
}

/**
 * 개정 이력 항목
 */
export interface RevisionEntry {
  /** 개정 일자 (ISO 8601) */
  date: string;
  /** 개정 유형 */
  type: RevisionType;
  /** 개정 설명 */
  description: string;
  /** 이전 내용 */
  previousContent?: string;
  /** 새 내용 */
  newContent?: string;
}

/**
 * 법령 조문 인터페이스
 *
 * 국가법령정보센터에서 수집한 법령 데이터를 구조화한다.
 */
export interface LawArticle {
  /** 법령 고유 ID */
  id: string;
  /** 법령명 */
  lawName: string;
  /** 조항 번호 */
  articleNumber: string;
  /** 조항 내용 */
  content: string;
  /** 시행일자 (ISO 8601) */
  effectiveDate: string;
  /** 개정 이력 */
  revisions: RevisionEntry[];
}

/**
 * 판례 인터페이스
 *
 * 대법원 종합법률정보에서 수집한 판례 데이터를 구조화한다.
 */
export interface CourtCase {
  /** 판례 고유 ID */
  id: string;
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  court: string;
  /** 선고일자 (ISO 8601) */
  date: string;
  /** 판결 요지 */
  summary: string;
  /** 판결 전문 */
  fullText: string;
  /** 키워드 목록 */
  keywords: string[];
  /** 참조 법령 목록 */
  relatedLaws: string[];
}

/**
 * 세션 기록 인터페이스
 *
 * 사용자 대화 세션 정보를 관리한다. 최대 50개 대화 쌍을 유지한다.
 */
export interface SessionRecord {
  /** 세션 고유 ID */
  sessionId: string;
  /** 사용자 ID */
  userId?: string;
  /** 세션 시작 시각 (ISO 8601) */
  startTime: string;
  /** 대화 항목 목록 */
  conversations: ConversationEntry[];
  /** 세션 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * 대화 항목 인터페이스
 *
 * 단일 질문-답변 쌍을 나타낸다.
 */
export interface ConversationEntry {
  /** 대화 항목 고유 ID */
  id: string;
  /** 대화 시각 (ISO 8601) */
  timestamp: string;
  /** 사용자 질문 */
  question: string;
  /** AI 답변 */
  answer: string;
  /** 인용 정보 목록 */
  citations: Citation[];
  /** 사용자 피드백 */
  feedback?: 'helpful' | 'not_helpful';
}

/**
 * 인용 정보 기본 타입
 *
 * 법령 인용과 판례 인용의 공통 속성을 정의한다.
 */
export interface Citation {
  /** 인용 유형 */
  type: CitationType;
  /** 인용 출처 */
  source: string;
  /** 인용 내용 */
  content: string;
  /** 인용 신뢰도 (0.0 ~ 1.0) */
  confidence: number;
}

/**
 * 법령 인용 인터페이스
 *
 * 법령명, 조항 번호, 항 정보를 포함하는 법령 인용 타입.
 */
export interface LawCitation extends Citation {
  /** 인용 유형 (항상 LAW) */
  type: CitationType.LAW;
  /** 법령명 */
  lawName: string;
  /** 조항 번호 */
  articleNumber: string;
  /** 항 번호 */
  paragraph?: string;
}

/**
 * 판례 인용 인터페이스
 *
 * 사건번호, 법원명, 선고일자, 관련 부분을 포함하는 판례 인용 타입.
 */
export interface CaseCitation extends Citation {
  /** 인용 유형 (항상 CASE) */
  type: CitationType.CASE;
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  court: string;
  /** 선고일자 (ISO 8601) */
  date: string;
  /** 관련 판결 부분 */
  relevantPart?: string;
}
