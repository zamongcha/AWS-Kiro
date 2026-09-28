/**
 * 필드 추출기 (FieldExtractor)
 *
 * 계약서 전체 인식 텍스트(fullText)에서 보증금·월세·매매가·관리비·계약기간·
 * 당사자·소재지·면적을 정규식/키워드 기반으로 구조화 추출한다. 금액은 아라비아
 * 숫자 표기와 한글(만/억 단위) 표기를 모두 인식한다.
 *
 * 주요 규칙:
 *   - Property 26: 금액 필드(보증금/월세/매매가/관리비)의 단위는 'KRW',
 *     면적은 'sqm', 계약 기간은 'month'로 부여한다.
 *   - Property 27: 값을 확인할 수 없는 항목은 isConfirmable=false("확인 불가")로
 *     표시하고, 확인 가능한 나머지 항목은 정상적으로 계속 추출한다.
 *
 * 본 추출기는 항상 8개 필드를 결과로 반환하며, 확인 불가 항목의 value는 null,
 * isConfirmable은 false로 표시한다.
 *
 * @module FieldExtractor
 * @requirements 9.1, 9.2, 9.4
 */

import type { ExtractedField } from '../interfaces/index.js';

/** 정보 추출기 표준 필드명 상수 */
export const FIELD_NAMES = {
  /** 보증금 */
  DEPOSIT: '보증금',
  /** 월세 */
  MONTHLY_RENT: '월세',
  /** 매매가 */
  SALE_PRICE: '매매가',
  /** 관리비 */
  MANAGEMENT_FEE: '관리비',
  /** 계약 기간 */
  CONTRACT_PERIOD: '계약기간',
  /** 계약 당사자 */
  PARTIES: '당사자',
  /** 목적물 소재지 */
  LOCATION: '소재지',
  /** 목적물 면적 */
  AREA: '면적',
} as const;

/** 금액 필드에 부여되는 단위 (Property 26) */
export const AMOUNT_UNIT = 'KRW' as const;
/** 면적 필드에 부여되는 단위 (Property 26) */
export const AREA_UNIT = 'sqm' as const;
/** 계약 기간 필드에 부여되는 단위 (Property 26) */
export const PERIOD_UNIT = 'month' as const;

/** 3.3제곱미터 = 1평 (평 → 제곱미터 변환 계수) */
const PYEONG_TO_SQM = 3.305_785;

/**
 * 필드 추출기
 *
 * @requirements 9.1, 9.2, 9.4
 */
export class FieldExtractor {
  /**
   * 계약서 전체 텍스트에서 8개 핵심 필드를 추출한다.
   *
   * 모든 필드는 결과에 항상 포함되며, 텍스트에서 값을 확인할 수 없는 항목은
   * isConfirmable=false로 표시된다(Property 27). 금액/면적/기간 필드에는
   * 각각 KRW/sqm/month 단위가 부여된다(Property 26).
   *
   * @param fullText - 계약서 전체 인식 텍스트
   * @returns 추출된 필드 목록 (항상 8개)
   *
   * @requirements 9.1, 9.4
   */
  extract(fullText: string): ExtractedField[] {
    const text = typeof fullText === 'string' ? fullText : '';

    return [
      this.buildAmountField(FIELD_NAMES.DEPOSIT, this.extractAmount(text, ['보증금', '전세금', '임차보증금'])),
      this.buildAmountField(FIELD_NAMES.MONTHLY_RENT, this.extractAmount(text, ['월세', '차임', '월 차임', '월임대료'])),
      this.buildAmountField(FIELD_NAMES.SALE_PRICE, this.extractAmount(text, ['매매대금', '매매가', '매매금액'])),
      this.buildAmountField(FIELD_NAMES.MANAGEMENT_FEE, this.extractAmount(text, ['관리비'])),
      this.buildPeriodField(FIELD_NAMES.CONTRACT_PERIOD, this.extractPeriod(text)),
      this.buildTextField(FIELD_NAMES.PARTIES, this.extractParties(text)),
      this.buildTextField(FIELD_NAMES.LOCATION, this.extractLocation(text)),
      this.buildAreaField(FIELD_NAMES.AREA, this.extractArea(text)),
    ];
  }

  /**
   * 금액 필드를 구성한다. 값이 없으면 isConfirmable=false 처리한다.
   *
   * @param fieldName - 필드명
   * @param value - 추출된 금액(원) 또는 null
   * @returns 추출 필드
   */
  private buildAmountField(fieldName: string, value: number | null): ExtractedField {
    if (value === null) {
      return { fieldName, value: null, unit: AMOUNT_UNIT, isConfirmable: false };
    }
    return { fieldName, value, unit: AMOUNT_UNIT, isConfirmable: true };
  }

  /**
   * 계약 기간 필드를 구성한다(단위 month).
   *
   * @param fieldName - 필드명
   * @param value - 추출된 개월 수 또는 null
   * @returns 추출 필드
   */
  private buildPeriodField(fieldName: string, value: number | null): ExtractedField {
    if (value === null) {
      return { fieldName, value: null, unit: PERIOD_UNIT, isConfirmable: false };
    }
    return { fieldName, value, unit: PERIOD_UNIT, isConfirmable: true };
  }

