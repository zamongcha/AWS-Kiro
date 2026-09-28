/**
 * 범위 판별 및 면책 고지 모듈
 *
 * 사용자 질문이 부동산 법률 범위에 해당하는지 판별하고,
 * 범위 외 질문에 대한 안내 메시지 생성, 면책 고지 삽입,
 * 관련 문서 미발견 시 가이드 메시지 생성 기능을 제공한다.
 *
 * @module ScopeChecker
 * @requirements 4.5, 4.6, 4.7
 */

import { SearchOutput, SearchResult } from '../../common/interfaces/search.js';

/**
 * 범위 판별 결과 인터페이스
 */
export interface ScopeCheckResult {
  /** 부동산 법률 범위 내 여부 */
  isInScope: boolean;
  /** 감지된 카테고리 목록 */
  detectedCategories: string[];
  /** 범위 외 질문인 경우 안내 메시지 */
  outOfScopeMessage?: string;
}

/**
 * 관련 문서 미발견 시 안내 결과 인터페이스
 */
export interface NoRelevantDocumentsGuide {
  /** 안내 메시지 */
  message: string;
  /** 답변 가능 범위 설명 */
  availableScope: string;
  /** 추가 확인 사항 */
  additionalGuidance: string[];
}

/**
 * 지원 카테고리 목록
 */
export const SUPPORTED_CATEGORIES = [
  '임대차',
  '매매',
  '등기',
  '중개',
  '세금',
  '토지이용',
  '재건축/재개발',
] as const;

export type SupportedCategory = (typeof SUPPORTED_CATEGORIES)[number];

/**
 * 면책 고지 문구
 */
export const DISCLAIMER =
  '본 답변은 참고용이며 법적 효력이 없습니다. 구체적인 법률 문제는 변호사 등 전문가의 상담을 받으시기 바랍니다.';

/**
 * 범위 외 질문 안내 메시지
 */
export const OUT_OF_SCOPE_MESSAGE =
  '부동산 법률 관련 질문만 지원합니다. 지원 카테고리: 임대차, 매매, 등기, 중개, 세금, 토지이용, 재건축/재개발';

/**
 * 카테고리별 관련 키워드 사전
 *
 * 각 카테고리에 대한 핵심 키워드를 정의하여 범위 판별에 사용한다.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  임대차: [
    '임대차', '임대', '임차', '전세', '월세', '보증금', '임대인', '임차인',
    '세입자', '집주인', '임대료', '차임', '전세금', '반전세',
    '임대차보호법', '주택임대차', '상가임대차', '계약갱신', '갱신청구권',
    '대항력', '확정일자', '우선변제', '최우선변제', '소액임차인',
    '임대차계약', '전월세', '퇴거', '명도', '보증금반환',
    '전세보증보험', '임대차분쟁', '월차임', '차임증감',
  ],
  매매: [
    '매매', '매수', '매도', '매입', '매각', '거래', '계약금', '중도금', '잔금',
    '매매계약', '부동산거래', '거래신고', '실거래가', '매매대금',
    '소유권이전', '잔금지급', '계약해제', '위약금', '해약금',
    '가계약', '본계약', '부동산매매', '토지매매', '아파트매매', '주택매매',
    '분양', '분양권', '분양가', '분양계약', '청약', '청약통장',
  ],
  등기: [
    '등기', '소유권', '근저당', '저당권', '등기부', '등기부등본', '등기사항',
    '소유권이전등기', '보존등기', '말소등기', '가등기', '본등기',
    '등기원인', '등기권리자', '등기의무자', '등기관', '부동산등기법',
    '등기소', '전세권등기', '지상권등기', '가압류', '압류',
    '경매개시결정등기', '지상권', '지역권', '전세권',
  ],
  중개: [
    '중개', '공인중개사', '중개수수료', '중개보수', '중개업', '중개사무소',
    '공인중개사법', '중개대상물', '중개계약', '전속중개', '일반중개',
    '중개사고', '중개책임', '부동산중개', '중개의뢰', '중개업자',
    '복비', '부동산복비',
  ],
  세금: [
    '세금', '취득세', '양도세', '양도소득세', '재산세', '종합부동산세', '종부세',
    '부가가치세', '증여세', '상속세', '등록세', '인지세', '지방세',
    '세율', '과세', '비과세', '감면', '공제', '납부', '신고',
    '양도차익', '취득가액', '양도가액', '과세표준', '세금계산',
    '부동산세', '보유세', '지방교육세',
  ],
  토지이용: [
    '토지', '토지이용', '용도지역', '용도지구', '용도구역', '건폐율', '용적률',
    '지목', '지적', '토지이용계획', '국토계획법', '개발행위', '개발허가',
    '건축허가', '농지', '농지전용', '산지', '임야', '녹지',
    '주거지역', '상업지역', '공업지역', '토지수용', '토지보상',
    '건축', '건축법', '건축물', '건축허가', '건축신고',
  ],
  '재건축/재개발': [
    '재건축', '재개발', '정비사업', '조합', '조합원', '정비구역', '관리처분',
    '분담금', '추가분담금', '이주비', '재건축초과이익', '초과이익환수',
    '재건축부담금', '안전진단', '정비계획', '사업시행', '조합설립',
    '매도청구', '도시정비법', '도시재개발', '주택재개발',
    '도시환경정비', '재개발구역', '재개발조합', '이주대책',
    '세입자대책', '관리처분계획',
  ],
};

/**
 * 부동산 관련 일반 키워드
 * 단독으로는 범위 판별이 불가하지만, 다른 키워드와 결합 시 부동산 맥락을 강화한다.
 */
