/**
 * @fileoverview 세율 테이블 추출 모듈
 * @description 세법 조항에서 세율 테이블 및 계산식을 감지하고 추출하여
 * RateTableData 구조로 변환한다. 세율 구간(bracket)별 rate 0~1 범위 검증,
 * effectiveDate 및 sourceArticle 설정을 포함한다.
 *
 * @requirements 1.9 - 세법 조항에서 세율 테이블 추출
 * @requirements 9.8 - 세율 테이블 버전 관리
 */

import type { TaxLawArticle } from '../interfaces/index.js';
import type { RateTableData, TaxBracket, SpecialRate, Deduction, TaxType } from '../interfaces/index.js';

/**
 * 세율 테이블 추출 결과 인터페이스
 */
export interface RateTableExtractionResult {
  /** 추출 성공 여부 */
  success: boolean;
  /** 추출된 세율 테이블 데이터 */
  rateTable: RateTableData | null;
  /** 추출 실패 사유 */
  errorMessage?: string;
}

/**
 * 세율 테이블 추출기
 *
 * 세법 조항의 내용에서 세율 테이블(과세표준, 세율, 누진공제 등)을 감지하고
 * 구조화된 RateTableData 형태로 추출한다. 추출 후에는 데이터 유효성을 검증한다.
 */
export class RateTableExtractor {
  /** 세율 테이블 감지 키워드 */
  private static readonly RATE_TABLE_KEYWORDS = ['세율', '과세표준', '구간', '누진', '초과', '이하', '이상'];

  /** 금액 패턴: 숫자 + 만원/억원/원 */
  private static readonly AMOUNT_PATTERN = /(\d[\d,]*)(?:\s*)(만원|억원|원)/g;

  /** 세율 패턴: 숫자 + % 또는 퍼센트 */
  private static readonly RATE_PATTERN = /(\d+(?:\.\d+)?)\s*(%|퍼센트)/g;

  /** 구간 패턴: 금액 초과 ~ 금액 이하 */
  private static readonly BRACKET_PATTERN = /([\d,]+)\s*(만원|억원|원)\s*(초과|이상)\s*[~∼-]\s*([\d,]+)\s*(만원|억원|원)\s*(이하|미만)/g;

  /**
   * 세법 조항에서 세율 테이블을 추출한다.
   *
   * 세율 테이블 감지 키워드를 기반으로 테이블 존재 여부를 판단하고,
   * 금액 구간과 세율을 파싱하여 RateTableData 구조로 반환한다.
   *
   * @param article - 세법 조항
   * @returns 추출된 세율 테이블 데이터 또는 null (세율 테이블 미포함 시)
   */
  extractRateTable(article: TaxLawArticle): RateTableData | null {
    // 세율 테이블 포함 여부 확인
    if (!article.hasRateTable && !this.detectRateTable(article.articleContent)) {
      return null;
    }

    const content = article.articleContent;

    // 세율 구간 파싱
    const brackets = this.extractBrackets(content);
    if (brackets.length === 0) {
      return null;
    }

    // 유효성 검증: 모든 rate가 0~1 범위
    const validBrackets = brackets.filter(b => b.rate >= 0 && b.rate <= 1);
    if (validBrackets.length === 0) {
      return null;
    }

    // 특수 세율 추출
    const specialRates = this.extractSpecialRates(content);

    // 공제 항목 추출
    const deductions = this.extractDeductions(content);

    // 적용 세목 결정 (첫 번째 세목 사용)
    const taxType = article.applicableTaxType.length > 0
      ? article.applicableTaxType[0]
      : this.inferTaxType(article.lawName);

    const rateTable: RateTableData = {
      taxType,
      effectiveDate: article.effectiveDate,
      version: 1,
      brackets: validBrackets,
      specialRates: specialRates.length > 0 ? specialRates : undefined,
      deductions: deductions.length > 0 ? deductions : undefined,
      sourceArticle: `${article.lawName} ${article.articleNumber}`,
    };

    // 최종 유효성 검증
    if (!this.validateRateTable(rateTable)) {
      return null;
    }

    return rateTable;
  }

