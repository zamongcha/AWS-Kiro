/**
 * @fileoverview 판례 분석 응답 빌더
 * @description 분석 결과를 조립하여 최종 응답 구조를 생성한다.
 * situationSummary → caseAnalyses → comparisonAnalysis(조건부) →
 * trendAnalysis(조건부) → overallImplication → citations → disclaimer
 *
 * @requirements 3.5 - 면책 고지 자동 삽입
 * @requirements 3.6 - 전체 응답 구조 조립
 */

import type {
  CaseAnalysisResponse,
  IndividualCaseAnalysis,
  ComparisonResult,
  TrendResult,
  CaseCitation,
  FactAnalysisOutput,
} from '../interfaces/index.js';

/** 면책 고지 문구 */
const DISCLAIMER = '본 분석은 AI가 제공하는 참고 정보이며, 법률 전문가의 조언을 대체하지 않습니다. ' +
  '실제 법적 판단이나 소송 진행 시에는 반드시 변호사와 상담하시기 바랍니다. ' +
  '판례의 해석은 개별 사안의 구체적 사실관계에 따라 달라질 수 있습니다.';

/**
 * 판례 분석 응답 빌더 클래스
 *
 * 개별 분석 결과를 조립하여 최종 CaseAnalysisResponse를 생성한다.
 *
 * @requirements 3.5, 3.6
 */
export class CaseAnalysisResponseBuilder {
  /**
   * 최종 분석 응답을 조립한다.
   *
   * @param userSituation - 사용자 상황 분석 결과
   * @param caseAnalyses - 개별 판례 분석 목록
   * @param citations - 인용 목록
   * @param comparisonAnalysis - 비교 분석 (조건부)
   * @param trendAnalysis - 트렌드 분석 (조건부)
   * @returns 완성된 분석 응답
   */
  build(params: {
    userSituation: FactAnalysisOutput;
    caseAnalyses: IndividualCaseAnalysis[];
    citations: CaseCitation[];
    comparisonAnalysis?: ComparisonResult | null;
    trendAnalysis?: TrendResult | null;
  }): CaseAnalysisResponse {
    const { userSituation, caseAnalyses, citations, comparisonAnalysis, trendAnalysis } = params;

    const situationSummary = this.buildSituationSummary(userSituation);
    const overallImplication = this.buildOverallImplication(caseAnalyses, userSituation);

    const response: CaseAnalysisResponse = {
      situationSummary,
      caseAnalyses,
      overallImplication,
      citations,
      disclaimer: DISCLAIMER,
    };

    if (comparisonAnalysis) {
      response.comparisonAnalysis = comparisonAnalysis;
    }

    if (trendAnalysis && !trendAnalysis.insufficientData) {
      response.trendAnalysis = trendAnalysis;
    }

    return response;
  }

  /**
   * 사용자 상황 요약을 생성한다.
   */
  private buildSituationSummary(userSituation: FactAnalysisOutput): string {
    const disputeTypeNames: Record<string, string> = {
      lease: '임대차',
      sale: '매매',
      registration: '등기',
      brokerage: '중개',
      redevelopment: '재건축/재개발',
    };

    const types = userSituation.disputeTypes
      .map((t) => disputeTypeNames[t] || t)
      .join(', ');

    const facts = userSituation.keyFacts.slice(0, 3).join(', ');

    return `${types} 관련 분쟁으로, 주요 사실관계는 다음과 같아요: ${facts}`;
  }

  /**
   * 종합 시사점을 생성한다.
   */
  private buildOverallImplication(
    caseAnalyses: IndividualCaseAnalysis[],
    userSituation: FactAnalysisOutput,
  ): string {
    if (caseAnalyses.length === 0) {
      return '유사한 판례를 찾기 어려워 종합적인 시사점을 도출하기 어렵습니다. ' +
        '상황을 더 구체적으로 설명해 주시면 더 정확한 분석이 가능해요.';
    }

    const issues = userSituation.legalIssues.slice(0, 2).join(', ');
    const caseCount = caseAnalyses.length;

    return `${issues}에 관한 ${caseCount}건의 유사 판례를 분석한 결과, ` +
      `위 판례들의 판결 경향과 실무 시사점을 종합적으로 고려하여 ` +
      `법률 전문가와 상담하시는 것을 권장합니다.`;
  }

  /**
   * 면책 고지 문구를 반환한다.
   */
  getDisclaimer(): string {
    return DISCLAIMER;
  }
}