const GENERAL_REAL_ESTATE_KEYWORDS: string[] = [
  '부동산', '아파트', '주택', '빌라', '오피스텔', '상가', '건물',
  '집', '토지', '땅', '필지', '대지', '전답', '임야',
  '전용면적', '공용면적', '평수', '방', '거실',
  '경매', '공매', '낙찰', '유찰', '입찰', '배당',
];

/**
 * 부동산 법률 범위 판별 및 면책 고지 클래스
 *
 * 사용자 질문이 부동산 법률 범위에 해당하는지 판별하고,
 * 적절한 안내 메시지를 생성한다.
 *
 * @requirements 4.5, 4.6, 4.7
 */
export class ScopeChecker {
  /**
   * 사용자 질문이 부동산 법률 범위에 해당하는지 판별한다.
   *
   * 카테고리별 키워드 매칭을 통해 부동산 법률 관련 여부를 판단한다.
   * 최소 1개 이상의 카테고리 키워드가 매칭되면 범위 내로 판단한다.
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
        detectedCategories: [],
        outOfScopeMessage: OUT_OF_SCOPE_MESSAGE,
      };
    }

    const normalizedQuery = query.trim().toLowerCase();
    const detectedCategories: string[] = [];

    // 카테고리별 키워드 매칭
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const hasMatch = keywords.some((keyword) =>
        normalizedQuery.includes(keyword)
      );
      if (hasMatch) {
        detectedCategories.push(category);
      }
    }

    // 카테고리 매칭이 없는 경우, 일반 부동산 키워드 + 법률 맥락 확인
    if (detectedCategories.length === 0) {
      const hasGeneralRealEstate = GENERAL_REAL_ESTATE_KEYWORDS.some(
        (keyword) => normalizedQuery.includes(keyword)
      );
      const hasLegalContext = this.hasLegalContext(normalizedQuery);

      if (hasGeneralRealEstate && hasLegalContext) {
        // 일반 부동산 키워드 + 법률 맥락이면 범위 내로 판단
        return {
          isInScope: true,
          detectedCategories: [],
        };
      }
    }

    const isInScope = detectedCategories.length > 0;

    return {
      isInScope,
      detectedCategories,
      outOfScopeMessage: isInScope ? undefined : OUT_OF_SCOPE_MESSAGE,
    };
  }

  /**
   * 관련 문서가 발견되지 않았을 때 안내 메시지를 생성한다.
   *
   * 검색 결과가 없거나 모든 결과가 관련도 기준에 미달하는 경우,
   * 답변 가능 범위와 추가 확인 사항을 안내한다.
   *
   * @param query - 사용자 질문 텍스트
   * @param searchOutput - 검색 결과 (옵션)
   * @returns 안내 결과
   *
   * @requirements 4.5
   */
  generateNoRelevantDocumentsGuide(
    query: string,
    searchOutput?: SearchOutput
  ): NoRelevantDocumentsGuide {
    const scopeResult = this.checkScope(query);
    const categoryList = SUPPORTED_CATEGORIES.join(', ');

    // 검색 결과가 전혀 없는 경우
    if (!searchOutput || searchOutput.results.length === 0) {
      return {
        message:
          '직접 관련된 법령/판례를 찾지 못했습니다. 다음 사항을 확인해 주세요.',
        availableScope: `현재 답변 가능한 범위: ${categoryList}`,
        additionalGuidance: this.buildAdditionalGuidance(query, scopeResult),
      };
    }

    // 모든 결과가 관련도 기준 미달인 경우
    const allLowRelevance = searchOutput.results.every(
      (result: SearchResult) => result.source.isLowRelevance === true
    );

    if (allLowRelevance) {
      return {
        message:
          '질문과 직접적으로 관련된 법령/판례를 찾지 못했습니다. 유사한 내용이 있으나 관련도가 낮을 수 있습니다.',
        availableScope: `현재 답변 가능한 범위: ${categoryList}`,
        additionalGuidance: this.buildAdditionalGuidance(query, scopeResult),
      };
    }

    // 일부 결과만 관련도 기준 미달인 경우
    return {
      message:
        '일부 관련 자료를 찾았으나, 질문의 모든 측면을 다루지 못할 수 있습니다.',
      availableScope: `현재 답변 가능한 범위: ${categoryList}`,
      additionalGuidance: [
        '질문을 더 구체적으로 작성하면 정확한 답변을 받을 수 있습니다.',
        '관련 법령명이나 조항 번호를 포함하면 검색 정확도가 높아집니다.',
      ],
    };
  }

