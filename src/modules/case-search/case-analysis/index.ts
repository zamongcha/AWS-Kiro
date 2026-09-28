/**
 * @fileoverview 판례 분석 모듈
 * @description 검색된 판례를 심층 분석하는 모듈의 진입점이다.
 * CaseAnalyzer와 CaseAnalysisResponseBuilder를 조합하여
 * 개별 판례 분석 → 응답 구조 조립 파이프라인을 제공한다.
 *
 * @requirements 3.1 - 판결 요지, 핵심 쟁점, 판결 이유, 실무 시사점 추출
 * @requirements 3.2 - 사용자 상황과의 유사점/차이점 비교
 * @requirements 3.3 - 법률 용어 부연 설명
 * @requirements 3.4 - 한국어 존댓말(해요체) 응답
 * @requirements 3.5 - 면책 고지 자동 삽입
 * @requirements 3.6 - 전체 응답 구조 조립
 */

import type {
  CaseAnalysisInput,
  CaseAnalysisResponse,
  IndividualCaseAnalysis,
  CaseCitation,
  ComparisonResult,
  TrendResult,
  FactAnalysisOutput,
  CaseSearchModuleOutput,
} from '../interfaces/index.js';
import { CaseAnalyzer, CaseAnalyzerConfig } from './case-analyzer.js';
import { CaseAnalysisResponseBuilder } from './response-builder.js';

/**
 * 판례 분석 모듈 설정
 */
export interface CaseAnalysisModuleConfig {
  /** CaseAnalyzer 설정 */
  analyzerConfig?: CaseAnalyzerConfig;
}

/**
 * 판례 분석 모듈 클래스
 *
 * 검색된 판례를 LLM으로 분석하고 최종 응답 구조를 조립한다.
 *
 * 처리 흐름:
 * 1. CaseAnalyzer로 개별 판례 분석 (병렬)
 * 2. CaseAnalysisResponseBuilder로 응답 구조 조립
 *
 * @requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
export class CaseAnalysisModule {
  private readonly analyzer: CaseAnalyzer;
  private readonly responseBuilder: CaseAnalysisResponseBuilder;

  constructor(
    config?: CaseAnalysisModuleConfig,
    deps?: {
      analyzer?: CaseAnalyzer;
      responseBuilder?: CaseAnalysisResponseBuilder;
    },
  ) {
    this.analyzer = deps?.analyzer ?? new CaseAnalyzer(config?.analyzerConfig);
    this.responseBuilder = deps?.responseBuilder ?? new CaseAnalysisResponseBuilder();
  }

  /**
   * 판례 분석을 수행한다.
   *
   * @param input - 판례 분석 입력
   * @returns 개별 판례 분석 결과 목록
   */
  async analyze(input: CaseAnalysisInput): Promise<IndividualCaseAnalysis[]> {
    return this.analyzer.analyzeMultipleCases(
      input.searchResults.cases,
      input.userSituation,
    );
  }

  /**
   * 최종 응답을 조립한다.
   *
   * @param params - 응답 조립에 필요한 매개변수
   * @returns 완성된 분석 응답
   */
  buildResponse(params: {
    userSituation: FactAnalysisOutput;
    caseAnalyses: IndividualCaseAnalysis[];
    citations: CaseCitation[];
    comparisonAnalysis?: ComparisonResult | null;
    trendAnalysis?: TrendResult | null;
  }): CaseAnalysisResponse {
    return this.responseBuilder.build(params);
  }

  getName(): string {
    return 'case-analysis';
  }

  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { CaseAnalyzer } from './case-analyzer.js';
export { CaseAnalysisResponseBuilder } from './response-builder.js';
export type { CaseAnalyzerConfig } from './case-analyzer.js';
