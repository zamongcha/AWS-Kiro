/**
 * @fileoverview 세법 수집용 API 클라이언트
 * @description 국가법령정보센터 Open API 및 국세법령정보시스템을 통해
 * 부동산 관련 세법을 수집하고 구조화된 TaxLawArticle[] 형태로 파싱한다.
 *
 * @requirements 1.1 - 국가법령정보센터 Open API + 국세법령정보시스템 연동
 * @requirements 1.2 - 소득세법, 지방세법, 종합부동산세법, 상속세 및 증여세법, 조세특례제한법
 * @requirements 1.3 - 법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력, 적용 세목, hasRateTable
 * @requirements 1.5 - 5초 초기 간격 지수 백오프(배수 2), 최대 3회 재시도
 */

import type { TaxLawArticle, RevisionEntry } from '../interfaces/index.js';
import type { TaxType } from '../interfaces/index.js';
import { executeWithRetry, LAW_COLLECTOR_RETRY_POLICY } from '../../../common/utils/index.js';

/**
 * 세법 목록 검색 결과 항목
 */
export interface TaxLawListItem {
  /** 법령 ID */
  lawId: string;
  /** 법령명 */
  lawName: string;
  /** 시행일자 */
  effectiveDate: string;
  /** 법령 유형 (법률, 시행령, 시행규칙 등) */
  lawType: string;
}

/**
 * API 클라이언트 설정
 */
export interface TaxLawApiClientConfig {
  /** 국가법령정보센터 API 기본 URL */
  molegBaseUrl: string;
  /** 국세법령정보시스템 API 기본 URL */
  ntsBaseUrl: string;
  /** 국가법령정보센터 API 인증 키 */
  molegApiKey: string;
  /** 국세법령정보시스템 API 인증 키 */
  ntsApiKey: string;
  /** 요청 타임아웃 (밀리초) */
  timeoutMs: number;
}

/**
 * 수집 대상 세법 목록
 *
 * 부동산 세무 AI 자문 시스템에서 사용하는 핵심 세법 5종을 정의한다.
 */
export const TARGET_TAX_LAWS: string[] = [
  '소득세법',
  '지방세법',
  '종합부동산세법',
  '상속세 및 증여세법',
  '조세특례제한법',
];

/**
 * 세법명→적용 세목 매핑
 */
const TAX_LAW_TO_TAX_TYPE: Record<string, TaxType[]> = {
  '소득세법': ['capital_gains'],
  '지방세법': ['acquisition', 'property'],
  '종합부동산세법': ['comprehensive_property'],
  '상속세 및 증여세법': ['gift', 'inheritance'],
  '조세특례제한법': ['acquisition', 'capital_gains', 'comprehensive_property', 'gift', 'inheritance'],
};

/**
 * 세율 테이블 포함 여부 판별 키워드
 */
const RATE_TABLE_KEYWORDS = [
  '세율', '과세표준', '세액', '누진', '구간',
  '100분의', '퍼센트', '%', '초과', '이하',
];

/** 기본 API 설정 */
const DEFAULT_CONFIG: TaxLawApiClientConfig = {
  molegBaseUrl: 'https://www.law.go.kr/DRF/lawSearch.do',
  ntsBaseUrl: 'https://taxlaw.nts.go.kr/api',
  molegApiKey: '',
  ntsApiKey: '',
  timeoutMs: 30000,
};

/**
 * 세법 수집용 API 클라이언트
 *
 * 국가법령정보센터 Open API 및 국세법령정보시스템을 통해 세법 데이터를 수집한다.
 * 각 API 호출에 재시도 정책(5초 초기 간격, 지수 백오프, 최대 3회)을 적용한다.
 */
export class TaxLawApiClient {
  private config: TaxLawApiClientConfig;