  /**
   * 면적 필드를 구성한다(단위 sqm).
   *
   * @param fieldName - 필드명
   * @param value - 추출된 제곱미터 값 또는 null
   * @returns 추출 필드
   */
  private buildAreaField(fieldName: string, value: number | null): ExtractedField {
    if (value === null) {
      return { fieldName, value: null, unit: AREA_UNIT, isConfirmable: false };
    }
    return { fieldName, value, unit: AREA_UNIT, isConfirmable: true };
  }

  /**
   * 단위가 없는 텍스트 필드(당사자/소재지)를 구성한다.
   *
   * @param fieldName - 필드명
   * @param value - 추출된 문자열 또는 null
   * @returns 추출 필드
   */
  private buildTextField(fieldName: string, value: string | null): ExtractedField {
    if (value === null || value.trim().length === 0) {
      return { fieldName, value: null, isConfirmable: false };
    }
    return { fieldName, value: value.trim(), isConfirmable: true };
  }

  /**
   * 주어진 키워드 인근에서 금액을 추출한다.
   *
   * 아라비아 숫자(쉼표 포함, 원/만원/억 단위)와 한글 표기(예: "일억 오천만원")를
   * 모두 지원한다. 여러 키워드 중 가장 먼저 매칭되는 값을 사용한다.
   *
   * @param text - 전체 텍스트
   * @param keywords - 탐색할 키워드 목록
   * @returns 원 단위 정수 금액, 확인 불가 시 null
   */
  private extractAmount(text: string, keywords: string[]): number | null {
    for (const keyword of keywords) {
      const idx = text.indexOf(keyword);
      if (idx < 0) {
        continue;
      }
      // 키워드 이후 최대 40자 구간에서 금액 표현을 탐색한다.
      const window = text.slice(idx + keyword.length, idx + keyword.length + 40);
      const amount = this.parseAmountExpression(window);
      if (amount !== null) {
        return amount;
      }
    }
    return null;
  }

  /**
   * 금액 표현 문자열을 원 단위 정수로 파싱한다.
   *
   * 한글 단위 표기("억", "만")를 우선 시도하고, 실패 시 아라비아 숫자
   * (쉼표 제거 후 "억"/"만원"/"원" 접미사)를 해석한다.
   *
   * @param expr - 금액 표현이 포함된 문자열
   * @returns 원 단위 정수 금액, 파싱 불가 시 null
   */
  private parseAmountExpression(expr: string): number | null {
    const korean = this.parseKoreanAmount(expr);
    if (korean !== null) {
      return korean;
    }
    return this.parseNumericAmount(expr);
  }

  /**
   * 아라비아 숫자 기반 금액을 파싱한다.
   *
   * "3억", "5,000만원", "500000원" 등을 인식하며, 억/만 접미사를 곱해
   * 원 단위로 환산한다. 접미사가 없으면 원 단위 정수로 간주한다.
   *
   * @param expr - 금액 표현 문자열
   * @returns 원 단위 정수 금액, 파싱 불가 시 null
   */
  private parseNumericAmount(expr: string): number | null {
    // 억/만 단위가 조합된 표기 (예: 3억 5,000만) 우선 처리
    const eokManMatch = expr.match(/(\d[\d,]*)\s*억(?:\s*(\d[\d,]*)\s*만)?/);
    if (eokManMatch) {
      const eok = this.toInt(eokManMatch[1]);
      const man = eokManMatch[2] !== undefined ? this.toInt(eokManMatch[2]) : 0;
      if (eok !== null) {
        return eok * 100_000_000 + (man ?? 0) * 10_000;
      }
    }

    const manMatch = expr.match(/(\d[\d,]*)\s*만\s*원?/);
    if (manMatch) {
      const man = this.toInt(manMatch[1]);
      if (man !== null) {
        return man * 10_000;
      }
    }

    const wonMatch = expr.match(/(\d[\d,]*)\s*원/);
    if (wonMatch) {
      const won = this.toInt(wonMatch[1]);
      if (won !== null) {
        return won;
      }
    }

    return null;
  }

  /**
   * 한글 수사 기반 금액을 파싱한다 (예: "일억오천만원").
   *
   * 억/만 단위와 일~구 수사를 조합하여 원 단위로 환산한다. 순수 한글
   * 수사 표현이 없으면 null을 반환한다.
   *
   * @param expr - 금액 표현 문자열
   * @returns 원 단위 정수 금액, 파싱 불가 시 null
   */
  private parseKoreanAmount(expr: string): number | null {
    // 한글 수사가 포함되지 않으면 처리하지 않는다.
    if (!/[일이삼사오육칠팔구십백천억만]/.test(expr)) {
      return null;
    }
    // 아라비아 숫자가 섞여 있으면 숫자 파서에 위임한다.
    if (/\d/.test(expr)) {
      return null;
    }

    const digitMap: Record<string, number> = {
      일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9,
    };
    const smallUnitMap: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };

