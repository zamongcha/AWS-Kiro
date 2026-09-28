/**
 * @fileoverview 예규/심판례 수집용 API 클라이언트
 * @description 국세법령정보시스템 API를 통해 부동산 세무 관련 유권해석, 예규, 심판례를
 * 수집하고 구조화된 TaxRuling[] 형태로 파싱한다.
 *
 * @requirements 2.1 - 국세법령정보시스템 API 연동하여 예규/심판례 수집
 * @requirements 2.2 - 취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세 카테고리별 수집
 * @requirements 2.3 - 문서번호, 회신일자, 문서 유형, 세목 분류, 질의 요지, 회신 내용, 참조 세법 조항
 * @requirements 2.5 - 30초 고정 간격, 최대 3회 재시도
 * @requirements 2.8 - 동일 문서번호 존재 시 신규 저장 생략 (중복 판별)
 */

import type { TaxRuling, RulingType } from '../interfaces/index.js';
import type { TaxType } from '../interfaces/index.js';
import { executeWithRetry, CASE_COLLECTOR_RETRY_POLICY } from '../../../common/utils/index.js';

/**
 * 예규 목록 검색 결과 항목
 */
export interface RulingListItem {
  /** 예규 ID (일련번호) */
  rulingId: string;
  /** 문서번호 */
  documentNumber: string;
  /** 문서 제목 */
  title: string;
  /** 회신일자 */
  replyDate: string;
  /** 문서 유형 */
  documentType: string;
}

/**
 * API 클라이언트 설정
 */
export interface RulingApiClientConfig {
  /** 국세법령정보시스템 API 기본 URL */
  baseUrl: string;
  /** API 인증 키 */
  apiKey: string;
  /** 요청 타임아웃 (밀리초) */
  timeoutMs: number;
}

/**
 * 세목 카테고리→TaxType 매핑
 */
const CATEGORY_TO_TAX_TYPE: Record<string, TaxType> = {
  '취득세': 'acquisition',
  '양도소득세': 'capital_gains',
  '종합부동산세': 'comprehensive_property',
  '재산세': 'property',
  '증여세': 'gift',
  '상속세': 'inheritance',
};

/**
 * 예규 수집 대상 세목 카테고리 목록
 */
export const TARGET_TAX_CATEGORIES: string[] = [
  '취득세',
  '양도소득세',
  '종합부동산세',
  '재산세',
  '증여세',
  '상속세',
];

/** 기본 API 설정 */
const DEFAULT_CONFIG: RulingApiClientConfig = {
  baseUrl: 'https://taxlaw.nts.go.kr/api',
  apiKey: '',
  timeoutMs: 30000,
};

/**
 * 예규/심판례 수집용 API 클라이언트
 *
 * 국세법령정보시스템 API를 통해 예규 데이터를 수집한다.
 * 각 API 호출에 재시도 정책(30초 고정 간격, 최대 3회)을 적용한다.
 * 동일 문서번호가 이미 존재하는 경우 신규 저장을 생략한다.
 */
export class RulingApiClient {
  private config: RulingApiClientConfig;
  /** 이미 수집된 문서번호 집합 (중복 판별용) */
  private existingDocumentNumbers: Set<string> = new Set();

  constructor(config: Partial<RulingApiClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 기존 문서번호 목록을 설정하여 중복 판별에 활용
   *
   * @param documentNumbers - 이미 저장된 문서번호 목록
   */
  setExistingDocumentNumbers(documentNumbers: string[]): void {
    this.existingDocumentNumbers = new Set(documentNumbers);
  }

  /**
   * 문서번호 중복 여부 확인
   *
   * @param documentNumber - 확인할 문서번호
   * @returns 이미 존재하면 true, 신규이면 false
   */
  isDuplicate(documentNumber: string): boolean {
    return this.existingDocumentNumbers.has(documentNumber);
  }

  /**
   * 대상 세목 카테고리별 예규를 수집한다.
   *
   * @param categories - 수집 대상 세목 카테고리 (한글)
   * @param dateFrom - 수집 시작 일자 (ISO 8601, 선택)
   * @returns 구조화된 예규 데이터 목록
   */
  async fetchRulings(categories: string[], dateFrom?: string): Promise<TaxRuling[]> {
    const allRulings: TaxRuling[] = [];

    for (const category of categories) {
      const rulings = await this.fetchRulingsByCategory(category, dateFrom);
      allRulings.push(...rulings);
    }

    return allRulings;
  }

  /**
   * 단일 세목 카테고리의 예규 목록 조회
   *
   * @param category - 세목 카테고리 (한글: '취득세' 등)
   * @param dateFrom - 수집 시작 일자
   * @returns 매칭되는 예규 목록 (중복 제외)
   */
  async fetchRulingList(category: string, dateFrom?: string): Promise<RulingListItem[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        key: this.config.apiKey,
        type: 'XML',
        query: category,
        target: 'ruling',
      });

      if (dateFrom) {
        params.set('dateFrom', dateFrom);
      }

