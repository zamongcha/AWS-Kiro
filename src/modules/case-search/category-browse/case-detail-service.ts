/**
 * @fileoverview 개별 판례 상세 분석 서비스
 * @description OpenSearch에서 판례 전문을 조회하고 CaseAnalysisModule을 호출하여
 * 개별 판례의 상세 분석 결과를 제공한다.
 *
 * @requirements 7.5 - 개별 판례 상세 분석
 */

import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import type {
  CaseDetailInput,
  CaseDetailOutput,
  DisputeType,
  CaseSearchResult,
  IndividualCaseAnalysis,
  CaseCitation,
  FactAnalysisOutput,
} from '../interfaces/index.js';
import { CaseAnalyzer } from '../case-analysis/case-analyzer.js';
import { CaseCitationFormatter } from '../case-citation/citation-formatter.js';

/**
 * 판례 상세 서비스 설정
 */
export interface CaseDetailServiceConfig {
  /** OpenSearch 엔드포인트 */
  openSearchEndpoint?: string;
  /** 판례 인덱스명 */
  caseIndex?: string;
}

/**
 * 개별 판례 상세 분석 서비스 클래스
 *
 * @requirements 7.5
 */
export class CaseDetailService {
  private readonly openSearchClient: OpenSearchClient | null;
  private readonly caseIndex: string;
  private readonly analyzer: CaseAnalyzer;
  private readonly citationFormatter: CaseCitationFormatter;

  constructor(
    config?: CaseDetailServiceConfig,
    deps?: {
      openSearchClient?: OpenSearchClient;
      analyzer?: CaseAnalyzer;
      citationFormatter?: CaseCitationFormatter;
    },
  ) {
    this.caseIndex = config?.caseIndex ?? 'court-cases';
    this.analyzer = deps?.analyzer ?? new CaseAnalyzer();
    this.citationFormatter = deps?.citationFormatter ?? new CaseCitationFormatter();

    if (deps?.openSearchClient) {
      this.openSearchClient = deps.openSearchClient;
    } else if (config?.openSearchEndpoint) {
      this.openSearchClient = new OpenSearchClient({
        node: config.openSearchEndpoint,
        ssl: { rejectUnauthorized: true },
      });
    } else {
      this.openSearchClient = null;
    }
  }

  /**
   * 개별 판례의 상세 분석을 수행한다.
   *
   * @param input - 판례 상세 조회 입력
   * @returns 판례 상세 분석 결과 또는 null
   */
  async getDetail(input: CaseDetailInput): Promise<CaseDetailOutput | null> {
    const caseResult = await this.fetchCase(input.caseId);
    if (!caseResult) {
      return null;
    }

    // 간소화된 사실관계 생성 (개별 판례 분석용)
    const pseudoSituation: FactAnalysisOutput = {
      disputeTypes: [caseResult.caseType],
      parties: { parties: [], relationship: '' },
      keyFacts: [],
      legalIssues: [],
      searchQueries: [],
      isRealEstateDispute: true,
    };

    const analysis: IndividualCaseAnalysis = await this.analyzer.analyzeSingleCase(
      caseResult,
      pseudoSituation,
    );

    const citations: CaseCitation[] = this.citationFormatter.formatCitations([caseResult]);

    return {
      caseNumber: caseResult.caseNumber,
      courtName: caseResult.courtName,
      judgmentDate: caseResult.judgmentDate,
      caseType: caseResult.caseType,
      analysis,
      citations,
    };
  }

  /**
   * OpenSearch에서 판례를 ID로 조회한다.
   */
  private async fetchCase(caseId: string): Promise<CaseSearchResult | null> {
    if (!this.openSearchClient) {
      return null;
    }

    try {
      const response = await this.openSearchClient.get({
        index: this.caseIndex,
        id: caseId,
      });

      const body = response.body as Record<string, unknown>;
      const source = body['_source'] as Record<string, unknown>;

      if (!source) return null;

      const metadata = source['metadata'] as Record<string, unknown> | undefined;

      return {
        caseId: (metadata?.['case_id'] as string) ?? caseId,
        caseNumber: (source['case_number'] as string) ?? '',
        courtName: (source['court_name'] as string) ?? '',
        courtLevel: ((source['court_level'] as string) ?? 'lower') as 'supreme' | 'lower',
        judgmentDate: (source['judgment_date'] as string) ?? '',
        caseType: ((source['case_type'] as string) ?? 'lease') as DisputeType,
        summary: ((source['chunk_content'] as string) ?? '').substring(0, 500),
        fullText: (source['chunk_content'] as string) ?? '',
        referencedLaws: (source['referenced_laws'] as string[]) ?? [],
        similarityScore: 0,
        matchedFacts: [],
      };
    } catch {
      return null;
    }
  }
}
