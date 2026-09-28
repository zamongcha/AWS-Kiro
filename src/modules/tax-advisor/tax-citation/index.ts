/**
 * 세무 인용 표시 모듈 (TaxCitationModule)
 *
 * 세무 답변에 포함된 세법 조항 및 예규/심판례를 구조화된 형태로 표시하는 모듈이다.
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다.
 *
 * 주요 기능:
 * - 세법 인용: 법령명 + 조항 번호 + 100자 이내 요약
 * - 예규/심판례 인용: 문서번호 + 회신일자 + 200자 이내 요지
 * - 본문 내 [1], [2] 형식 각주 번호 삽입
 * - 답변 하단 각주 번호 순 인용 목록 생성
 * - 세법/예규 원문 URL 생성 (국가법령정보센터, 국세법령정보시스템)
 * - 개정된 세법 표시: isAmended=true일 때 currentInfo 포함
 * - 인용 대상 없을 경우 안내 메시지
 *
 * @module TaxCitationModule
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../../common/interfaces/service-module.js';
import { TaxUrlResolver } from './tax-url-resolver.js';
import type {
  TaxCitation,
  TaxLawCitationSource,
  TaxRulingCitationSource,
  TaxLawArticle,
  TaxRuling,
} from '../interfaces/index.js';

/**
 * 세무 인용 모듈 입력 페이로드
 */
export interface TaxCitationPayload {
  /** 인용 마커가 포함된 답변 본문 */
  answerText: string;
  /** 참조된 세법 조항 목록 */
  referencedLaws: TaxLawCitationInput[];
  /** 참조된 예규/심판례 목록 */
  referencedRulings: TaxRulingCitationInput[];
}

/**
 * 세법 인용 입력 데이터
 */
export interface TaxLawCitationInput {
  /** 법령명 */
  lawName: string;
  /** 조항 번호 */
  articleNumber: string;
  /** 조항 내용 (요약 대상) */
  content: string;
  /** 법령 고유 ID (URL 생성용) */
  lawId?: string;
  /** 개정 여부 */
  isAmended?: boolean;
  /** 현행 법령 정보 (개정된 경우) */
  currentLawInfo?: string;
}

/**
 * 예규/심판례 인용 입력 데이터
 */
export interface TaxRulingCitationInput {
  /** 문서번호 */
  documentNumber: string;
  /** 회신일자 (ISO 8601 또는 YYYY.MM.DD) */
  replyDate: string;
  /** 회신 내용 요지 (요약 대상) */
  summary: string;
  /** 개정 여부 */
  isAmended?: boolean;
  /** 현행 정보 (개정된 경우) */
  currentInfo?: string;
}

/**
 * 세무 인용 처리 결과
 */
export interface TaxCitationResult {
  /** 각주가 삽입된 답변 본문 */
  formattedAnswer: string;
  /** 답변 하단 각주 인용 목록 */
  footnoteList: string;
  /** 구조화된 인용 항목 배열 */
  citations: TaxCitation[];
  /** 인용 없음 안내 메시지 (인용이 없는 경우) */
  noCitationMessage?: string;
}

/** 세법 요약 최대 길이 */
const TAX_LAW_SUMMARY_MAX_LENGTH = 100;

/** 예규 요지 최대 길이 */
const TAX_RULING_SUMMARY_MAX_LENGTH = 200;

