/**
 * 절세 포인트 엔진 (TaxSavingEngine)
 *
 * 거래 유형별 합법적 절세 방법을 생성한다.
 * 각 절세 팁은 근거 법 조항, 적용 요건, 주의사항을 포함하며,
 * isLegal=true를 항상 보장한다. 세무사 상담 권장 안내를 포함한다.
 *
 * @module TaxSavingEngine
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import type {
  TaxType,
  TaxSavingTip,
  TaxSearchResult,
} from '../interfaces/index.js';

/**
 * 세목별 기본 절세 팁 데이터베이스
 */
const DEFAULT_TAX_SAVING_TIPS: Record<TaxType, TaxSavingTip[]> = {
  acquisition: [
    {
      title: '생애 최초 주택구입 취득세 감면',
      description: '생애 최초로 주택을 구입하는 경우 취득세 감면 혜택을 받을 수 있어요. 주택 가격과 소득 요건을 확인하세요.',
      legalBasis: '지방세특례제한법 제36조의3',
      conditions: '생애 최초 주택 구입자, 주택 가격 수도권 4억원 이하(비수도권 3억원 이하), 부부합산 소득 7천만원 이하',
      cautions: '감면 후 3년 이내 다른 주택 취득 시 감면세액 추징 가능. 반드시 세무사와 상담하여 요건 충족 여부를 확인하세요.',
      isLegal: true,
    },
    {
      title: '신혼부부 취득세 감면',
      description: '혼인신고일로부터 5년 이내 주택 취득 시 취득세 감면을 받을 수 있어요.',
      legalBasis: '지방세특례제한법 제36조의2',
      conditions: '혼인신고일로부터 5년 이내, 주택 가격 3억원 이하(수도권 4억원 이하), 부부합산 소득 7천만원 이하',
      cautions: '감면받은 주택을 3년 이내 처분 시 추징될 수 있습니다. 세무사 상담을 권장합니다.',
      isLegal: true,
    },
  ],
  capital_gains: [
    {
      title: '1세대 1주택 비과세 요건 확인',
      description: '1세대 1주택자가 2년 이상 보유(조정대상지역은 2년 거주 포함)한 경우 양도소득세 비과세를 받을 수 있어요.',
      legalBasis: '소득세법 제89조 제1항 제3호',
      conditions: '1세대 1주택, 2년 이상 보유, 양도가액 12억원 이하, 조정대상지역은 2년 거주 요건 추가',
      cautions: '일시적 2주택 상태라도 처분 기한 내 기존 주택 매도 시 비과세 가능. 정확한 비과세 요건은 세무사에게 확인하세요.',
      isLegal: true,
    },
    {
      title: '장기보유특별공제 활용',
      description: '3년 이상 보유한 부동산은 장기보유특별공제를 통해 양도차익을 줄일 수 있어요.',
      legalBasis: '소득세법 제95조',
      conditions: '3년 이상 보유, 1세대 1주택은 10년 보유+거주 시 최대 80% 공제',
      cautions: '다주택자는 중과세율 적용 시 장기보유특별공제 배제됩니다. 세무사에게 정확한 공제율을 확인하세요.',
      isLegal: true,
    },
  ],
  comprehensive_property: [
    {
      title: '공시가격 이의신청',
      description: '종합부동산세 과세 기준이 되는 공시가격이 실제 시세와 괴리가 있다면 이의신청을 할 수 있어요.',
      legalBasis: '부동산 가격공시에 관한 법률 제7조',
      conditions: '공시가격 공시 후 이의신청 기간 내 신청, 감정평가사의 의견서 첨부 권장',
      cautions: '이의신청이 인용되지 않을 수 있으며, 세무사와 상담하여 실익을 미리 따져보세요.',
      isLegal: true,
    },
    {
      title: '1세대 1주택자 공제 활용',
      description: '1세대 1주택자는 종합부동산세에서 추가 공제를 받을 수 있어요.',
      legalBasis: '종합부동산세법 제8조',
      conditions: '1세대 1주택, 과세 기준일(6월 1일) 기준 주택 소유',
      cautions: '합산배제 임대주택 등 특례 적용 여부는 세무사와 확인하세요.',
      isLegal: true,
    },
  ],
  property: [
    {
      title: '재산세 감면 대상 확인',
      description: '임대주택, 사원용 주택 등 특정 용도의 부동산은 재산세 감면을 받을 수 있어요.',
      legalBasis: '지방세특례제한법 제31조',
      conditions: '등록 임대주택, 공공임대주택, 사원용 주택 등 해당 용도 충족',
      cautions: '감면 요건 미충족 시 추징될 수 있습니다. 반드시 세무사와 상담하세요.',
      isLegal: true,
    },
  ],
  gift: [
    {
      title: '증여세 면제 한도 활용',
      description: '배우자간 6억원, 직계존비속간 5천만원(미성년자 2천만원)까지 증여세 면제를 받을 수 있어요.',
      legalBasis: '상속세 및 증여세법 제53조',
      conditions: '10년 단위 합산, 배우자 6억원, 성인 직계비속 5천만원, 미성년 직계비속 2천만원',
      cautions: '10년간 합산 금액 관리가 중요합니다. 장기적인 증여 계획은 세무사와 상담하여 수립하세요.',
      isLegal: true,
    },
    {
      title: '부담부증여 활용',
      description: '증여 시 채무(대출)를 함께 이전하면 채무액만큼 증여재산가액에서 차감되어 세 부담을 줄일 수 있어요.',
      legalBasis: '상속세 및 증여세법 제47조 제3항',
      conditions: '증여 재산에 담보된 채무가 있을 것, 수증자가 실제로 채무를 인수할 것',
      cautions: '채무 인수 부분은 양도소득세 과세 대상이 됩니다. 양쪽 세금을 비교 검토하여 유리한 방법을 세무사와 상의하세요.',
      isLegal: true,
    },
  ],
  inheritance: [
    {
      title: '배우자 상속공제 활용',
      description: '배우자가 실제 상속받은 금액에 대해 최대 30억원까지 상속공제를 받을 수 있어요.',
      legalBasis: '상속세 및 증여세법 제19조',
      conditions: '배우자 실제 상속, 법정상속분 범위 내, 최소 5억원~최대 30억원',
      cautions: '배우자 상속분 신고 후 6개월 이내 분할 완료해야 합니다. 상속 설계는 반드시 세무사와 상의하세요.',
      isLegal: true,
    },
    {
      title: '동거주택 상속공제',
      description: '피상속인과 10년 이상 동거한 1세대 1주택 무주택 상속인은 최대 6억원 공제를 받을 수 있어요.',
      legalBasis: '상속세 및 증여세법 제23조의2',
      conditions: '피상속인과 10년 이상 동거, 상속인 무주택, 피상속인 1세대 1주택',
      cautions: '10년 동거 기간 중 일시적 이사 등은 인정될 수 있으나 엄격한 요건입니다. 세무사 상담을 권장합니다.',
      isLegal: true,
    },
  ],
};

