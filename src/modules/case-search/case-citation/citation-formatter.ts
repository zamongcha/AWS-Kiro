/**
 * @fileoverview 판례 인용 포맷터
 * @description 판례 인용 정보를 표준 형식으로 포맷팅한다.
 * 본문 내 [N] 형식 각주 번호를 삽입하고,
 * 응답 하단에 각주 번호 순 인용 목록을 생성한다.
 *
 * @requirements 6.1 - 사건번호, 선고일자, 법원명, 법원등급, 200자 이내 판결 요지
 * @requirements 6.2 - 본문 내 [1], [2] 형식 각주 번호 삽입
 * @requirements 6.3 - 응답 하단 각주 번호 순 인용 목록 생성
 * @requirements 6.4 - 각주 번호와 citations 배열 1:1 대응 보장
 */

import type { CaseCitation, CaseSearchResult } from '../interfaces/index.js';
import { CaseUrlResolver } from './url-resolver.js';

/** 판결 요지 최대 길이 */
const MAX_SUMMARY_LENGTH = 200;

/**
 * 판례 인용 포맷터 클래스
 *
 * 검색된 판례 결과를 표준 인용 형식(CaseCitation)으로 변환한다.
 *
 * @requirements 6.1, 6.2, 6.3, 6.4
 */
export class CaseCitationFormatter {
  private readonly urlResolver: CaseUrlResolver;

  constructor(deps?: { urlResolver?: CaseUrlResolver }) {
    this.urlResolver = deps?.urlResolver ?? new CaseUrlResolver();
  }

  /**
   * 검색된 판례 목록을 인용 목록으로 변환한다.
   *
   * 각 판례에 대해 순서대로 각주 번호(1부터)를 부여하고,
   * 표준 인용 형식으로 변환한다.
   *
   * @param cases - 검색된 판례 목록
   * @returns 인용 목록 (각주 번호 순)
   */
  formatCitations(cases: CaseSearchResult[]): CaseCitation[] {
    return cases.map((c, index) => this.formatSingleCitation(c, index + 1));
  }

  /**
   * 단일 판례를 인용 형식으로 변환한다.
   *
   * @param caseResult - 검색된 판례
   * @param footnoteNumber - 각주 번호
   * @returns 인용 정보
   */
  formatSingleCitation(caseResult: CaseSearchResult, footnoteNumber: number): CaseCitation {
    return {
      footnoteNumber,
      caseNumber: caseResult.caseNumber,
      courtName: caseResult.courtName,
      courtLevel: caseResult.courtLevel,
      judgmentDate: caseResult.judgmentDate,
      summary: this.truncateSummary(caseResult.summary),
      originalUrl: this.urlResolver.resolve(caseResult.caseNumber) || undefined,
    };
  }

  /**
   * 본문 텍스트에 각주 번호를 삽입한다.
   *
   * 판례 사건번호 뒤에 [N] 형식으로 각주를 추가한다.
   *
   * @param text - 원본 텍스트
   * @param citations - 인용 목록
   * @returns 각주가 삽입된 텍스트
   */
  insertFootnotes(text: string, citations: CaseCitation[]): string {
    let result = text;

    for (const citation of citations) {
      const footnoteMarker = `[${citation.footnoteNumber}]`;
      // 사건번호 뒤에 각주 삽입 (이미 없는 경우만)
      const caseRef = citation.caseNumber;
      if (caseRef && result.includes(caseRef) && !result.includes(`${caseRef}${footnoteMarker}`)) {
        result = result.replace(caseRef, `${caseRef}${footnoteMarker}`);
      }
    }

    return result;
  }

  /**
   * 인용 목록을 텍스트 형식으로 출력한다.
   *
   * @param citations - 인용 목록
   * @returns 포맷된 인용 텍스트
   */
  formatCitationList(citations: CaseCitation[]): string {
    return citations
      .sort((a, b) => a.footnoteNumber - b.footnoteNumber)
      .map((c) => {
        const courtLabel = c.courtLevel === 'supreme' ? '대법원' : c.courtName;
        return `[${c.footnoteNumber}] ${courtLabel} ${c.judgmentDate} 선고 ${c.caseNumber} - ${c.summary}`;
      })
      .join('\n');
  }

  /**
   * 판결 요지를 200자 이내로 제한한다.
   */
  private truncateSummary(summary: string): string {
    if (!summary) return '';
    if (summary.length <= MAX_SUMMARY_LENGTH) return summary;
    return summary.substring(0, MAX_SUMMARY_LENGTH - 3) + '...';
  }
}
