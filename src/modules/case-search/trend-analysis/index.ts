/**
 * @fileoverview 트렌드 분석 모듈
 * @description 특정 분쟁 유형의 판결 경향 변화를 시간순으로 분석하는
 * 모듈의 진입점이다. TrendAnalyzer를 활용하여
 * 판례 조회 → 데이터 충분성 검증 → LLM 분석 파이프라인을 제공한다.
 *
 * @requirements 5.1 - 해당 분쟁유형 판례 5건 이상 시 분석 수행
 * @requirements 5.2 - 5건 미만 시 insufficientData=true
 * @requirements 5.3 - 최근 5년 판례 조회
 * @requirements 5.4 - 시간순 판결 방향 변화 분석
 * @requirements 5.5 - 관련 법령 개정 영향 분석
 */

import type { TrendInput, TrendResult, DisputeType } from '../interfaces/index.js';
import { TrendAnalyzer, TrendAnalyzerConfig } from './trend-analyzer.js';

/**
 * 트렌드 분석 모듈 설정
 */
export interface TrendAnalysisModuleConfig {
  /** TrendAnalyzer 설정 */
  analyzerConfig?: TrendAnalyzerConfig;
}

/**
 * 트렌드 분석 모듈 클래스
 *
 * @requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export class TrendAnalysisModule {
  private readonly analyzer: TrendAnalyzer;

  constructor(
    config?: TrendAnalysisModuleConfig,
    deps?: { analyzer?: TrendAnalyzer },
  ) {
    this.analyzer = deps?.analyzer ?? new TrendAnalyzer(config?.analyzerConfig);
  }

  /**
   * 트렌드 분석을 수행한다.
   *
   * @param input - 트렌드 분석 입력
   * @returns 트렌드 분석 결과
   */
  async analyze(input: TrendInput): Promise<TrendResult> {
    return this.analyzer.analyze(input);
  }

  /**
   * 분쟁유형과 쟁점을 기반으로 트렌드 분석을 수행한다.
   *
   * @param disputeType - 분쟁 유형
   * @param relatedIssue - 관련 쟁점
   * @returns 트렌드 분석 결과
   */
  async analyzeByType(disputeType: DisputeType, relatedIssue: string): Promise<TrendResult> {
    return this.analyze({ disputeType, relatedIssue });
  }

  getName(): string {
    return 'trend-analysis';
  }

  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { TrendAnalyzer } from './trend-analyzer.js';
export type { TrendAnalyzerConfig } from './trend-analyzer.js';