/** 공통 절세 안내 문구 */
const CONSULTATION_NOTE = '※ 위 절세 방법은 일반적인 안내이며, 개인 상황에 따라 적용 여부가 달라집니다. 반드시 세무사와 상담하시기 바랍니다.';

/**
 * 절세 포인트 엔진 클래스
 *
 * 질문에서 감지된 세목을 기반으로 관련 절세 팁을 생성한다.
 * 모든 절세 팁은 합법적(isLegal=true)이며, 근거 법 조항,
 * 적용 요건, 주의사항을 포함한다.
 *
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
export class TaxSavingEngine {
  /**
   * 절세 포인트를 생성한다.
   *
   * 감지된 세목에 따라 관련 절세 팁을 반환한다.
   * 검색 결과에서 추가적인 절세 가능성이 감지되면 보충한다.
   *
   * @param query - 사용자 질문
   * @param taxTypes - 감지된 세목 목록
   * @param searchResults - 검색 결과 (선택)
   * @returns 절세 포인트 배열
   *
   * @requirements 6.1, 6.2, 6.3, 6.5
   */
  generateTips(
    query: string,
    taxTypes: TaxType[],
    searchResults?: TaxSearchResult[]
  ): TaxSavingTip[] {
    const tips: TaxSavingTip[] = [];

    // 감지된 세목별 기본 팁 추가
    for (const taxType of taxTypes) {
      const typeTips = DEFAULT_TAX_SAVING_TIPS[taxType];
      if (typeTips) {
        // 질문 관련도가 높은 팁만 선택 (최대 2개)
        const relevantTips = this.filterRelevantTips(query, typeTips);
        tips.push(...relevantTips);
      }
    }

    // 세목이 감지되지 않은 경우 검색 결과 기반으로 팁 추출 시도
    if (tips.length === 0 && searchResults && searchResults.length > 0) {
      const inferredTypes = this.inferTaxTypesFromResults(searchResults);
      for (const taxType of inferredTypes) {
        const typeTips = DEFAULT_TAX_SAVING_TIPS[taxType];
        if (typeTips && typeTips.length > 0) {
          tips.push(typeTips[0]);
        }
      }
    }

    // 모든 팁에 isLegal=true 보장
    return tips.map((tip) => ({
      ...tip,
      isLegal: true,
    }));
  }

  /**
   * 세무사 상담 권장 안내 문구를 반환한다.
   */
  getConsultationNote(): string {
    return CONSULTATION_NOTE;
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * 질문과 관련도가 높은 팁을 필터링한다. (최대 2개)
   */
  private filterRelevantTips(query: string, tips: TaxSavingTip[]): TaxSavingTip[] {
    const normalizedQuery = query.toLowerCase();

    // 간단한 키워드 매칭으로 관련도 점수 계산
    const scored = tips.map((tip) => {
      const keywords = [
        ...tip.title.split(/\s+/),
        ...tip.conditions.split(/[,\s]+/),
      ].filter((w) => w.length >= 2);

      const matchCount = keywords.filter((kw) =>
        normalizedQuery.includes(kw.toLowerCase())
      ).length;

      return { tip, score: matchCount };
    });

    // 점수 내림차순 정렬 후 최대 2개 반환
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 2).map((s) => s.tip);
  }

  /**
   * 검색 결과에서 세목을 추론한다.
   */
  private inferTaxTypesFromResults(results: TaxSearchResult[]): TaxType[] {
    const types = new Set<TaxType>();
    for (const result of results) {
      if (result.metadata.taxType) {
        types.add(result.metadata.taxType as TaxType);
      }
    }
    return Array.from(types);
  }
}