  /**
   * 조항 내용에서 세율 테이블 존재 여부를 감지한다.
   *
   * @param content - 조항 내용 텍스트
   * @returns 세율 테이블 감지 여부
   */
  detectRateTable(content: string): boolean {
    let matchCount = 0;
    for (const keyword of RateTableExtractor.RATE_TABLE_KEYWORDS) {
      if (content.includes(keyword)) {
        matchCount++;
      }
    }
    // 2개 이상의 키워드가 존재하면 세율 테이블로 판단
    return matchCount >= 2;
  }

  /**
   * 텍스트에서 세율 구간(bracket)을 추출한다.
   *
   * @param content - 조항 내용 텍스트
   * @returns 추출된 세율 구간 배열
   */
  private extractBrackets(content: string): TaxBracket[] {
    const brackets: TaxBracket[] = [];

    // 줄 단위로 분석하여 구간별 세율 추출
    const lines = content.split('\n');
    let currentMin = 0;

    for (const line of lines) {
      const bracketInfo = this.parseBracketLine(line);
      if (bracketInfo) {
        brackets.push(bracketInfo);
        continue;
      }

      // 간단한 패턴: "금액 이하: 세율%" 또는 "금액 초과 ~ 금액 이하: 세율%"
      const simpleMatch = this.parseSimpleBracketLine(line, currentMin);
      if (simpleMatch) {
        brackets.push(simpleMatch);
        currentMin = simpleMatch.maxAmount || simpleMatch.minAmount;
      }
    }

    // brackets이 비어있으면 전체 텍스트에서 패턴 매칭 시도
    if (brackets.length === 0) {
      return this.extractBracketsFromFullText(content);
    }

    return brackets;
  }

  /**
   * 개별 줄에서 세율 구간을 파싱한다.
   *
   * @param line - 텍스트 줄
   * @returns 파싱된 세율 구간 또는 null
   */
  private parseBracketLine(line: string): TaxBracket | null {
    // 패턴: "X원 초과 ~ Y원 이하   Z%   누진공제 W원"
    const bracketMatch = line.match(
      /([\d,]+)\s*(만원|억원|원)\s*(초과|이상)\s*[~∼\-]\s*([\d,]+)\s*(만원|억원|원)\s*(이하|미만).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/
    );

    if (bracketMatch) {
      const minAmount = this.parseAmount(bracketMatch[1], bracketMatch[2]);
      const maxAmount = this.parseAmount(bracketMatch[4], bracketMatch[5]);
      const rate = parseFloat(bracketMatch[7]) / 100;

      // 누진공제 추출
      const deductionMatch = line.match(/누진공제[:\s]*([\d,]+)\s*(만원|억원|원)/);
      const progressiveDeduction = deductionMatch
        ? this.parseAmount(deductionMatch[1], deductionMatch[2])
        : undefined;

      return {
        minAmount,
        maxAmount,
        rate,
        progressiveDeduction,
      };
    }

    return null;
  }

  /**
   * 간단한 패턴의 줄에서 세율 구간을 파싱한다.
   *
   * @param line - 텍스트 줄
   * @param currentMin - 현재까지의 최소 금액
   * @returns 파싱된 세율 구간 또는 null
   */
  private parseSimpleBracketLine(line: string, currentMin: number): TaxBracket | null {
    // 패턴: "Y원 이하   Z%"
    const simpleMatch = line.match(/([\d,]+)\s*(만원|억원|원)\s*(이하|미만).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/);
    if (simpleMatch) {
      const maxAmount = this.parseAmount(simpleMatch[1], simpleMatch[2]);
      const rate = parseFloat(simpleMatch[4]) / 100;

      return {
        minAmount: currentMin,
        maxAmount,
        rate,
      };
    }

    // 패턴: "Y원 초과   Z%"  (상위 구간, maxAmount 없음)
    const overMatch = line.match(/([\d,]+)\s*(만원|억원|원)\s*(초과|이상).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/);
    if (overMatch) {
      const minAmount = this.parseAmount(overMatch[1], overMatch[2]);
      const rate = parseFloat(overMatch[4]) / 100;

      return {
        minAmount,
        rate,
      };
    }

    return null;
  }