/**
 * 세무 인용 표시 모듈 클래스
 *
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
export class TaxCitationModule implements ServiceModule {
  private name = 'tax-citation-module';
  private version = '1.0.0';
  private initialized = false;
  private config: ModuleConfig | null = null;
  private urlResolver: TaxUrlResolver;

  constructor() {
    this.urlResolver = new TaxUrlResolver();
  }

  /**
   * 모듈 초기화
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    this.name = config.name || this.name;
    this.version = config.version || this.version;
    this.initialized = true;
  }

  /**
   * 인용 처리 실행
   *
   * 입력된 답변 텍스트와 세법/예규 인용 데이터를 기반으로
   * 각주를 삽입하고 인용 목록을 생성한다.
   *
   * @param input - 모듈 입력 (payload: TaxCitationPayload)
   * @returns 인용 처리 결과를 포함하는 모듈 출력
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return {
        success: false,
        errors: [{
          code: 'CITATION_NOT_INITIALIZED',
          message: '세무 인용 모듈이 초기화되지 않았습니다.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    try {
      const payload = input.payload as TaxCitationPayload;

      if (!payload || typeof payload.answerText !== 'string') {
        return {
          success: false,
          errors: [{
            code: 'CITATION_INVALID_INPUT',
            message: '유효한 답변 텍스트가 필요합니다.',
            severity: ErrorSeverity.LOW,
            timestamp: new Date().toISOString(),
          }],
        };
      }

      const lawCitations: TaxLawCitationInput[] = payload.referencedLaws || [];
      const rulingCitations: TaxRulingCitationInput[] = payload.referencedRulings || [];

      const result = this.processTaxCitations(
        payload.answerText,
        lawCitations,
        rulingCitations
      );

      // 최종 답변 생성: 본문 + 인용 목록
      const finalText = result.noCitationMessage
        ? `${result.formattedAnswer}\n\n※ ${result.noCitationMessage}`
        : `${result.formattedAnswer}${result.footnoteList}`;

      return {
        success: true,
        data: {
          finalText,
          formattedAnswer: result.formattedAnswer,
          footnoteList: result.footnoteList,
          citations: result.citations,
          noCitationMessage: result.noCitationMessage,
          hasCitations: result.citations.length > 0,
        },
        metadata: {
          citationCount: String(result.citations.length),
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      return {
        success: false,
        errors: [{
          code: 'CITATION_PROCESSING_ERROR',
          message: `세무 인용 처리 중 오류가 발생했습니다: ${errorMessage}`,
          severity: ErrorSeverity.MEDIUM,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

  /**
   * 모듈 헬스체크
   */
  async healthCheck(): Promise<HealthStatus> {
    return {
      status: this.initialized ? HealthStatusEnum.HEALTHY : HealthStatusEnum.UNHEALTHY,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: this.initialized,
        moduleName: this.name,
        version: this.version,
      },
    };
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return this.name;
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return this.version;
  }

  // ─── Public Citation Helper Methods ────────────────────────────────────────

  /**
   * 세법 인용을 포맷한다.
   *
   * 형식: "법령명 제N조 - [100자 이내 요약]"
   * 개정된 경우: "⚠️ 개정됨 | 법령명 제N조 - [100자 이내 요약] (현행: ...)"
   *
   * @param input - 세법 인용 입력
   * @returns 포맷된 인용 텍스트
   */
  formatTaxLawCitation(input: TaxLawCitationInput): string {
    const summary = this.truncateText(input.content, TAX_LAW_SUMMARY_MAX_LENGTH);
    const baseCitation = `${input.lawName} ${input.articleNumber} - ${summary}`;

    if (input.isAmended) {
      const amendedMark = '⚠️ 개정됨';
      const currentInfo = input.currentLawInfo
        ? ` (현행: ${input.currentLawInfo})`
        : '';
      return `${amendedMark} | ${baseCitation}${currentInfo}`;
    }

    return baseCitation;
  }

  /**
   * 예규/심판례 인용을 포맷한다.
   *
   * 형식: "문서번호 (회신일자) - [200자 이내 요지]"
   *
   * @param input - 예규 인용 입력
   * @returns 포맷된 인용 텍스트
   */
  formatRulingCitation(input: TaxRulingCitationInput): string {
    const summary = this.truncateText(input.summary, TAX_RULING_SUMMARY_MAX_LENGTH);
    return `${input.documentNumber} (${input.replyDate}) - ${summary}`;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * 세법 및 예규 인용을 포맷하고 각주 시스템을 적용한다.
   */
  private processTaxCitations(
    answerText: string,
    lawCitations: TaxLawCitationInput[],
    rulingCitations: TaxRulingCitationInput[]
  ): TaxCitationResult {
    // 인용할 문서가 없는 경우
    if (lawCitations.length === 0 && rulingCitations.length === 0) {
      return {
        formattedAnswer: answerText,
        footnoteList: '',
        citations: [],
        noCitationMessage:
          '직접 관련된 세법/예규를 찾지 못했습니다. 답변은 일반적인 세무 지식에 기반하여 작성되었습니다.',
      };
    }

    const citations: TaxCitation[] = [];
    let footnoteNumber = 1;

    // 세법 인용 처리
    for (const law of lawCitations) {
      const formattedText = this.formatTaxLawCitation(law);
      const url = this.urlResolver.getLawUrl(law.lawName, law.lawId);

      citations.push({
        footnoteNumber,
        type: 'tax_law',
        source: {
          lawName: law.lawName,
          articleNumber: law.articleNumber,
          contentSummary: this.truncateText(law.content, TAX_LAW_SUMMARY_MAX_LENGTH),
        } as TaxLawCitationSource,
        originalUrl: url,
        isAmended: law.isAmended,
        currentLawInfo: law.currentLawInfo,
      });
      footnoteNumber++;
    }

    // 예규/심판례 인용 처리
    for (const ruling of rulingCitations) {
      const formattedText = this.formatRulingCitation(ruling);
      const url = this.urlResolver.getRulingUrl(ruling.documentNumber);

      citations.push({
        footnoteNumber,
        type: 'ruling',
        source: {
          documentNumber: ruling.documentNumber,
          replyDate: ruling.replyDate,
          summary: this.truncateText(ruling.summary, TAX_RULING_SUMMARY_MAX_LENGTH),
        } as TaxRulingCitationSource,
        originalUrl: url,
        isAmended: ruling.isAmended,
        currentLawInfo: ruling.currentInfo,
      });
      footnoteNumber++;
    }

    // 본문에 각주 번호 삽입
    const formattedAnswer = this.insertFootnotes(answerText, citations.length);

    // 하단 각주 목록 생성
    const footnoteList = this.generateFootnoteList(citations, lawCitations, rulingCitations);

    return {
      formattedAnswer,
      footnoteList,
      citations,
    };
  }

  /**
   * 답변 본문에 각주 번호 [1], [2], ... 를 삽입한다.
   *
   * 답변 본문에서 인용 마커({{cite:0}}, {{cite:1}})를 찾아
   * [1], [2] 형식의 각주 번호로 치환한다.
   */
  private insertFootnotes(text: string, citationCount: number): string {
    let result = text;

    for (let i = 0; i < citationCount; i++) {
      const marker = `{{cite:${i}}}`;
      const footnote = `[${i + 1}]`;
      result = result.replace(new RegExp(this.escapeRegExp(marker), 'g'), footnote);
    }

    return result;
  }

  /**
   * 답변 하단에 삽입할 각주 인용 목록을 생성한다.
   */
  private generateFootnoteList(
    citations: TaxCitation[],
    lawCitations: TaxLawCitationInput[],
    rulingCitations: TaxRulingCitationInput[]
  ): string {
    if (citations.length === 0) {
      return '';
    }

    const header = '\n---\n📚 참고 세법/예규\n';
    const items: string[] = [];

    let lawIndex = 0;
    let rulingIndex = 0;

    for (const citation of citations) {
      let line: string;

      if (citation.type === 'tax_law' && lawIndex < lawCitations.length) {
        const law = lawCitations[lawIndex];
        line = `[${citation.footnoteNumber}] ${this.formatTaxLawCitation(law)}`;
        if (citation.originalUrl) {
          line += `\n    원문: ${citation.originalUrl}`;
        }
        if (law.isAmended && law.currentLawInfo) {
          line += `\n    현행 법령: ${law.currentLawInfo}`;
        }
        lawIndex++;
      } else if (citation.type === 'ruling' && rulingIndex < rulingCitations.length) {
        const ruling = rulingCitations[rulingIndex];
        line = `[${citation.footnoteNumber}] ${this.formatRulingCitation(ruling)}`;
        if (citation.originalUrl) {
          line += `\n    원문: ${citation.originalUrl}`;
        }
        if (ruling.isAmended && ruling.currentInfo) {
          line += `\n    현행 정보: ${ruling.currentInfo}`;
        }
        rulingIndex++;
      } else {
        line = `[${citation.footnoteNumber}] 인용 정보 없음`;
      }

      items.push(line);
    }

    return header + items.join('\n');
  }

  /**
   * 텍스트를 지정된 최대 길이로 자른다.
   */
  private truncateText(text: string, maxLength: number): string {
    const trimmed = text.trim();
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return trimmed.slice(0, maxLength - 3) + '...';
  }

  /**
   * 정규식 특수문자를 이스케이프한다.
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
