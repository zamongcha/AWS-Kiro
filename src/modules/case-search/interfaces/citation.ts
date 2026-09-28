/**
 * 판례 인용 표시 모듈 인터페이스 정의
 *
 * 분석 응답 내 판례 인용 정보를 구조화한다.
 * 각주 번호, 사건번호, 법원 정보, 판결 요지, 원문 URL 등을 포함한다.
 */

/**
 * 판례 인용 인터페이스
 */
export interface CaseCitation {
  /** 각주 번호 */
  footnoteNumber: number;
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 법원 등급 (대법원/하급심) */
  courtLevel: 'supreme' | 'lower';
  /** 선고일자 (ISO 8601) */
  judgmentDate: string;
  /** 200자 이내 판결 요지 */
  summary: string;
  /** 대법원 종합법률정보 시스템 판례 원문 URL */
  originalUrl?: string;
}
