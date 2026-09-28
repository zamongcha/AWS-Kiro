/**
 * 판례 검색 클라이언트 (CaseSearchClient)
 *
 * 위험 조항별 유사 분쟁 판례를 기존 판례 검색 서비스(real-estate-case-search)에서
 * 조회하기 위한 클라이언트이다. 판례 검색 서비스 접근은 다음 중 하나로 수행한다.
 *
 *   1. 내부 호출: `CaseSearchInvoker`(판례 검색 오케스트레이터 등 내부 진입점) 주입
 *   2. Mock 폴백: 내부 호출 대상이 주입되지 않은 로컬/테스트 환경에서 사용
 *
 * 클라이언트는 위험 조항 1건에 대한 검색 요청을 판례 검색 서비스 입력 형식으로
 * 변환하고, 반환된 판례 분석 결과를 계약서 분석용 `LinkedCase` 목록으로 매핑한다.
 * 매핑 시 다음 규칙을 적용한다.
 *
 *   - 조항당 판례 수는 최대 3건으로 제한한다 (Property 24).
 *   - 각 판례 원문 링크가 유효한 전체 URL이면 `urlVerified=true`, 아니면 false.
 *
 * 타임아웃/오류 처리(10초 폴백)는 상위 `CaseLinkerModule`이 담당하며, 이 클라이언트는
 * 검색 요청과 결과 매핑만 책임진다.
 *
 * @module CaseSearchClient
 * @requirements 7.3, 7.4, 7.7
 */

import type { RiskClause } from '../interfaces/risk-detector.js';
import type { LinkedCase } from '../interfaces/case-linker.js';

/** 조항당 연동 판례 최대 개수 (Property 24, 요구사항 7.3) */
export const MAX_CASES_PER_CLAUSE = 3;

/**
 * 판례 검색 서비스 조회 결과의 개별 판례 요약
 *
 * 판례 검색 서비스가 반환하는 구조에서 계약서 판례 연동에 필요한 최소 필드만
 * 추린 정규화 형태이다. 내부 호출 어댑터가 판례 검색 서비스 응답을 이 형태로
 * 정규화하여 클라이언트에 전달한다.
 */
export interface CaseSearchHit {
  /** 사건번호 */
  caseNumber: string;
  /** 법원명 */
  courtName: string;
  /** 판결 요지 */
  judgmentSummary: string;
  /** 판례 원문 링크 (없거나 유효하지 않을 수 있음) */
  originalUrl?: string;
}

/**
 * 판례 검색 내부 호출 인터페이스
 *
 * 기존 판례 검색 서비스(real-estate-case-search)의 공개 진입점을 추상화한다.
 * 어댑터는 위험 조항 검색 문구를 판례 검색 서비스 입력으로 변환하여 호출하고,
 * 응답을 `CaseSearchHit[]`로 정규화하여 반환한다.
 */
export interface CaseSearchInvoker {
  /**
   * 사실관계 유사 판례를 조회한다.
   *
   * @param situationDescription - 위험 조항으로부터 구성한 상황 설명 문구
   * @returns 정규화된 판례 조회 결과 목록
   */
  searchSimilarCases(situationDescription: string): Promise<CaseSearchHit[]>;
}

/**
 * 판례 검색 클라이언트 설정
 */
export interface CaseSearchClientConfig {
  /** 판례 검색 내부 호출 어댑터 (미주입 시 Mock 폴백 사용) */
  invoker?: CaseSearchInvoker;
  /** 조항당 최대 판례 수 (기본 3) */
  maxCasesPerClause?: number;
}

/**
 * 판례 검색 클라이언트
 *
 * @requirements 7.3, 7.4, 7.7
 */
export class CaseSearchClient {
  private readonly invoker: CaseSearchInvoker;
  private readonly maxCasesPerClause: number;

  constructor(config: CaseSearchClientConfig = {}) {
    this.invoker = config.invoker ?? new MockCaseSearchInvoker();
    this.maxCasesPerClause = config.maxCasesPerClause ?? MAX_CASES_PER_CLAUSE;
  }

