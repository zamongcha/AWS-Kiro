/**
 * @fileoverview 판례 URL 생성기
 * @description 대법원 종합법률정보 시스템(glaw.scourt.go.kr)의
 * 판례 원문 URL을 생성한다.
 *
 * @requirements 6.5 - 대법원 종합법률정보 시스템 판례 원문 URL 생성
 */

/**
 * 판례 URL 생성기 클래스
 *
 * 사건번호를 기반으로 대법원 종합법률정보 시스템의 판례 원문 URL을 생성한다.
 *
 * @requirements 6.5
 */
export class CaseUrlResolver {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://glaw.scourt.go.kr/wsjo/panre/sjo100.do';
  }

  /**
   * 사건번호를 기반으로 판례 원문 URL을 생성한다.
   *
   * @param caseNumber - 사건번호 (예: "2023다12345")
   * @returns 판례 원문 URL
   */
  resolve(caseNumber: string): string {
    if (!caseNumber || caseNumber.trim().length === 0) {
      return '';
    }

    const encoded = encodeURIComponent(caseNumber.trim());
    return `${this.baseUrl}?caseNm=${encoded}`;
  }

  /**
   * 여러 사건번호의 URL을 일괄 생성한다.
   *
   * @param caseNumbers - 사건번호 목록
   * @returns 사건번호-URL 매핑
   */
  resolveMultiple(caseNumbers: string[]): Map<string, string> {
    const urlMap = new Map<string, string>();
    for (const cn of caseNumbers) {
      urlMap.set(cn, this.resolve(cn));
    }
    return urlMap;
  }
}
