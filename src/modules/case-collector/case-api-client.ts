/**
 * @fileoverview 대법원 종합법률정보 API 클라이언트
 * @description 판례 목록 조회, 상세 조회 기능을 제공한다.
 * XML 응답을 구조화된 CourtCase[] 형태로 파싱한다.
 *
 * @requirements 2.1 - 대법원 종합법률정보 시스템 연동하여 부동산 관련 판례 수집
 * @requirements 2.2 - 임대차, 매매, 등기, 중개, 재건축/재개발 분쟁 카테고리별 수집
 * @requirements 2.3 - 사건번호, 선고일자, 법원명, 사건 유형, 판결 요지, 판결 전문, 참조 법령 구조화
 * @requirements 2.5 - 30초 고정 간격, 최대 3회 재시도
 * @requirements 2.8 - 동일 사건번호 존재 시 신규 저장 생략 (중복 판별)
 */

import { CourtCase } from '../../common/interfaces/index.js';
import { executeWithRetry, CASE_COLLECTOR_RETRY_POLICY } from '../../common/utils/index.js';

/**
 * 판례 목록 조회 결과 항목
 */
export interface CaseListItem {
  /** 판례 ID (일련번호) */
  caseId: string;
  /** 사건번호 */
  caseNumber: string;
  /** 사건명 */
  caseName: string;
  /** 선고일자 */
  date: string;
  /** 법원명 */
  court: string;
}

/**
 * API 클라이언트 설정
 */
export interface CaseApiClientConfig {
  /** API 기본 URL */
  baseUrl: string;
  /** API 인증 키 (OC 파라미터) */
  apiKey: string;
  /** 요청 타임아웃 (밀리초) */
  timeoutMs: number;
}

/**
 * 판례 수집 대상 카테고리 목록
 *
 * 부동산 법률 AI 자문 시스템에서 활용하는 판례 5종 카테고리를 정의한다.
 */
export const TARGET_CATEGORIES: string[] = [
  '임대차 분쟁',
  '매매 분쟁',
  '등기 분쟁',
  '중개 분쟁',
  '재건축/재개발 분쟁',
];

/** 기본 API 설정 */
const DEFAULT_CONFIG: CaseApiClientConfig = {
  baseUrl: 'https://www.law.go.kr/DRF/lawSearch.do',
  apiKey: '',
  timeoutMs: 30000,
};

/**
 * 대법원 종합법률정보 API 클라이언트
 *
 * 판례 목록 검색, 상세 조회를 수행하며,
 * 각 API 호출에 재시도 정책(30초 고정 간격, 최대 3회)을 적용한다.
 */
export class CaseApiClient {
  private config: CaseApiClientConfig;
  /** 이미 수집된 사건번호 집합 (중복 판별용) */
  private existingCaseNumbers: Set<string> = new Set();