      const url = `${this.config.baseUrl}/search?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseRulingListXml(response);
    }, CASE_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 예규 상세 조회
   *
   * @param rulingId - 예규 고유 ID
   * @param category - 세목 카테고리 (TaxType 매핑용)
   * @returns 구조화된 예규 데이터
   */
  async fetchRulingDetail(rulingId: string, category: string): Promise<TaxRuling> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        key: this.config.apiKey,
        type: 'XML',
        ID: rulingId,
      });

      const url = `${this.config.baseUrl}/detail?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseRulingDetailXml(response, rulingId, category);
    }, CASE_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 카테고리별 예규 수집 (목록 조회 → 중복 확인 → 상세 조회)
   */
  private async fetchRulingsByCategory(category: string, dateFrom?: string): Promise<TaxRuling[]> {
    // 1. 예규 목록 조회
    const rulingList = await this.fetchRulingList(category, dateFrom);

    if (rulingList.length === 0) {
      return [];
    }

    // 2. 중복 확인 후 상세 조회
    const rulings: TaxRuling[] = [];

    for (const item of rulingList) {
      // 동일 문서번호 존재 시 신규 저장 생략
      if (this.isDuplicate(item.documentNumber)) {
        continue;
      }

      try {
        const ruling = await this.fetchRulingDetail(item.rulingId, category);
        rulings.push(ruling);

        // 수집된 문서번호를 기존 집합에 추가 (같은 배치 내 중복 방지)
        this.existingDocumentNumbers.add(ruling.documentNumber);
      } catch (error) {
        // 개별 예규 상세 조회 실패 시 건너뛰고 계속 진행
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`예규 상세 조회 실패 (rulingId: ${item.rulingId}): ${errorMessage}`);
      }
    }

    return rulings;
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
   * 예규 목록 XML 응답 파싱
   */
  private parseRulingListXml(xml: string): RulingListItem[] {
    const items: RulingListItem[] = [];
    const rulingPattern = /<ruling>([\s\S]*?)<\/ruling>|<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = rulingPattern.exec(xml)) !== null) {
      const block = match[1] || match[2];
      const rulingId = this.extractXmlValue(block, '일련번호') ||
                       this.extractXmlValue(block, 'rulingId') || '';
      const documentNumber = this.extractXmlValue(block, '문서번호') ||
                             this.extractXmlValue(block, 'documentNumber') || '';
      const title = this.extractXmlValue(block, '제목') ||
                    this.extractXmlValue(block, 'title') || '';
      const replyDate = this.extractXmlValue(block, '회신일자') ||
                        this.extractXmlValue(block, 'replyDate') || '';
      const documentType = this.extractXmlValue(block, '문서유형') ||
                           this.extractXmlValue(block, 'documentType') || '';

      if (rulingId || documentNumber) {
        items.push({
          rulingId,
          documentNumber,
          title,
          replyDate: this.formatDate(replyDate),
          documentType,
        });
      }
    }

    return items;
  }

  /**
   * 예규 상세 XML 응답 파싱
   */
  private parseRulingDetailXml(xml: string, rulingId: string, category: string): TaxRuling {
    const documentNumber = this.extractXmlValue(xml, '문서번호') ||
                           this.extractXmlValue(xml, 'documentNumber') || '';
    const replyDate = this.extractXmlValue(xml, '회신일자') ||
                      this.extractXmlValue(xml, 'replyDate') || '';
    const documentTypeStr = this.extractXmlValue(xml, '문서유형') ||
                            this.extractXmlValue(xml, 'documentType') || '';
    const querySummary = this.extractXmlValue(xml, '질의요지') ||
                         this.extractXmlValue(xml, 'querySummary') || '';
    const replyContent = this.extractXmlValue(xml, '회신내용') ||
                         this.extractXmlValue(xml, 'replyContent') || '';
    const referencedLawsRaw = this.extractXmlValue(xml, '참조조문') ||
                              this.extractXmlValue(xml, 'referencedLaws') || '';

    // 참조 세법 조항 파싱
    const referencedLawArticles = referencedLawsRaw
      ? referencedLawsRaw
          .split(/[,\n;]/)
          .map(law => law.trim())
          .filter(law => law.length > 0)
      : [];

    return {
      documentNumber: this.cleanContent(documentNumber),
      replyDate: this.formatDate(replyDate),
      documentType: this.mapDocumentType(documentTypeStr),
      taxCategory: CATEGORY_TO_TAX_TYPE[category] || 'acquisition',
      querySummary: this.cleanContent(querySummary),
      replyContent: this.cleanContent(replyContent),
      referencedLawArticles,
      metadata: {
        rulingId,
        source: 'NTS',
        collectedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * 문서 유형 문자열을 RulingType으로 변환
   */
  private mapDocumentType(typeStr: string): RulingType {
    if (typeStr.includes('유권해석') || typeStr.includes('해석')) {
      return 'authoritative_interpretation';
    }
    if (typeStr.includes('심판') || typeStr.includes('심판례')) {
      return 'tribunal_decision';
    }
    return 'ruling';
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
   * 콘텐츠 정리
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
