/**
 * 수치 정보 추출기 모듈
 *
 * 질문 텍스트에서 세무 관련 수치 정보를 추출한다.
 * 금액(원, 만원, 억원), 면적(㎡, 평), 기간(년, 개월),
 * 주택 수, 공시가격 등 세무 관련 수치 패턴을 인식한다.
 *
 * @module NumericExtractor
 * @requirements 3.7, 11.7
 */

import type { ExtractedNumericInfo } from '../interfaces/index.js';

/**
 * 수치 추출기 클래스
 *
 * 한국어 텍스트에서 세무 관련 수치 패턴을 정규식으로 추출한다.
 * 다양한 한국어 숫자 표기법(한글, 아라비아, 혼합)을 지원한다.
 */
export class NumericExtractor {
  /**
   * 텍스트에서 세무 관련 수치 정보를 추출한다.
   *
   * @param text - 분석할 텍스트
   * @returns 추출된 수치 정보 (ExtractedNumericInfo)
   *
   * @requirements 3.7
   */
  extract(text: string): ExtractedNumericInfo {
    if (!text || text.trim().length === 0) {
      return {};
    }

    const normalizedText = text.replace(/,/g, '').replace(/\s+/g, ' ').trim();

    const result: ExtractedNumericInfo = {};

    // 공시가격 추출 (금액보다 먼저 처리)
    const officialPrice = this.extractOfficialPrice(normalizedText);
    if (officialPrice !== undefined) {
      result.officialPrice = officialPrice;
    }

    // 취득가액 추출
    const acquisitionPrice = this.extractAcquisitionPrice(normalizedText);
    if (acquisitionPrice !== undefined) {
      result.acquisitionPrice = acquisitionPrice;
    }

    // 양도가액 추출
    const transferPrice = this.extractTransferPrice(normalizedText);
    if (transferPrice !== undefined) {
      result.transferPrice = transferPrice;
    }

    // 일반 금액 추출 (특수 금액이 없는 경우에만)
    if (
      result.officialPrice === undefined &&
      result.acquisitionPrice === undefined &&
      result.transferPrice === undefined
    ) {
      const amount = this.extractAmount(normalizedText);
      if (amount !== undefined) {
        result.amount = amount;
      }
    }

    // 면적 추출
    const area = this.extractArea(normalizedText);
    if (area !== undefined) {
      result.area = area;
    }

    // 보유기간 추출
    const holdingPeriod = this.extractHoldingPeriod(normalizedText);
    if (holdingPeriod !== undefined) {
      result.holdingPeriod = holdingPeriod;
    }

    // 주택 수 추출
    const housingCount = this.extractHousingCount(normalizedText);
    if (housingCount !== undefined) {
      result.housingCount = housingCount;
    }

    // 부동산 유형 추출
    const propertyType = this.extractPropertyType(normalizedText);
    if (propertyType !== undefined) {
      result.propertyType = propertyType;
    }

    return result;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * 금액 패턴을 추출한다.
   * 지원 패턴: "3억원", "5000만원", "1억 2천만원", "300000000원", "3.5억"
   */
  private extractAmount(text: string): number | undefined {
    // 패턴 1: N억 M천만원 / N억 M만원 형태
    const complexPattern = /(\d+(?:\.\d+)?)\s*억\s*(?:(\d+)\s*천)?(?:(\d+))?\s*만?\s*원?/;
    const complexMatch = text.match(complexPattern);
    if (complexMatch) {
      return this.parseComplexAmount(complexMatch);
    }

    // 패턴 2: N억원 / N억
    const billionPattern = /(\d+(?:\.\d+)?)\s*억\s*원?/;
    const billionMatch = text.match(billionPattern);
    if (billionMatch) {
      const value = parseFloat(billionMatch[1]);
      return value * 100000000;
    }

    // 패턴 3: N천만원
    const tenMillionPattern = /(\d+(?:\.\d+)?)\s*천\s*만\s*원?/;
    const tenMillionMatch = text.match(tenMillionPattern);
    if (tenMillionMatch) {
      const value = parseFloat(tenMillionMatch[1]);
      return value * 10000000;
    }

    // 패턴 4: N만원
    const tenThousandPattern = /(\d+(?:\.\d+)?)\s*만\s*원?/;
    const tenThousandMatch = text.match(tenThousandPattern);
    if (tenThousandMatch) {
      const value = parseFloat(tenThousandMatch[1]);
      return value * 10000;
    }

    // 패턴 5: 큰 숫자 + 원 (예: 300000000원)
    const rawPattern = /(\d{6,})\s*원/;
    const rawMatch = text.match(rawPattern);
    if (rawMatch) {
      return parseInt(rawMatch[1], 10);
    }

    return undefined;
  }

  /**
   * 복합 금액 패턴(N억 M천만원)을 파싱한다.
   */
  private parseComplexAmount(match: RegExpMatchArray): number {
    const billions = parseFloat(match[1]) * 100000000;
    const thousands = match[2] ? parseInt(match[2], 10) * 10000000 : 0;
    const manwon = match[3] ? parseInt(match[3], 10) * 10000 : 0;
    return billions + thousands + manwon;
  }

  /**
   * 면적 패턴을 추출한다.
   * 지원 패턴: "84㎡", "84m2", "32평", "59.96제곱미터"
   * 반환값은 항상 ㎡ 단위
   */
  private extractArea(text: string): number | undefined {
    // 패턴 1: N㎡
    const sqmPattern = /(\d+(?:\.\d+)?)\s*(?:㎡|m2|제곱미터|평방미터)/;
    const sqmMatch = text.match(sqmPattern);
    if (sqmMatch) {
      return parseFloat(sqmMatch[1]);
    }

    // 패턴 2: N평 (1평 ≈ 3.3058㎡)
    const pyeongPattern = /(\d+(?:\.\d+)?)\s*평/;
    const pyeongMatch = text.match(pyeongPattern);
    if (pyeongMatch) {
      const pyeong = parseFloat(pyeongMatch[1]);
      return Math.round(pyeong * 3.3058 * 100) / 100;
    }

    return undefined;
  }

  /**
   * 보유기간 패턴을 추출한다.
   * 지원 패턴: "3년", "24개월", "10년 보유", "5년간"
   * 반환값은 항상 년 단위
   */
  private extractHoldingPeriod(text: string): number | undefined {
    // 패턴 1: N년 (보유/거주 컨텍스트)
    const yearPattern = /(\d+(?:\.\d+)?)\s*년\s*(?:보유|거주|동안|간|이상|미만|초과)?/;
    const yearMatch = text.match(yearPattern);
    if (yearMatch) {
      return parseFloat(yearMatch[1]);
    }

    // 패턴 2: N개월
    const monthPattern = /(\d+)\s*개월/;
    const monthMatch = text.match(monthPattern);
    if (monthMatch) {
      return parseInt(monthMatch[1], 10) / 12;
    }

    return undefined;
  }

  /**
   * 주택 수를 추출한다.
   * 지원 패턴: "2주택", "1세대 1주택", "다주택", "3채"
   */
  private extractHousingCount(text: string): number | undefined {
    // 패턴 1: N주택
    const housingPattern = /(\d+)\s*주택/;
    const housingMatch = text.match(housingPattern);
    if (housingMatch) {
      return parseInt(housingMatch[1], 10);
    }

    // 패턴 2: N세대 N주택
    const householdPattern = /\d+\s*세대\s*(\d+)\s*주택/;
    const householdMatch = text.match(householdPattern);
    if (householdMatch) {
      return parseInt(householdMatch[1], 10);
    }

    // 패턴 3: N채
    const unitPattern = /(\d+)\s*채/;
    const unitMatch = text.match(unitPattern);
    if (unitMatch) {
      return parseInt(unitMatch[1], 10);
    }

    // 패턴 4: 다주택 (3채 이상으로 간주)
    if (text.includes('다주택')) {
      return 3;
    }

    return undefined;
  }

  /**
   * 공시가격을 추출한다.
   * 컨텍스트: "공시가격", "공시지가", "기준시가" 뒤의 금액
   */
  private extractOfficialPrice(text: string): number | undefined {
    const officialPricePattern =
      /(?:공시가격|공시지가|기준시가|공시가)\s*(?:이|가)?\s*(\d+(?:\.\d+)?)\s*억?\s*(?:(\d+)\s*천)?(?:(\d+))?\s*만?\s*원?/;
    const match = text.match(officialPricePattern);
    if (match) {
      return this.parseContextualAmount(match);
    }
    return undefined;
  }

  /**
   * 취득가액을 추출한다.
   * 컨텍스트: "취득가액", "매입가", "구입가" 뒤의 금액
   */
  private extractAcquisitionPrice(text: string): number | undefined {
    const acqPattern =
      /(?:취득가액|매입가|취득원가|구입가격|매수가격|취득가)\s*(?:이|가|은|는)?\s*(\d+(?:\.\d+)?)\s*억?\s*(?:(\d+)\s*천)?(?:(\d+))?\s*만?\s*원?/;
    const match = text.match(acqPattern);
    if (match) {
      return this.parseContextualAmount(match);
    }
    return undefined;
  }

  /**
   * 양도가액을 추출한다.
   * 컨텍스트: "양도가액", "매도가", "처분가격" 뒤의 금액
   */
  private extractTransferPrice(text: string): number | undefined {
    const transferPattern =
      /(?:양도가액|매도가|양도가격|매각가격|처분가격|양도가)\s*(?:이|가|은|는)?\s*(\d+(?:\.\d+)?)\s*억?\s*(?:(\d+)\s*천)?(?:(\d+))?\s*만?\s*원?/;
    const match = text.match(transferPattern);
    if (match) {
      return this.parseContextualAmount(match);
    }
    return undefined;
  }

  /**
   * 컨텍스트 기반 금액을 파싱한다.
   * 첫 번째 캡처 그룹이 숫자, 뒤에 억/천/만 단위가 올 수 있음
   */
  private parseContextualAmount(match: RegExpMatchArray): number {
    const baseNum = parseFloat(match[1]);

    // "억"이 포함되어 있는지 전체 매칭에서 확인
    const fullMatch = match[0];
    if (fullMatch.includes('억')) {
      const billions = baseNum * 100000000;
      const thousands = match[2] ? parseInt(match[2], 10) * 10000000 : 0;
      const manwon = match[3] ? parseInt(match[3], 10) * 10000 : 0;
      return billions + thousands + manwon;
    }

    // "천만원" 패턴
    if (fullMatch.includes('천') && fullMatch.includes('만')) {
      return baseNum * 10000000;
    }

    // "만원" 패턴
    if (fullMatch.includes('만')) {
      return baseNum * 10000;
    }

    // "원" 패턴이거나 단위 없음
    if (baseNum >= 1000000) {
      // 큰 숫자는 원 단위로 간주
      return baseNum;
    }

    // 기본: 만원 단위로 간주 (예: "공시가격 9" → 9억)
    if (baseNum <= 100) {
      return baseNum * 100000000;
    }

    return baseNum * 10000;
  }

  /**
   * 부동산 유형을 추출한다.
   * 아파트, 주택, 빌라, 오피스텔, 상가, 토지 등
   */
  private extractPropertyType(text: string): string | undefined {
    const propertyTypes: [string, string][] = [
      ['아파트', 'apartment'],
      ['오피스텔', 'officetel'],
      ['빌라', 'villa'],
      ['단독주택', 'detached_house'],
      ['다세대', 'multi_family'],
      ['다가구', 'multi_household'],
      ['연립주택', 'row_house'],
      ['주택', 'house'],
      ['상가', 'commercial'],
      ['사무실', 'office'],
      ['토지', 'land'],
      ['땅', 'land'],
      ['건물', 'building'],
    ];

    for (const [keyword, type] of propertyTypes) {
      if (text.includes(keyword)) {
        return type;
      }
    }

    return undefined;
  }
}