  constructor(config: Partial<CaseApiClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 기존 사건번호 목록을 설정하여 중복 판별에 활용
   *
   * @param caseNumbers - 이미 저장된 사건번호 목록
   */
  setExistingCaseNumbers(caseNumbers: string[]): void {
    this.existingCaseNumbers = new Set(caseNumbers);
  }

  /**
   * 사건번호 중복 여부 확인
   *
   * @param caseNumber - 확인할 사건번호
   * @returns 이미 존재하면 true, 신규이면 false
   */
  isDuplicate(caseNumber: string): boolean {
    return this.existingCaseNumbers.has(caseNumber);
  }

  /**
   * 판례 목록 조회
   * 지정된 카테고리(검색어)로 대법원 종합법률정보에서 매칭되는 판례 목록을 조회한다.
   *
   * @param category - 검색 카테고리 (예: '임대차 분쟁')
   * @param page - 페이지 번호 (기본값: 1)
   * @returns 매칭되는 판례 목록
   */
  async fetchCaseList(category: string, page: number = 1): Promise<CaseListItem[]> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.apiKey,
        target: 'prec',
        type: 'XML',
        query: category,
        page: String(page),
      });

      const url = `${this.config.baseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseCaseListXml(response);
    }, CASE_COLLECTOR_RETRY_POLICY);
  }

  /**
   * 판례 상세 조회
   * 판례 ID를 기반으로 판결 전문을 포함한 상세 정보를 조회한다.
   *
   * @param caseId - 판례 고유 ID (일련번호)
   * @returns 구조화된 판례 데이터
   */
  async fetchCaseDetail(caseId: string): Promise<CourtCase> {
    return executeWithRetry(async () => {
      const params = new URLSearchParams({
        OC: this.config.apiKey,
        target: 'prec',
        type: 'XML',
        ID: caseId,
      });

      const url = `${this.config.baseUrl}?${params.toString()}`;
      const response = await this.makeRequest(url);
      return this.parseCaseDetailXml(response, caseId);
    }, CASE_COLLECTOR_RETRY_POLICY);
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
   * 판례 목록 XML 응답 파싱
   * XML 응답에서 판례 항목들을 추출하여 CaseListItem[]으로 반환한다.
   */
  private parseCaseListXml(xml: string): CaseListItem[] {
    const items: CaseListItem[] = [];
    const casePattern = /<prec>([\s\S]*?)<\/prec>/g;
    let match: RegExpExecArray | null;

    while ((match = casePattern.exec(xml)) !== null) {
      const caseBlock = match[1];
      const caseId = this.extractXmlValue(caseBlock, '판례일련번호') ||
                     this.extractXmlValue(caseBlock, 'precId') || '';
      const caseNumber = this.extractXmlValue(caseBlock, '사건번호') ||
                         this.extractXmlValue(caseBlock, 'caseNumber') || '';
      const caseName = this.extractXmlValue(caseBlock, '사건명') ||
                       this.extractXmlValue(caseBlock, 'caseName') || '';
      const date = this.extractXmlValue(caseBlock, '선고일자') ||
                   this.extractXmlValue(caseBlock, 'date') || '';
      const court = this.extractXmlValue(caseBlock, '법원명') ||
                    this.extractXmlValue(caseBlock, 'court') || '';

      if (caseId || caseNumber) {
        items.push({ caseId, caseNumber, caseName, date, court });
      }
    }

    return items;
  }

  /**
   * 판례 상세 XML 응답 파싱
   * 판례 상세 XML에서 전문, 요지, 참조 법령 등을 추출하여 CourtCase로 변환한다.
   */
  private parseCaseDetailXml(xml: string, caseId: string): CourtCase {
    const caseNumber = this.extractXmlValue(xml, '사건번호') ||
                       this.extractXmlValue(xml, 'caseNumber') || '';
    const court = this.extractXmlValue(xml, '법원명') ||
                  this.extractXmlValue(xml, 'court') || '';
    const date = this.extractXmlValue(xml, '선고일자') ||
                 this.extractXmlValue(xml, 'date') || '';
    const summary = this.extractXmlValue(xml, '판례내용') ||
                    this.extractXmlValue(xml, '판시사항') ||
                    this.extractXmlValue(xml, 'summary') || '';
    const fullText = this.extractXmlValue(xml, '전문') ||
                     this.extractXmlValue(xml, '판결요지') ||
                     this.extractXmlValue(xml, 'fullText') || '';
    const relatedLawsRaw = this.extractXmlValue(xml, '참조조문') ||
                           this.extractXmlValue(xml, 'relatedLaws') || '';
    const caseName = this.extractXmlValue(xml, '사건명') ||
                     this.extractXmlValue(xml, 'caseName') || '';

    // 참조 법령 파싱 (쉼표 또는 줄바꿈으로 구분)
    const relatedLaws = relatedLawsRaw
      ? relatedLawsRaw
          .split(/[,\n]/)
          .map(law => law.trim())
          .filter(law => law.length > 0)
      : [];

    // 키워드 추출 (사건명에서 추출)
    const keywords = this.extractKeywords(caseName);

    return {
      id: caseId,
      caseNumber: this.cleanContent(caseNumber),
      court: this.cleanContent(court),
      date: this.formatDate(date),
      summary: this.cleanContent(summary),
      fullText: this.cleanContent(fullText),
      keywords,
      relatedLaws,
    };
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
   * 사건명에서 키워드 추출
   * 괄호, 쉼표 등으로 구분된 키워드를 분리한다.
   */
  private extractKeywords(caseName: string): string[] {
    if (!caseName) return [];

    return caseName
      .replace(/[()[\]]/g, ' ')
      .split(/[,·\s]+/)
      .map(kw => kw.trim())
      .filter(kw => kw.length > 1);
  }

  /**
   * 날짜 문자열을 ISO 8601 형식으로 변환
   * 입력: 'YYYYMMDD' 또는 'YYYY-MM-DD' 또는 'YYYY.MM.DD' 형식
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
