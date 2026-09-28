/**
 * 세무 범위 판별기 (TaxScopeChecker)
 *
 * 사용자 질문이 부동산 세무(취득세, 양도소득세, 종합부동산세, 재산세,
 * 증여세, 상속세) 범위에 해당하는지 판별한다.
 * 범위 외 질문 시 isOutOfScope=true와 안내 메시지를 반환한다.
 *
 * @module TaxScopeChecker
 * @requirements 4.7
 */

import type { TaxType } from '../interfaces/index.js';

/**
 * 범위 판별 결과 인터페이스
 */
export interface ScopeCheckResult {
  /** 범위 내 여부 (true=범위 내) */
  isInScope: boolean;
  /** 감지된 세목 목록 */
  detectedTaxTypes: TaxType[];
  /** 범위 외 시 안내 메시지 */
  outOfScopeMessage?: string;
}

/**
 * 세목별 키워드 매핑
 */
const TAX_TYPE_KEYWORDS: Record<TaxType, string[]> = {
  acquisition: [
    '취득세', '취득', '매입', '구입', '매매', '분양', '신축',
    '증축', '상속취득', '증여취득', '교환', '부담부증여',
  ],
  capital_gains: [
    '양도소득세', '양도세', '양도', '매도', '매각', '팔',
    '처분', '장기보유', '비과세', '1세대1주택', '다주택',
    '양도차익', '양도소득', '중과세',
  ],
  comprehensive_property: [
    '종합부동산세', '종부세', '공시가격', '공시지가',
    '보유세', '재산세와', '세부담상한',
  ],
  property: [
    '재산세', '건물세', '토지세', '지방세', '과세표준',
  ],
  gift: [
    '증여세', '증여', '무상이전', '부담부증여', '세대생략',
    '증여공제', '증여재산', '수증자',
  ],
  inheritance: [
    '상속세', '상속', '피상속인', '상속인', '유산',
    '상속공제', '배우자상속', '기초공제',
  ],
};

/**
 * 범위 외 질문 감지 키워드
 */
const OUT_OF_SCOPE_KEYWORDS: string[] = [
  '법인세', '부가가치세', '부가세', '소득세', '근로소득',
  '사업소득', '이자소득', '배당소득', '기타소득',
  '관세', '주세', '인지세', '개별소비세', '교통세',
  '교육세', '농어촌특별세', '증권거래세',
  '건강보험', '국민연금', '고용보험', '산재보험',
  '형사', '민사', '이혼', '손해배상',
  '날씨', '맛집', '영화', '음악', '스포츠',
];

/**
 * 부동산 관련 키워드 (세무 범위 보강)
 */
const REAL_ESTATE_KEYWORDS: string[] = [
  '부동산', '아파트', '주택', '집', '빌라', '오피스텔',
  '상가', '토지', '땅', '건물', '다세대', '다가구',
  '단독주택', '연립', '전용면적', '공동주택',
  '분양권', '입주권', '조합원입주권', '재건축',
  '재개발', '임대', '전세', '월세', '보증금',
];

/** 범위 외 안내 메시지 */
const OUT_OF_SCOPE_MESSAGE =
  '부동산 세무(취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세) 관련 질문만 지원합니다. 다른 세목이나 비세무 질문은 답변이 어렵습니다.';

/**
 * 세무 범위 판별기 클래스
 *
 * 사용자 질문의 키워드를 분석하여 부동산 세무 범위 내 여부를 판별한다.
 *
 * 판별 규칙:
 * 1. 부동산 세무 관련 키워드가 포함되면 → 범위 내
 * 2. 부동산 키워드 + 세금 관련 표현이 함께 있으면 → 범위 내
 * 3. 명시적으로 범위 외 세목/주제가 감지되면 → 범위 외
 * 4. 어떤 세무 키워드도 없으면 → 범위 외
 *
 * @requirements 4.7
 */
export class TaxScopeChecker {
  /**
   * 질문의 범위를 판별한다.
   *
   * @param query - 사용자 질문 텍스트
   * @returns 범위 판별 결과
   *
   * @requirements 4.7
   */
  checkScope(query: string): ScopeCheckResult {
    if (!query || query.trim().length === 0) {
      return {
        isInScope: false,
        detectedTaxTypes: [],
        outOfScopeMessage: OUT_OF_SCOPE_MESSAGE,
      };
    }

    const normalizedQuery = query.toLowerCase().trim();

    // 1. 부동산 세목별 키워드 매칭
    const detectedTaxTypes: TaxType[] = [];
    for (const [taxType, keywords] of Object.entries(TAX_TYPE_KEYWORDS)) {
      const hasMatch = keywords.some((kw) => normalizedQuery.includes(kw));
      if (hasMatch) {
        detectedTaxTypes.push(taxType as TaxType);
      }
    }

    // 2. 직접적인 세목 키워드 매칭 성공 → 범위 내
    if (detectedTaxTypes.length > 0) {
      return {
        isInScope: true,
        detectedTaxTypes,
      };
    }

    // 3. 부동산 키워드 + 세금 일반 표현 조합 → 범위 내 추정
    const hasRealEstateKeyword = REAL_ESTATE_KEYWORDS.some((kw) =>
      normalizedQuery.includes(kw)
    );
    const hasTaxGenericKeyword = normalizedQuery.includes('세금') ||
      normalizedQuery.includes('세율') ||
      normalizedQuery.includes('세액') ||
      normalizedQuery.includes('납부') ||
      normalizedQuery.includes('신고') ||
      normalizedQuery.includes('과세') ||
      normalizedQuery.includes('비과세') ||
      normalizedQuery.includes('감면') ||
      normalizedQuery.includes('공제');

    if (hasRealEstateKeyword && hasTaxGenericKeyword) {
      return {
        isInScope: true,
        detectedTaxTypes: [], // 구체적 세목은 미확인
      };
    }

    // 4. 명시적 범위 외 키워드 감지
    const hasOutOfScopeKeyword = OUT_OF_SCOPE_KEYWORDS.some((kw) =>
      normalizedQuery.includes(kw)
    );

    if (hasOutOfScopeKeyword) {
      return {
        isInScope: false,
        detectedTaxTypes: [],
        outOfScopeMessage: OUT_OF_SCOPE_MESSAGE,
      };
    }

    // 5. 부동산 키워드만 있고 세금 키워드가 없는 경우 → 범위 내 추정 (부동산 관련 세무 상담)
    if (hasRealEstateKeyword) {
      return {
        isInScope: true,
        detectedTaxTypes: [],
      };
    }

    // 6. 아무 관련 키워드도 없는 경우 → 범위 외
    return {
      isInScope: false,
      detectedTaxTypes: [],
      outOfScopeMessage: OUT_OF_SCOPE_MESSAGE,
    };
  }
}