  /**
   * 전체 텍스트에서 금액과 세율 쌍을 추출하여 bracket으로 구성한다.
   *
   * @param content - 전체 조항 텍스트
   * @returns 추출된 세율 구간 배열
   */
  private extractBracketsFromFullText(content: string): TaxBracket[] {
    const brackets: TaxBracket[] = [];

    // 금액 목록 추출
    const amounts: number[] = [];
    const amountPattern = /([\d,]+)\s*(만원|억원|원)/g;
    let amountMatch: RegExpExecArray | null;
    while ((amountMatch = amountPattern.exec(content)) !== null) {
      amounts.push(this.parseAmount(amountMatch[1], amountMatch[2]));
    }

    // 세율 목록 추출
    const rates: number[] = [];
    const ratePattern = /(\d+(?:\.\d+)?)\s*(%|퍼센트)/g;
    let rateMatch: RegExpExecArray | null;
    while ((rateMatch = ratePattern.exec(content)) !== null) {
      const rate = parseFloat(rateMatch[1]) / 100;
      if (rate >= 0 && rate <= 1) {
        rates.push(rate);
      }
    }

    // 금액과 세율을 구간으로 조합
    if (amounts.length >= 2 && rates.length >= 2) {
      // 금액을 정렬하여 구간 경계로 사용
      const sortedAmounts = [...new Set(amounts)].sort((a, b) => a - b);

      for (let i = 0; i < Math.min(sortedAmounts.length, rates.length); i++) {
        const bracket: TaxBracket = {
          minAmount: i === 0 ? 0 : sortedAmounts[i - 1],
          maxAmount: sortedAmounts[i],
          rate: rates[i],
        };
        brackets.push(bracket);
      }

      // 마지막 초과 구간 추가 (세율이 남아있는 경우)
      if (rates.length > sortedAmounts.length) {
        brackets.push({
          minAmount: sortedAmounts[sortedAmounts.length - 1],
          rate: rates[rates.length - 1],
        });
      }
    }

    return brackets;
  }

  /**
   * 텍스트에서 특수 세율을 추출한다.
   *
   * @param content - 조항 내용 텍스트
   * @returns 추출된 특수 세율 배열
   */
  private extractSpecialRates(content: string): SpecialRate[] {
    const specialRates: SpecialRate[] = [];

    // 특수 세율 패턴: "조건...적용 세율 X%"
    const specialPatterns = [
      /(?:다주택자|2주택|3주택).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/g,
      /(?:생애\s*최초|1세대\s*1주택).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/g,
      /(?:단기|1년\s*미만|2년\s*미만).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/g,
      /(?:비사업용|법인).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/g,
    ];

    const conditionLabels = ['다주택자', '생애최초/1세대1주택', '단기보유', '비사업용/법인'];

    for (let i = 0; i < specialPatterns.length; i++) {
      const pattern = specialPatterns[i];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const rate = parseFloat(match[1]) / 100;
        if (rate >= 0 && rate <= 1) {
          // 매치 주변 50자를 조건 설명으로 사용
          const contextStart = Math.max(0, match.index - 20);
          const contextEnd = Math.min(content.length, match.index + match[0].length + 20);
          const condition = content.substring(contextStart, contextEnd).trim();

          specialRates.push({
            condition,
            rate,
            description: conditionLabels[i],
          });
        }
      }
    }

