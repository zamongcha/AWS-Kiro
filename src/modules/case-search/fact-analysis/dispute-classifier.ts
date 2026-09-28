/**
 * @fileoverview 분쟁 유형 분류기
 * @description 사용자 상황 설명에서 키워드 기반으로 부동산 분쟁 유형을 분류한다.
 * 5가지 분쟁 유형(lease, sale, registration, brokerage, redevelopment)으로 분류하며,
 * 복수 분쟁 유형 분류를 지원한다.
 * 부동산 관련 분쟁이 아닌 경우를 감지하여 안내 메시지를 생성한다.
 *
 * @requirements 1.2 - 분쟁 유형 분류
 * @requirements 1.6 - 부동산 관련 분쟁이 아닌 경우 감지
 */

import type { DisputeType } from '../interfaces/index.js';

/**
 * 분쟁 유형별 키워드 매핑
 */
interface DisputeKeywords {
  type: DisputeType;
  keywords: string[];
}

/** 분쟁 유형별 키워드 사전 */
const DISPUTE_KEYWORDS: DisputeKeywords[] = [
  {
    type: 'lease',
    keywords: [
      '임대', '임차', '전세', '월세', '보증금', '임대차', '세입자', '집주인',
      '임대인', '임차인', '계약갱신', '대항력', '우선변제', '확정일자',
      '퇴거', '명도', '주택임대차', '상가임대차', '권리금', '임대보증금',
      '전세금', '월차임', '연체', '계약해지', '갱신거절', '차임증감',
    ],
  },
  {
    type: 'sale',
    keywords: [
      '매매', '매수', '매도', '매매계약', '계약금', '중도금', '잔금',
      '하자', '하자담보', '소유권', '이중매매', '계약해제', '위약금',
      '분양', '분양권', '매물', '실거래가', '시세', '감정평가',
      '매매대금', '잔금지급', '계약이행', '양도',
    ],
  },
  {
    type: 'registration',
    keywords: [
      '등기', '소유권이전', '이전등기', '가등기', '근저당', '저당권',
      '말소등기', '보존등기', '명의', '명의신탁', '명의변경', '부동산등기',
      '등기부', '등기부등본', '소유권보존', '소유권이전등기', '신탁등기',
      '가처분', '처분금지', '공동소유',
    ],
  },
  {
    type: 'brokerage',
    keywords: [
      '중개', '중개사', '복비', '중개보수', '중개수수료', '부동산중개',
      '공인중개사', '중개업자', '중개계약', '중개의뢰', '중개사고',
      '허위매물', '과대광고', '중개대상', '전속중개', '일반중개',
      '중개보수 초과', '중개업',
    ],
  },
  {
    type: 'redevelopment',
    keywords: [
      '재건축', '재개발', '재건축부담금', '조합', '조합원', '관리처분',
      '사업시행', '분담금', '추가분담금', '정비사업', '도시정비',
      '리모델링', '초과이익', '환수', '감정평가', '이주비', '이주대책',
      '조합설립', '사업시행인가', '관리처분계획',
    ],
  },
];

/** 부동산 일반 키워드 (분쟁 유형 미분류지만 부동산 관련) */
const REAL_ESTATE_GENERAL_KEYWORDS = [
  '부동산', '아파트', '주택', '빌라', '오피스텔', '상가', '토지',
  '건물', '공동주택', '다세대', '다가구', '단독주택', '연립',
  '용도변경', '건축허가', '불법건축', '건축물', '지목변경',
];

/**
 * 분쟁 유형 분류 결과 인터페이스
 */
export interface ClassificationResult {
  /** 분류된 분쟁 유형 목록 (1개 이상) */
  disputeTypes: DisputeType[];
  /** 부동산 분쟁 해당 여부 */
  isRealEstateDispute: boolean;
  /** 각 분쟁 유형별 매칭 점수 */
  scores: Record<DisputeType, number>;
}

/**
 * 분쟁 유형 분류기 클래스
 *
 * 사용자 상황 설명에서 키워드 기반으로 분쟁 유형을 분류한다.
 * 복수 분쟁 유형을 지원하며, 매칭 점수가 높은 순으로 반환한다.
 *
 * @requirements 1.2, 1.6
 */
export class DisputeClassifier {
  /**
   * 상황 설명에서 분쟁 유형을 분류한다.
   *
   * @param text - 사용자 상황 설명
   * @returns 분류 결과 (분쟁 유형 목록, 부동산 해당 여부, 매칭 점수)
   *
   * @example
   * ```typescript
   * const classifier = new DisputeClassifier();
   *
   * classifier.classify("임대인이 보증금을 돌려주지 않습니다.");
   * // { disputeTypes: ['lease'], isRealEstateDispute: true, scores: { lease: 2, ... } }
   *
   * classifier.classify("교통사고 합의금을 못 받았습니다.");
   * // { disputeTypes: [], isRealEstateDispute: false, scores: { ... } }
   * ```
   */
  classify(text: string): ClassificationResult {
    const scores: Record<DisputeType, number> = {
      lease: 0,
      sale: 0,
      registration: 0,
      brokerage: 0,
      redevelopment: 0,
    };

    // 각 분쟁 유형별 키워드 매칭 점수 계산
    for (const { type, keywords } of DISPUTE_KEYWORDS) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          scores[type]++;
        }
      }
    }

    // 점수가 1 이상인 분쟁 유형을 점수 내림차순으로 정렬
    const matchedTypes = (Object.entries(scores) as [DisputeType, number][])
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);

    // 부동산 관련 여부 판별
    const isRealEstateDispute = this.checkIsRealEstateDispute(text, matchedTypes);

    return {
      disputeTypes: matchedTypes,
      isRealEstateDispute,
      scores,
    };
  }

  /**
   * 부동산 관련 분쟁인지 판별한다.
   *
   * 분쟁 유형이 1개 이상 매칭되거나,
   * 부동산 일반 키워드가 텍스트에 포함되어 있으면 부동산 관련으로 판별한다.
   *
   * @param text - 사용자 상황 설명
   * @param matchedTypes - 매칭된 분쟁 유형 목록
   * @returns 부동산 분쟁 해당 여부
   */
  private checkIsRealEstateDispute(text: string, matchedTypes: DisputeType[]): boolean {
    if (matchedTypes.length > 0) {
      return true;
    }

    // 분쟁 유형은 매칭되지 않았지만 부동산 일반 키워드가 있는 경우
    for (const keyword of REAL_ESTATE_GENERAL_KEYWORDS) {
      if (text.includes(keyword)) {
        return true;
      }
    }

    return false;
  }
}
