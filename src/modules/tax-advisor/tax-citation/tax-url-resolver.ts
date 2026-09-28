/**
 * 세무 원문 URL 생성 모듈 (TaxUrlResolver)
 *
 * 세법 및 예규/심판례의 원문에 접근할 수 있는 URL을 생성한다.
 * - 세법: 국가법령정보센터 (www.law.go.kr)
 * - 예규/심판례: 국세법령정보시스템 (taxlaw.nts.go.kr)
 *
 * @module TaxUrlResolver
 * @requirements 7.4
 */

/** 국가법령정보센터 기본 URL */
const LAW_BASE_URL = 'https://www.law.go.kr';

/** 국세법령정보시스템 기본 URL */
const NTS_BASE_URL = 'https://taxlaw.nts.go.kr';

/**
 * 세법 URL 생성 파라미터
 */
export interface TaxLawUrlParams {
  type: 'tax_law';
  /** 법령명 */
  lawName: string;
  /** 법령 고유 ID (선택) */
  lawId?: string;
}

/**
 * 예규/심판례 URL 생성 파라미터
 */
export interface TaxRulingUrlParams {
  type: 'ruling';
  /** 문서번호 */
  documentNumber: string;
  /** 문서 유형 (선택) */
  documentType?: string;
}

/**
 * URL 생성 입력 유니온 타입
 */
export type TaxUrlResolverInput = TaxLawUrlParams | TaxRulingUrlParams;

/**
 * 세법 원문 URL을 생성한다.
 *
 * - lawId가 있으면: https://www.law.go.kr/법령/{lawName}/{lawId}
 * - lawId가 없으면: https://www.law.go.kr/법령/{lawName}
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
 * 예규/심판례 원문 URL을 생성한다.
 *
 * - https://taxlaw.nts.go.kr/예규/{documentNumber}
 *
 * @param documentNumber - 문서번호
 * @returns 국세법령정보시스템 예규 URL
 */
export function getRulingUrl(documentNumber: string): string {
  const encodedNumber = encodeURIComponent(documentNumber);
  return `${NTS_BASE_URL}/예규/${encodedNumber}`;
}

/**
 * 세법 또는 예규의 원문 URL을 생성한다.
 *
 * @param input - URL 생성 파라미터
 * @returns 생성된 원문 URL
 */
export function resolveTaxUrl(input: TaxUrlResolverInput): string {
  if (input.type === 'tax_law') {
    return getLawUrl(input.lawName, input.lawId);
  }
  return getRulingUrl(input.documentNumber);
}

/**
 * 세무 URL 해석기 클래스
 *
 * 세법과 예규/심판례의 원문 URL을 생성하는 유틸리티 클래스.
 * 정적 메서드와 인스턴스 메서드 모두 제공한다.
 */
export class TaxUrlResolver {
  /**
   * 세법 원문 URL을 생성한다.
   *
   * @param lawName - 법령명
   * @param lawId - 법령 고유 ID (선택)
   * @returns 국가법령정보센터 URL
   */
  getLawUrl(lawName: string, lawId?: string): string {
    return getLawUrl(lawName, lawId);
  }

  /**
   * 예규/심판례 원문 URL을 생성한다.
   *
   * @param documentNumber - 문서번호
   * @returns 국세법령정보시스템 URL
   */
  getRulingUrl(documentNumber: string): string {
    return getRulingUrl(documentNumber);
  }

  /**
   * 입력 타입에 따라 적절한 URL을 생성한다.
   *
   * @param input - URL 생성 파라미터
   * @returns 생성된 원문 URL
   */
  resolve(input: TaxUrlResolverInput): string {
    return resolveTaxUrl(input);
  }
}