    return specialRates;
  }

  /**
   * 텍스트에서 공제 항목을 추출한다.
   *
   * @param content - 조항 내용 텍스트
   * @returns 추출된 공제 항목 배열
   */
  private extractDeductions(content: string): Deduction[] {
    const deductions: Deduction[] = [];

    // 공제 패턴: "공제: 명칭 금액원 (조건)"
    const deductionPatterns = [
      /(?:기본공제|인적공제)\s*[:\s]*([\d,]+)\s*(만원|억원|원)/g,
      /(?:배우자\s*공제)\s*[:\s]*([\d,]+)\s*(만원|억원|원)/g,
      /(?:일괄공제)\s*[:\s]*([\d,]+)\s*(만원|억원|원)/g,
      /(?:장기보유\s*특별공제).*?(\d+(?:\.\d+)?)\s*(%|퍼센트)/g,
    ];

    const deductionNames = ['기본공제', '배우자 공제', '일괄공제', '장기보유 특별공제'];

    for (let i = 0; i < deductionPatterns.length; i++) {
      const pattern = deductionPatterns[i];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        if (i < 3) {
          // 금액 기반 공제
          const amount = this.parseAmount(match[1], match[2]);
          deductions.push({
            name: deductionNames[i],
            amount,
            conditions: this.extractConditionContext(content, match.index),
          });
        } else {
          // 비율 기반 공제
          const rate = parseFloat(match[1]);
          deductions.push({
            name: deductionNames[i],
            formula: `과세표준 × ${rate}%`,
            conditions: this.extractConditionContext(content, match.index),
          });
        }
      }
    }

    return deductions;
  }

  /**
   * 금액 문자열을 원 단위 숫자로 변환한다.
   *
   * @param numStr - 숫자 문자열 (콤마 포함 가능)
   * @param unit - 단위 (원, 만원, 억원)
   * @returns 원 단위 금액
   */
  private parseAmount(numStr: string, unit: string): number {
    const num = parseInt(numStr.replace(/,/g, ''), 10);
    switch (unit) {
      case '억원': return num * 100000000;
      case '만원': return num * 10000;
      case '원': return num;
      default: return num;
    }
  }

  /**
   * 매치 위치 주변에서 조건 컨텍스트를 추출한다.
   *
   * @param content - 전체 텍스트
   * @param matchIndex - 매치 시작 인덱스
   * @returns 조건 설명 텍스트
   */
  private extractConditionContext(content: string, matchIndex: number): string {
    const lineStart = content.lastIndexOf('\n', matchIndex);
    const lineEnd = content.indexOf('\n', matchIndex);
    const line = content.substring(
      lineStart >= 0 ? lineStart + 1 : 0,
      lineEnd >= 0 ? lineEnd : content.length,
    );
    return line.trim().substring(0, 100);
  }

  /**
   * 법령명에서 세목을 추론한다.
   *
   * @param lawName - 법령명
   * @returns 추론된 세목
   */
  private inferTaxType(lawName: string): TaxType {
    if (lawName.includes('소득세')) return 'capital_gains';
    if (lawName.includes('지방세') || lawName.includes('취득세')) return 'acquisition';
    if (lawName.includes('종합부동산세')) return 'comprehensive_property';
    if (lawName.includes('재산세')) return 'property';
    if (lawName.includes('증여세')) return 'gift';
    if (lawName.includes('상속세')) return 'inheritance';
    return 'capital_gains';
  }

  /**
   * 추출된 세율 테이블의 유효성을 검증한다.
   *
   * 검증 조건:
   * - 최소 1개 이상의 bracket
   * - 모든 bracket의 rate가 0~1 범위
   * - effectiveDate가 비어있지 않음
   * - sourceArticle이 비어있지 않음
   *
   * @param rateTable - 검증할 세율 테이블
   * @returns 유효 여부
   */
  private validateRateTable(rateTable: RateTableData): boolean {
    // 최소 1개 bracket 필수
    if (rateTable.brackets.length === 0) {
      return false;
    }

    // 모든 rate가 0~1 범위
    for (const bracket of rateTable.brackets) {
      if (bracket.rate < 0 || bracket.rate > 1) {
        return false;
      }
    }

    // effectiveDate 필수
    if (!rateTable.effectiveDate || rateTable.effectiveDate.trim().length === 0) {
      return false;
    }

    // sourceArticle 필수
    if (!rateTable.sourceArticle || rateTable.sourceArticle.trim().length === 0) {
      return false;
    }

    return true;
  }
}