  /**
   * 단일 위험 조항에 대한 유사 분쟁 판례를 조회한다.
   *
   * 위험 조항 정보(위험 유형·사유·원문)를 상황 설명 문구로 구성하여 판례 검색
   * 서비스를 호출하고, 반환된 판례를 `LinkedCase`로 매핑한다. 조항당 판례 수는
   * 최대 3건으로 제한하며(Property 24), 각 판례의 원문 링크 유효성을 확인하여
   * `urlVerified`를 설정한다.
   *
   * 판례 검색 서비스 호출에서 발생한 오류는 그대로 전파되며, 타임아웃/폴백은
   * 상위 모듈이 처리한다.
   *
   * @param clause - 위험 조항
   * @returns 조항에 연동된 판례 목록 (최대 3건)
   *
   * @requirements 7.3, 7.4, 7.7
   */
  async searchForClause(clause: RiskClause): Promise<LinkedCase[]> {
    const situationDescription = this.buildSituationDescription(clause);
    const hits = await this.invoker.searchSimilarCases(situationDescription);

    return hits
      .slice(0, this.maxCasesPerClause)
      .map((hit) => this.toLinkedCase(hit));
  }

  /**
   * 위험 조항 정보를 판례 검색 서비스 입력용 상황 설명 문구로 변환한다.
   *
   * 위험 유형·사유·원문 매칭 텍스트를 조합하여 사실관계 검색 문구를 구성한다.
   *
   * @param clause - 위험 조항
   * @returns 상황 설명 문구
   */
  private buildSituationDescription(clause: RiskClause): string {
    const parts = [clause.riskType, clause.riskReason, clause.span?.matchedText]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter((part) => part.length > 0);
    return parts.join(' ');
  }

  /**
   * 정규화된 판례 조회 결과를 연동 판례(`LinkedCase`)로 변환한다.
   *
   * 원문 링크가 유효한 전체 URL이면 `urlVerified=true`, 그렇지 않으면 false로
   * 표시하며, 링크를 확인할 수 없는 경우 빈 문자열로 대체한다(요구사항 7.7).
   *
   * @param hit - 정규화된 판례 조회 결과
   * @returns 연동 판례
   *
   * @requirements 7.4, 7.7
   */
  private toLinkedCase(hit: CaseSearchHit): LinkedCase {
    const url = typeof hit.originalUrl === 'string' ? hit.originalUrl.trim() : '';
    const urlVerified = isValidFullUrl(url);
    return {
      caseNumber: hit.caseNumber ?? '',
      courtName: hit.courtName ?? '',
      judgmentSummary: hit.judgmentSummary ?? '',
      originalUrl: urlVerified ? url : '',
      urlVerified,
    };
  }
}

/**
 * 판례 원문 링크가 유효한 전체 URL 형식인지 확인한다.
 *
 * 접근 가능한 형식(전체 URL)의 판정은 다음 조건을 모두 만족하는 경우로 한다.
 *   - `URL`로 파싱 가능
 *   - 프로토콜이 http 또는 https
 *   - 호스트명이 존재
 *
 * @param url - 확인할 URL 문자열
 * @returns 유효한 전체 URL이면 true, 아니면 false
 *
 * @requirements 7.7
 */
export function isValidFullUrl(url: string): boolean {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(url.trim());
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Mock 판례 검색 어댑터
 *
 * 내부 호출 대상(판례 검색 서비스 진입점)이 주입되지 않은 로컬/테스트 환경에서
 * 사용하는 폴백 구현이다. 상황 설명 문구를 기반으로 결정적 판례 목록을 생성하여
 * 반환한다. 실제 판례 데이터가 아니므로 운영 환경에서는 내부 호출 어댑터를
 * 주입해야 한다.
 */
export class MockCaseSearchInvoker implements CaseSearchInvoker {
  private readonly baseUrl = 'https://glaw.scourt.go.kr/wsjo/panre/sjo100.do';

  /**
   * 상황 설명 문구에 대한 결정적 Mock 판례 목록을 반환한다.
   *
   * @param situationDescription - 상황 설명 문구
   * @returns Mock 판례 조회 결과 (최대 3건)
   */
  async searchSimilarCases(situationDescription: string): Promise<CaseSearchHit[]> {
    const seed = hashString(situationDescription);
    const count = (seed % 3) + 1; // 1~3건
    const hits: CaseSearchHit[] = [];
    for (let i = 0; i < count; i += 1) {
      const year = 2018 + ((seed + i) % 6);
      const serial = 10000 + ((seed * (i + 7)) % 90000);
      const caseNumber = `${year}다${serial}`;
      hits.push({
        caseNumber,
        courtName: i === 0 ? '대법원' : '서울고등법원',
        judgmentSummary: `유사 분쟁 판례 요지 (${caseNumber})`,
        originalUrl: `${this.baseUrl}?caseNm=${encodeURIComponent(caseNumber)}`,
      });
    }
    return hits;
  }
}

/**
 * 문자열을 결정적 정수 해시로 변환한다 (Mock 생성용).
 *
 * @param value - 입력 문자열
 * @returns 음이 아닌 정수 해시
 */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