    let total = 0; // 누적 합계
    let section = 0; // 억/만 구간 내 부분 합
    let current = 0; // 현재 수사 값

    for (const ch of expr) {
      if (digitMap[ch] !== undefined) {
        current = digitMap[ch];
        continue;
      }
      if (smallUnitMap[ch] !== undefined) {
        section += (current === 0 ? 1 : current) * smallUnitMap[ch];
        current = 0;
        continue;
      }
      if (ch === '만') {
        section = (section + current) * 10_000;
        total += section;
        section = 0;
        current = 0;
        continue;
      }
      if (ch === '억') {
        section = (section + current) * 100_000_000;
        total += section;
        section = 0;
        current = 0;
        continue;
      }
      // 그 외 문자는 수사 종료 신호로 간주하고 탐색을 멈춘다.
      if (ch === '원') {
        break;
      }
    }
    total += section + current;
    return total > 0 ? total : null;
  }

  /**
   * 쉼표를 제거한 뒤 정수로 변환한다.
   *
   * @param raw - 숫자 문자열
   * @returns 정수 또는 null
   */
  private toInt(raw: string | undefined): number | null {
    if (raw === undefined) {
      return null;
    }
    const cleaned = raw.replace(/,/g, '');
    if (cleaned.length === 0 || !/^\d+$/.test(cleaned)) {
      return null;
    }
    const parsed = Number.parseInt(cleaned, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * 계약 기간을 개월 단위로 추출한다.
   *
   * "24개월", "2년" 표기를 인식하며 년 표기는 12를 곱해 개월로 환산한다.
   *
   * @param text - 전체 텍스트
   * @returns 개월 수 정수, 확인 불가 시 null
   */
  private extractPeriod(text: string): number | null {
    const monthMatch = text.match(/(\d+)\s*개월/);
    if (monthMatch) {
      const months = this.toInt(monthMatch[1]);
      if (months !== null) {
        return months;
      }
    }

    const yearMonthMatch = text.match(/(\d+)\s*년\s*(\d+)?\s*개?월?/);
    if (yearMonthMatch) {
      const years = this.toInt(yearMonthMatch[1]);
      const extraMonths = yearMonthMatch[2] !== undefined ? this.toInt(yearMonthMatch[2]) : 0;
      if (years !== null) {
        return years * 12 + (extraMonths ?? 0);
      }
    }

    return null;
  }

  /**
   * 목적물 면적을 제곱미터 단위로 추출한다.
   *
   * "84.5㎡", "85m2" 등의 제곱미터 표기를 우선 인식하고, "25평" 표기는
   * 평→제곱미터 변환 계수를 적용해 환산한다.
   *
   * @param text - 전체 텍스트
   * @returns 제곱미터 값, 확인 불가 시 null
   */
  private extractArea(text: string): number | null {
    const sqmMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m2|m²|제곱미터)/i);
    if (sqmMatch) {
      const value = Number.parseFloat(sqmMatch[1]);
      if (Number.isFinite(value)) {
        return value;
      }
    }

    const pyeongMatch = text.match(/(\d+(?:\.\d+)?)\s*평/);
    if (pyeongMatch) {
      const pyeong = Number.parseFloat(pyeongMatch[1]);
      if (Number.isFinite(pyeong)) {
        return Math.round(pyeong * PYEONG_TO_SQM * 100) / 100;
      }
    }

    return null;
  }

  /**
   * 계약 당사자(임대인/임차인/매도인/매수인 등)를 추출한다.
   *
   * 대표 역할 키워드 뒤의 인명/상호로 보이는 토큰을 수집하여 쉼표로 연결한다.
   *
   * @param text - 전체 텍스트
   * @returns 당사자 요약 문자열, 확인 불가 시 null
   */
  private extractParties(text: string): string | null {
    const roles = ['임대인', '임차인', '매도인', '매수인'];
    const parties: string[] = [];
    for (const role of roles) {
      const pattern = new RegExp(`${role}\\s*[:：]?\\s*([가-힣A-Za-z0-9()·\\s]{1,20})`);
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim().split(/\s{2,}|\n/)[0]?.trim();
        if (name && name.length > 0) {
          parties.push(`${role} ${name}`);
        }
      }
    }
    return parties.length > 0 ? parties.join(', ') : null;
  }

  /**
   * 목적물 소재지를 추출한다.
   *
   * "소재지", "주소", "목적물의 표시" 키워드 뒤의 주소 문자열을 수집한다.
   *
   * @param text - 전체 텍스트
   * @returns 소재지 문자열, 확인 불가 시 null
   */
  private extractLocation(text: string): string | null {
    const keywords = ['소재지', '목적물의 표시', '목적물 소재지', '주소'];
    for (const keyword of keywords) {
      const idx = text.indexOf(keyword);
      if (idx < 0) {
        continue;
      }
      const rest = text.slice(idx + keyword.length, idx + keyword.length + 60);
      const cleaned = rest.replace(/^[\s:：]+/, '').split(/\n|\r/)[0]?.trim();
      if (cleaned && cleaned.length > 0) {
        return cleaned;
      }
    }
    return null;
  }
}