  /**
   * 답변에 면책 고지를 삽입한다.
   *
   * 답변 텍스트 말미에 면책 고지 문구를 추가한다.
   *
   * @param answer - 원본 답변 텍스트
   * @returns 면책 고지가 포함된 답변 텍스트
   *
   * @requirements 4.6
   */
  appendDisclaimer(answer: string): string {
    if (!answer || answer.trim().length === 0) {
      return DISCLAIMER;
    }

    const trimmedAnswer = answer.trimEnd();

    // 이미 면책 고지가 포함되어 있으면 중복 삽입하지 않음
    if (trimmedAnswer.includes(DISCLAIMER)) {
      return trimmedAnswer;
    }

    return `${trimmedAnswer}\n\n---\n⚠️ ${DISCLAIMER}`;
  }

  /**
   * 검색 결과가 사용자 질문에 직접 관련되는지 판별한다.
   *
   * 검색 결과 중 관련도가 높은 문서가 존재하는지 확인한다.
   *
   * @param searchOutput - 검색 결과
   * @returns 관련 문서 존재 여부
   */
  hasRelevantDocuments(searchOutput: SearchOutput): boolean {
    if (!searchOutput || searchOutput.results.length === 0) {
      return false;
    }

    return searchOutput.results.some(
      (result: SearchResult) => result.source.isLowRelevance !== true
    );
  }

  // ─── Private Helper Methods ────────────────────────────────────────────────

  /**
   * 질문에 법률 관련 맥락이 있는지 확인한다.
   */
  private hasLegalContext(query: string): boolean {
    const legalContextKeywords = [
      '법', '법률', '법령', '조항', '판례', '소송', '계약',
      '권리', '의무', '위반', '처벌', '벌금', '규정', '조례',
      '허가', '신고', '등록', '인가', '절차', '분쟁', '합의',
      '해지', '해제', '손해배상', '위약', '불법', '적법', '합법',
    ];

    return legalContextKeywords.some((keyword) => query.includes(keyword));
  }

  /**
   * 추가 확인 사항 가이드를 생성한다.
   */
  private buildAdditionalGuidance(
    query: string,
    scopeResult: ScopeCheckResult
  ): string[] {
    const guidance: string[] = [];

    if (scopeResult.detectedCategories.length > 0) {
      guidance.push(
        `감지된 주제: ${scopeResult.detectedCategories.join(', ')} — 관련 법령/판례 데이터가 부족할 수 있습니다.`
      );
    }

    guidance.push(
      '질문을 더 구체적으로 작성해 보세요. (예: 특정 법령명, 상황 설명 등)'
    );
    guidance.push(
      '관련 법령의 조항 번호를 알고 계시면 포함해 주세요.'
    );
    guidance.push(
      '구체적인 법률 문제는 변호사 등 전문가에게 상담하시기를 권장합니다.'
    );

    return guidance;
  }
}
