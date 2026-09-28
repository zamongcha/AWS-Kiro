/**
 * @fileoverview 국가법령정보센터 Open API 클라이언트
 * @description 법령 검색, 상세 조회, 개정 이력 조회 기능을 제공한다.
 * XML 응답을 구조화된 LawArticle[] 형태로 파싱한다.
 *
 * @requirements 1.1 - 국가법령정보센터 Open API를 통해 부동산 관련 법령을 자동으로 수집
 * @requirements 1.5 - 5초 초기 간격, 지수 백오프, 최대 3회 재시도
 */

import { LawArticle, RevisionEntry, RevisionType } from '../../common/interfaces/index.js';
import { executeWithRetry, LAW_COLLECTOR_RETRY_POLICY } from '../../common/utils/index.js';

/**
 * 법령 검색 결과 항목
 */
export interface LawListItem {
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
export interface LawApiClientConfig {
  /** API 기본 URL */
  baseUrl: string;
  /** API 인증 키 (OC 파라미터) */
  apiKey: string;
  /** 요청 타임아웃 (밀리초) */
  timeoutMs: number;
}

/** 기본 API 설정 */
const DEFAULT_CONFIG: LawApiClientConfig = {
  baseUrl: 'https://www.law.go.kr/DRF/lawSearch.do',
  apiKey: '',
  timeoutMs: 30000,
};

/**
 * 국가법령정보센터 Open API 클라이언트
 *
 * 법령 목록 검색, 상세 조회, 개정 이력 조회를 수행하며,
 * 각 API 호출에 재시도 정책(5초 초기 간격, 지수 백오프, 최대 3회)을 적용한다.
 */
export class LawApiClient {
  private config: LawApiClientConfig;

  constructor(config: Partial<LawApiClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 법령 목록 검색
   * 지정된 법령명으로 국가법령정보센터에서 매칭되는 법령 목록을 조회한다.
   *
   * @param lawName - 검색할 법령명 (예: '주택임대차보호법')
   * @returns 매칭되는 법령 목록
   */
  async fetchLawList(lawName: string): Promise<LawListItem[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.apiKey,
        target: 'law',
        type: 'XML',
        query: lawName,
      });

      const url = `${this.config.baseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseLawListXml(response);
    }, LAW_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 법령 상세 조회
   * 법령 ID를 기반으로 전체 조문 내용을 조회한다.
   *
   * @param lawId - 법령 고유 ID
   * @returns 법령 조문 목록
   */
  async fetchLawDetail(lawId: string): Promise<LawArticle[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.apiKey,
        target: 'law',
        type: 'XML',
        ID: lawId,
      });

      const url = `${this.config.baseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseLawDetailXml(response, lawId);
    }, LAW_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 법령 개정 이력 조회
   * 특정 법령의 제정/개정/폐지 이력을 조회한다.
   *
   * @param lawId - 법령 고유 ID
   * @returns 개정 이력 목록
   */
  async fetchLawRevisions(lawId: string): Promise<RevisionEntry[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.apiKey,
        target: 'law',
        type: 'XML',
        ID: lawId,
        LRV: 'Y',
      });

      const url = `${this.config.baseUrl}?${params.toString()}`;
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
   * 법령 목록 XML 응답 파싱
   * XML 응답에서 법령 항목들을 추출하여 LawListItem[]으로 반환한다.
   */
  private parseLawListXml(xml: string): LawListItem[] {
    const items: LawListItem[] = [];
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
        items.push({ lawId, lawName, effectiveDate, lawType });
      }
    }

    return items;
  }

  /**
   * 법령 상세 XML 응답 파싱
   * 법령 상세 XML에서 각 조문을 추출하여 LawArticle[]으로 변환한다.
   */
  private parseLawDetailXml(xml: string, lawId: string): LawArticle[] {
    const articles: LawArticle[] = [];

    // 법령명 추출
    const lawName = this.extractXmlValue(xml, '법령명_한글') ||
                    this.extractXmlValue(xml, '법령명한글') ||
                    this.extractXmlValue(xml, 'lawName') || '';

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
          id: `${lawId}_${articleNumber}`,
          lawName,
          articleNumber,
          content: this.cleanContent(content),
          effectiveDate: this.formatDate(effectiveDate),
          revisions: [],
        });
      }
    }

    return articles;
  }

  /**
   * 개정 이력 XML 응답 파싱
   * 개정 이력 XML에서 각 이력 항목을 RevisionEntry[]로 변환한다.
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
   * XML 태그에서 값 추출
   */
  private extractXmlValue(xml: string, tagName: string): string | null {
    const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`);
    const match = pattern.exec(xml);
    return match ? match[1].trim() : null;
  }

  /**
   * 개정 유형 문자열을 RevisionType 열거형으로 변환
   */
  private mapRevisionType(typeStr: string): RevisionType {
    if (typeStr.includes('제정')) return RevisionType.ENACTED;
    if (typeStr.includes('폐지')) return RevisionType.REPEALED;
    return RevisionType.AMENDED;
  }

  /**
   * 날짜 문자열을 ISO 8601 형식으로 변환
   * 입력: 'YYYYMMDD' 또는 'YYYY-MM-DD' 형식
   */
  private formatDate(dateStr: string): string {
    if (!dateStr) return '';

    // 이미 ISO 형식이면 그대로 반환
    if (dateStr.includes('-')) return dateStr;

    // YYYYMMDD → YYYY-MM-DD
    if (dateStr.length === 8) {
      return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
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
