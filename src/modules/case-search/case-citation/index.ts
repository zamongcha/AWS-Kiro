/**
 * @fileoverview 판례 인용 표시 모듈
 * @description 판례 인용 포맷팅 및 URL 생성 모듈의 진입점이다.
 * CaseCitationFormatter와 CaseUrlResolver를 조합하여
 * 인용 목록 생성, 각주 삽입, URL 해석 기능을 제공한다.
 *
 * @requirements 6.1 - 인용 포맷: 사건번호, 선고일자, 법원명, 법원등급, 200자 이내 요지
 * @requirements 6.2 - 본문 내 [N] 형식 각주 번호 삽입
 * @requirements 6.3 - 응답 하단 각주 번호 순 인용 목록
 * @requirements 6.4 - 각주 번호와 citations 배열 1:1 대응
 * @requirements 6.5 - 대법원 종합법률정보 URL 생성
 */

import type { CaseCitation, CaseSearchResult } from '../interfaces/index.js';
import { CaseCitationFormatter } from './citation-formatter.js';
import { CaseUrlResolver } from './url-resolver.js';

/**
 * 판례 인용 표시 모듈 클래스
 *
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */
export class CaseCitationModule {
  private readonly formatter: CaseCitationFormatter;
  private readonly urlResolver: CaseUrlResolver;

  constructor(deps?: {
    formatter?: CaseCitationFormatter;
    urlResolver?: CaseUrlResolver;
  }) {
    this.urlResolver = deps?.urlResolver ?? new CaseUrlResolver();
    this.formatter = deps?.formatter ?? new CaseCitationFormatter({ urlResolver: this.urlResolver });
  }

  /**
   * 검색된 판례 목록에서 인용 목록을 생성한다.
   *
   * @param cases - 검색된 판례 목록
   * @returns 인용 목록
   */
  generateCitations(cases: CaseSearchResult[]): CaseCitation[] {
    return this.formatter.formatCitations(cases);
  }

  /**
   * 본문에 각주 번호를 삽입한다.
   *
   * @param text - 원본 텍스트
   * @param citations - 인용 목록
   * @returns 각주가 삽입된 텍스트
   */
  insertFootnotes(text: string, citations: CaseCitation[]): string {
    return this.formatter.insertFootnotes(text, citations);
  }

  /**
   * 인용 목록을 텍스트로 포맷한다.
   *
   * @param citations - 인용 목록
   * @returns 포맷된 인용 텍스트
   */
  formatCitationList(citations: CaseCitation[]): string {
    return this.formatter.formatCitationList(citations);
  }

  getName(): string {
    return 'case-citation';
  }

  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { CaseCitationFormatter } from './citation-formatter.js';
export { CaseUrlResolver } from './url-resolver.js';
