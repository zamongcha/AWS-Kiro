/**
 * 세목 분류기 모듈
 *
 * 질문 텍스트에서 관련 세목을 분류한다.
 * 키워드 기반으로 취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세를 판별하며,
 * 복합 세목을 포함하는 질문을 감지하고 분해한다.
 *
 * @module TaxTypeClassifier
 * @requirements 3.5, 11.2
 */

import type { TaxType } from '../interfaces/index.js';

/**
 * 세목 분류 결과 인터페이스
 */
export interface TaxClassificationResult {
  /** 분류된 세목 목록 */
  taxTypes: TaxType[];
  /** 부동산 세무 관련 여부 */
  isTaxRelated: boolean;
  /** 복합 세목 포함 여부 (2개 이상 세목 감지) */
  isCompound: boolean;
  /** 세목별 매칭 점수 (신뢰도) */
  scores: Partial<Record<TaxType, number>>;
}

/**
 * 세목별 키워드 사전
 * 각 세목을 판별하기 위한 키워드 목록
 */
const TAX_TYPE_KEYWORDS: Record<TaxType, string[]> = {
  acquisition: [
    '취득세', '부동산취득세', '취득과세', '취득', '구입세',
    '매수', '매입', '구입', '구매', '사다', '살 때',
    '집 사면', '아파트 사면', '부동산 구입',
    '생애최초', '생애 최초', '첫 집', '첫집',
    '중과세', '취득세율', '취득세 감면',
  ],
  capital_gains: [
    '양도소득세', '양도세', '양도차익', '양도가액', '양도가격',
    '양도', '매도', '매각', '처분', '팔다', '팔 때', '팔면',
    '집 팔면', '아파트 팔면', '부동산 매도',
    '장기보유특별공제', '장특공', '보유기간',
    '1세대1주택', '1가구1주택', '일시적2주택',
    '비과세', '양도세 비과세', '양도소득',
    '다주택자', '다주택', '2주택', '3주택',
    '필요경비', '취득가액', '양도차익',
    '조정대상지역', '투기과열지구',
  ],
  comprehensive_property: [
    '종합부동산세', '종부세', '종합부동산', '보유세',
    '공시가격', '공시지가', '기준시가',
    '부동산 보유', '집 보유', '주택 보유',
    '공동명의', '부부공동명의',
    '종부세율', '종부세 합산',
    '세부담상한',
  ],
  property: [
    '재산세', '부동산재산세', '건물재산세', '토지재산세',
    '주택재산세', '재산세율', '재산세 납부',
    '매년 내는 세금', '7월 세금', '9월 세금',
    '재산세 과세표준',
  ],
  gift: [
    '증여세', '증여', '증여과세', '증여관련',
    '무상이전', '공짜로 받', '선물',
    '부모님한테 받', '자녀한테 줄', '배우자한테 줄',
    '증여공제', '증여세율', '증여세 면제',
    '10년 합산', '증여 합산',
    '부담부증여', '현금증여', '부동산증여',
  ],
  inheritance: [
    '상속세', '상속', '상속과세', '상속관련',
    '물려받', '물려줄', '유산', '사망',
    '피상속인', '상속인', '상속재산',
    '상속공제', '일괄공제', '배우자공제',
    '상속세율', '상속세 면제',
    '연부연납', '분납', '물납',
  ],
};

/**
 * 세목 분류기 클래스
 *
 * 질문 텍스트에서 관련 세목을 키워드 기반으로 분류한다.
 * 복합 세목이 포함된 질문을 감지하고 독립적인 세목으로 분해한다.
 */
export class TaxTypeClassifier {
  /**
   * 질문 텍스트에서 세목을 분류한다.
   *
   * 각 세목의 키워드 사전을 기반으로 매칭 점수를 계산하고,
   * 1개 이상의 키워드가 매칭된 세목을 결과에 포함한다.
   *
   * @param text - 분류할 질문 텍스트
   * @returns 분류 결과 (세목 목록, 관련 여부, 복합 여부, 점수)
   *
   * @requirements 3.5
   */
  classify(text: string): TaxClassificationResult {
    if (!text || text.trim().length === 0) {
      return {
        taxTypes: [],
        isTaxRelated: false,
        isCompound: false,
        scores: {},
      };
    }

    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const scores: Partial<Record<TaxType, number>> = {};
    const detectedTypes: TaxType[] = [];

    for (const [taxType, keywords] of Object.entries(TAX_TYPE_KEYWORDS)) {
      const matchCount = keywords.filter((keyword) =>
        normalizedText.includes(keyword)
      ).length;

      if (matchCount > 0) {
        scores[taxType as TaxType] = matchCount;
        detectedTypes.push(taxType as TaxType);
      }
    }

    // 점수 높은 순으로 정렬
    detectedTypes.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

    return {
      taxTypes: detectedTypes,
      isTaxRelated: detectedTypes.length > 0,
      isCompound: detectedTypes.length >= 2,
      scores,
    };
  }

  /**
   * 복합 세목 질문을 개별 세목으로 분해한다.
   *
   * 2개 이상의 세목이 감지된 질문에서 각 세목을 독립적으로 반환한다.
   *
   * @param text - 분류할 질문 텍스트
   * @returns 감지된 세목 배열 (복합 세목 시 2개 이상)
   */
  decompose(text: string): TaxType[] {
    const result = this.classify(text);
    return result.taxTypes;
  }

  /**
   * 텍스트가 부동산 세무 범위 내 질문인지 판별한다.
   *
   * @param text - 판별할 텍스트
   * @returns 부동산 세무 관련 여부
   */
  isTaxRelated(text: string): boolean {
    const result = this.classify(text);
    return result.isTaxRelated;
  }

  /**
   * 가장 관련성 높은 세목 하나를 반환한다.
   *
   * @param text - 분류할 텍스트
   * @returns 가장 높은 점수의 세목 또는 undefined
   */
  getPrimaryTaxType(text: string): TaxType | undefined {
    const result = this.classify(text);
    return result.taxTypes[0];
  }
}
