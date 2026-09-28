/**
 * 원문 URL 생성 모듈
 *
 * 법령 및 판례의 원문에 접근할 수 있는 URL을 생성한다.
 * - 법령: 국가법령정보센터 (www.law.go.kr)
 * - 판례: 대법원 종합법률정보 (www.law.go.kr/판례)
 */

/**
 * 법령 URL 생성 입력 파라미터
 */
export interface LawUrlParams {
  type: 'law';
  /** 법령명 */
  lawName: string;
  /** 법령 고유 ID (국가법령정보센터 기준) */
  lawId?: string;
}

/**
 * 판례 URL 생성 입력 파라미터
 */
export interface CaseUrlParams {
  type: 'case';
  /** 사건번호 */
  caseNumber: string;
}

/**
 * URL 생성 입력 유니온 타입
 */
export type UrlResolverInput = LawUrlParams | CaseUrlParams;

/** 국가법령정보센터 기본 URL */
const LAW_BASE_URL = 'https://www.law.go.kr';

/**
 * 법령 또는 판례의 원문 URL을 생성한다.
 *
 * 법령의 경우:
 * - lawId가 있으면: https://www.law.go.kr/법령/{lawName}/{lawId}
 * - lawId가 없으면: https://www.law.go.kr/법령/{lawName}
 *
 * 판례의 경우:
 * - https://www.law.go.kr/판례/{caseNumber}
 *
 * @param input - URL 생성 파라미터
 * @returns 생성된 원문 URL
 */
export function resolveUrl(input: UrlResolverInput): string {
  if (input.type === 'law') {
    return getLawUrl(input.lawName, input.lawId);
  }
  return getCaseUrl(input.caseNumber);
}

/**
 * 법령 원문 URL을 생성한다.
 *
 * @param lawName - 법령명
 * @param lawId - 법령 고유 ID (선택)
 * @returns 국가법령정보센터 법령 URL
 */
export function getLawUrl(lawName: string, lawId?: string): string {
  const encodedName = encodeURIComponent(lawName);
  if (lawId) {
    return `${LAW_BASE_URL}/법령/${encodedName}/${encodeURIComponent(lawId)}`;
  }
  return `${LAW_BASE_URL}/법령/${encodedName}`;
}

/**
 * 판례 원문 URL을 생성한다.
 *
 * @param caseNumber - 사건번호
 * @returns 국가법령정보센터 판례 URL
 */
export function getCaseUrl(caseNumber: string): string {
  const encodedCase = encodeURIComponent(caseNumber);
  return `${LAW_BASE_URL}/판례/${encodedCase}`;
}