  constructor(config: Partial<TaxLawApiClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 대상 세법 목록을 수집한다.
   *
   * @param targetLaws - 수집할 세법명 목록
   * @returns 구조화된 세법 조항 목록
   */
  async fetchTaxLaws(targetLaws: string[]): Promise<TaxLawArticle[]> {
    const allArticles: TaxLawArticle[] = [];

    for (const lawName of targetLaws) {
      const articles = await this.fetchSingleTaxLaw(lawName);
      allArticles.push(...articles);
    }

    return allArticles;
  }

  /**
   * 특정 세법의 개정 여부를 확인한다.
   *
   * @param lawId - 법령 고유 ID
   * @returns 개정 여부 (true: 개정됨)
   */
  async checkForUpdates(lawId: string): Promise<boolean> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.molegApiKey,
        target: 'law',
        type: 'XML',
        ID: lawId,
        LRV: 'Y',
      });

      const url = `${this.config.molegBaseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      const revisions = this.parseRevisionsXml(response);

      if (revisions.length === 0) {
        return false;
      }

      // 최근 30일 이내 개정이 있으면 갱신 필요
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];

      return revisions.some(rev => rev.date >= cutoffDate);
    }, LAW_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 단일 세법 수집
   * 법령 검색 → 상세 조회 → 개정 이력 조회 순서로 데이터를 수집한다.
   *
   * @param lawName - 수집할 세법명
   * @returns 구조화된 세법 조항 목록
   */
  private async fetchSingleTaxLaw(lawName: string): Promise<TaxLawArticle[]> {
    // 1. 법령 검색하여 법령 ID 확인
    const lawList = await this.fetchLawList(lawName);

    if (lawList.length === 0) {
      throw new Error(`세법을 찾을 수 없습니다: ${lawName}`);
    }

    // 가장 첫 번째 결과 사용 (정확도 높은 순)
    const targetLaw = lawList[0];

    // 2. 법령 상세 조회 (조문 목록)
    const rawArticles = await this.fetchLawDetail(targetLaw.lawId, lawName);

    // 3. 개정 이력 조회
    const revisions = await this.fetchRevisions(targetLaw.lawId);

    // 4. 조문에 세목 분류 및 개정 이력 매핑
    const applicableTaxTypes = TAX_LAW_TO_TAX_TYPE[lawName] || [];
    const enrichedArticles: TaxLawArticle[] = rawArticles.map(article => ({
      ...article,
      revisionHistory: revisions,
      applicableTaxType: applicableTaxTypes,
      hasRateTable: this.detectRateTable(article.articleContent),
      metadata: {
        ...article.metadata,
        collectedAt: new Date().toISOString(),
      },
    }));

    return enrichedArticles;
  }

  /**
   * 세법 목록 검색
   *
   * @param lawName - 검색할 세법명
   * @returns 매칭되는 법령 목록
   */
  private async fetchLawList(lawName: string): Promise<TaxLawListItem[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.molegApiKey,
        target: 'law',
        type: 'XML',
        query: lawName,
      });

      const url = `${this.config.molegBaseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseLawListXml(response);
    }, LAW_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 세법 상세 조회
   *
   * @param lawId - 법령 고유 ID
   * @param lawName - 법령명
   * @returns 파싱된 조문 목록 (revisionHistory, applicableTaxType 미설정)
   */
  private async fetchLawDetail(lawId: string, lawName: string): Promise<TaxLawArticle[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.molegApiKey,
        target: 'law',
        type: 'XML',
        ID: lawId,
      });

      const url = `${this.config.molegBaseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseLawDetailXml(response, lawId, lawName);
    }, LAW_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 개정 이력 조회
   *
   * @param lawId - 법령 고유 ID
   * @returns 개정 이력 목록
   */
  private async fetchRevisions(lawId: string): Promise<RevisionEntry[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.molegApiKey,
        target: 'law',
        type: 'XML',
        ID: lawId,
        LRV: 'Y',
      });

      const url = `${this.config.molegBaseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseRevisionsXml(response);
    }, LAW_COLLECTOR_RETRY_POLICY);
  }

  /**
   * HTTP 요청 실행
   * API Rate Limiting(429) 발생 시 에러를 던져 재시도 로직에 위임한다.
   */
  private async makeRequest(url: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/xml',
        },
      });

      if (response.status === 429) {
        throw new Error('API rate limit exceeded');
      }

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 세법 목록 XML 응답 파싱
   */
  private parseLawListXml(xml: string): TaxLawListItem[] {
    const items: TaxLawListItem[] = [];
    const lawPattern = /<law>([\s\S]*?)<\/law>/g;
    let match: RegExpExecArray | null;

    while ((match = lawPattern.exec(xml)) !== null) {
      const lawBlock = match[1];
      const lawId = this.extractXmlValue(lawBlock, '법령ID') ||
                    this.extractXmlValue(lawBlock, 'lawId') || '';
      const lawName = this.extractXmlValue(lawBlock, '법령명한글') ||
                      this.extractXmlValue(lawBlock, 'lawName') || '';
      const effectiveDate = this.extractXmlValue(lawBlock, '시행일자') ||
                            this.extractXmlValue(lawBlock, 'effectiveDate') || '';
      const lawType = this.extractXmlValue(lawBlock, '법령종류') ||
                      this.extractXmlValue(lawBlock, 'lawType') || '';

      if (lawId || lawName) {
        items.push({ lawId, lawName, effectiveDate: this.formatDate(effectiveDate), lawType });
      }
    }

    return items;
  }

  /**
   * 세법 상세 XML 응답 파싱
   * 법령 상세 XML에서 각 조문을 추출하여 TaxLawArticle[]으로 변환한다.
   */
  private parseLawDetailXml(xml: string, lawId: string, lawName: string): TaxLawArticle[] {
    const articles: TaxLawArticle[] = [];

    // 시행일자 추출
    const effectiveDate = this.extractXmlValue(xml, '시행일자') ||
                          this.extractXmlValue(xml, 'effectiveDate') || '';

    // 조문 파싱
    const articlePattern = /<조문>([\s\S]*?)<\/조문>|<article>([\s\S]*?)<\/article>/g;
    let match: RegExpExecArray | null;

    while ((match = articlePattern.exec(xml)) !== null) {
      const articleBlock = match[1] || match[2];
      const articleNumber = this.extractXmlValue(articleBlock, '조문번호') ||
                            this.extractXmlValue(articleBlock, 'articleNo') || '';
      const content = this.extractXmlValue(articleBlock, '조문내용') ||
                      this.extractXmlValue(articleBlock, 'articleContent') || '';

      if (articleNumber) {
        articles.push({
          lawName,
          articleNumber,
          articleContent: this.cleanContent(content),
          effectiveDate: this.formatDate(effectiveDate),
          revisionHistory: [], // 나중에 채워짐
          applicableTaxType: [], // 나중에 채워짐
          hasRateTable: false, // 나중에 채워짐
          metadata: {
            lawId,
            category: 'tax',
            source: 'MOLEG',
            collectedAt: '',
          },
        });
      }
    }

    return articles;
  }

  /**
   * 개정 이력 XML 응답 파싱
   */
  private parseRevisionsXml(xml: string): RevisionEntry[] {
    const revisions: RevisionEntry[] = [];
    const revisionPattern = /<연혁>([\s\S]*?)<\/연혁>|<revision>([\s\S]*?)<\/revision>/g;
    let match: RegExpExecArray | null;

    while ((match = revisionPattern.exec(xml)) !== null) {
      const revBlock = match[1] || match[2];
      const date = this.extractXmlValue(revBlock, '공포일자') ||
                   this.extractXmlValue(revBlock, 'date') || '';
      const typeStr = this.extractXmlValue(revBlock, '연혁구분') ||
                      this.extractXmlValue(revBlock, 'type') || '';
      const description = this.extractXmlValue(revBlock, '연혁내용') ||
                          this.extractXmlValue(revBlock, 'description') || '';

      revisions.push({
        date: this.formatDate(date),
        type: this.mapRevisionType(typeStr),
        description,
      });
    }

    return revisions;
  }

  /**
   * 세율 테이블 포함 여부 감지
   * 조문 내용에 세율 관련 키워드가 포함되어 있으면 true를 반환한다.
   */
  private detectRateTable(content: string): boolean {
    return RATE_TABLE_KEYWORDS.some(keyword => content.includes(keyword));
  }

  /**
   * XML 태그에서 값 추출
   */
  private extractXmlValue(xml: string, tagName: string): string | null {
    const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);
    const match = pattern.exec(xml);
    return match ? match[1].trim() : null;
  }

  /**
   * 개정 유형 문자열을 RevisionEntry 타입으로 변환
   */
  private mapRevisionType(typeStr: string): 'enacted' | 'amended' | 'repealed' {
    if (typeStr.includes('제정')) return 'enacted';
    if (typeStr.includes('폐지')) return 'repealed';
    return 'amended';
  }

  /**
   * 날짜 문자열을 ISO 8601 형식으로 변환
   */
  private formatDate(dateStr: string): string {
    if (!dateStr) return '';

    // 이미 ISO 형식이면 그대로 반환
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

    // 구분자 제거
    const cleaned = dateStr.replace(/[.\-/]/g, '');

    // YYYYMMDD → YYYY-MM-DD
    if (cleaned.length === 8) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    }

    return dateStr;
  }

  /**
   * 조문 내용 정리
   * HTML 태그 제거 및 공백 정규화
   */
  private cleanContent(content: string): string {
    return content
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
