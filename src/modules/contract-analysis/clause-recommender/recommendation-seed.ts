/**
 * 계약 유형·당사자 관점별 권장 특약 시드 데이터
 *
 * 코드 내 기본 시드로, 계약 유형(매매/전세/월세/상가임대차)과 당사자 관점
 * (매수인/매도인/임대인/임차인)별로 권장되는 특약 문안·추천 사유·관점 이점·
 * 근거 법조항/판례를 정의한다.
 *
 * 배포 환경에서는 S3 config(`contract-data/config/...`) 기반 시드 소스로
 * 교체할 수 있으며, 그 경우 이 시드는 폴백으로 활용된다.
 *
 * @module recommendation-seed
 * @requirements 11.1, 11.3, 11.6
 */

import type {
  ContractType,
  PartyPerspective,
  LegalReference,
} from '../interfaces/index.js';

/**
 * 권장 특약 시드 항목
 *
 * 코드 내 시드 데이터의 단일 권장 특약을 표현한다.
 */
export interface RecommendationSeed {
  /** 특약명 (누락 특약 중복 판별용) */
  clauseName: string;
  /** 특약 문안 */
  clauseText: string;
  /** 추천 사유 */
  reason: string;
  /** 당사자 관점 기준 이점 */
  benefit: string;
  /** 근거 법조항/판례 (없으면 미정의 → isBasisVerified=false) */
  legalBasis?: LegalReference[];
}

/**
 * 계약 유형·관점별 권장 특약 시드 매핑 타입
 */
export type RecommendationSeedMap = {
  [type in ContractType]?: {
    [perspective in PartyPerspective]?: RecommendationSeed[];
  };
};

/**
 * 계약 유형·관점별 권장 특약 시드 데이터
 */
export const RECOMMENDATION_SEED: RecommendationSeedMap = {
  // 매매 계약
  sale: {
    buyer: [
      {
        clauseName: '권리관계 확인 특약',
        clauseText:
          '매도인은 잔금 지급일까지 등기부등본상 근저당권·가압류 등 소유권 행사를 제한하는 권리를 말소하며, 이를 이행하지 못할 경우 매수인은 계약을 해제하고 계약금의 반환을 청구할 수 있다.',
        reason:
          '매매 목적물에 설정된 제한물권이 잔금 전 말소되지 않으면 매수인이 완전한 소유권을 취득하지 못할 위험이 있습니다.',
        benefit:
          '매수인은 깨끗한 권리관계로 소유권을 이전받을 수 있고, 미이행 시 계약 해제와 계약금 반환의 근거를 확보합니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '민법',
            articleNumber: '제576조',
            summary: '매매 목적물에 설정된 저당권 등으로 인한 매도인의 담보책임',
          },
        ],
      },
      {
        clauseName: '하자담보 책임 특약',
        clauseText:
          '매도인은 목적물에 계약 당시 매수인이 알지 못한 중대한 하자가 존재할 경우 이를 보수하거나 그에 상응하는 손해를 배상한다.',
        reason:
          '인도 후 발견되는 중대한 하자에 대한 책임 소재를 명확히 하지 않으면 분쟁이 발생할 수 있습니다.',
        benefit:
          '매수인은 숨은 하자에 대한 보수·배상 청구 근거를 확보하여 예기치 못한 수선 비용 부담을 줄일 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '민법',
            articleNumber: '제580조',
            summary: '매도인의 하자담보책임',
          },
        ],
      },
    ],
    seller: [
      {
        clauseName: '잔금 지연 이자 특약',
        clauseText:
          '매수인이 잔금 지급을 지체할 경우 지체일수에 대하여 연 %의 지연손해금을 매도인에게 지급한다.',
        reason:
          '잔금 지급 지연에 대한 손해 배상 기준을 미리 정하지 않으면 매도인이 지연에 따른 손해를 회복하기 어렵습니다.',
        benefit:
          '매도인은 잔금 지연 시 명확한 손해 배상 기준을 확보하여 이행을 강제하고 손해를 보전할 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '민법',
            articleNumber: '제397조',
            summary: '금전채무 불이행에 대한 지연손해금 약정',
          },
        ],
      },
    ],
  },

  // 전세 계약
  jeonse: {
    tenant: [
      {
        clauseName: '전세보증금 반환 특약',
        clauseText:
          '임대인은 임대차 종료 시 임차인에게 전세보증금 전액을 지체 없이 반환하며, 반환 지연 시 지연일수에 대하여 법정이율에 따른 지연손해금을 가산하여 지급한다.',
        reason:
          '전세보증금 반환 지연·미반환은 전세 계약에서 임차인에게 가장 큰 위험 요소입니다.',
        benefit:
          '임차인은 보증금 반환 시기와 지연 시 손해배상 기준을 명확히 하여 반환 위험에 대비할 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '주택임대차보호법',
            articleNumber: '제3조의2',
            summary: '보증금의 우선변제권 및 반환 관련 규정',
          },
        ],
      },
      {
        clauseName: '선순위 권리 제한 특약',
        clauseText:
          '임대인은 임대차 기간 중 임차인의 대항력·우선변제권을 침해하는 근저당권 등 추가 담보권을 설정하지 아니한다.',
        reason:
          '임대차 이후 설정되는 선순위 채권은 임차인의 보증금 회수를 위협할 수 있습니다.',
        benefit:
          '임차인은 임대차 기간 중 권리 순위가 후순위로 밀리는 위험을 방지할 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '주택임대차보호법',
            articleNumber: '제3조',
            summary: '임차인의 대항력 발생 요건',
          },
        ],
      },
    ],
    landlord: [
      {
        clauseName: '원상회복 특약',
        clauseText:
          '임차인은 임대차 종료 시 목적물을 임대차 개시 당시의 상태로 원상회복하여 반환하며, 임차인의 고의·과실로 인한 훼손은 임차인이 그 비용을 부담한다.',
        reason:
          '원상회복 범위와 비용 부담 주체를 명확히 하지 않으면 명도 시점에 분쟁이 발생할 수 있습니다.',
        benefit:
          '임대인은 목적물 훼손에 대한 원상회복·비용 청구 근거를 확보할 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '민법',
            articleNumber: '제615조',
            summary: '임차인의 원상회복 의무',
          },
        ],
      },
    ],
  },

  // 월세 계약
  wolse: {
    tenant: [
      {
        clauseName: '차임 증액 제한 특약',
        clauseText:
          '임대인은 임대차 기간 중 차임을 증액할 수 없으며, 갱신 시 증액은 관련 법령이 정한 상한 범위 내에서만 가능하다.',
        reason:
          '차임 증액 상한을 정하지 않으면 임차인이 과도한 인상에 노출될 수 있습니다.',
        benefit:
          '임차인은 예측 가능한 임대료 부담으로 거주 안정성을 확보할 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '주택임대차보호법',
            articleNumber: '제7조',
            summary: '차임 등 증액 청구의 제한',
          },
        ],
      },
    ],
    landlord: [
      {
        clauseName: '차임 연체 해지 특약',
        clauseText:
          '임차인이 차임을 2기 이상 연체할 경우 임대인은 최고 없이 계약을 해지할 수 있다.',
        reason:
          '차임 연체에 대한 계약 해지 요건을 명확히 하지 않으면 임대인의 대응이 지연될 수 있습니다.',
        benefit:
          '임대인은 차임 연체 시 신속하게 계약을 해지할 수 있는 근거를 확보합니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '민법',
            articleNumber: '제640조',
            summary: '차임 연체와 임대인의 계약 해지권',
          },
        ],
      },
    ],
  },

  // 상가임대차 계약
  commercial_lease: {
    tenant: [
      {
        clauseName: '권리금 회수 기회 보호 특약',
        clauseText:
          '임대인은 임차인이 주선한 신규 임차인과의 임대차 계약 체결을 정당한 사유 없이 거절하지 아니하며, 임차인의 권리금 회수 기회를 방해하지 아니한다.',
        reason:
          '상가임대차에서 권리금 회수 기회 보호를 명시하지 않으면 임차인이 투자 회수에 어려움을 겪을 수 있습니다.',
        benefit:
          '임차인은 상가건물 임대차보호법상 권리금 회수 기회를 계약상으로도 확인하여 투자 회수를 보호받습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '상가건물 임대차보호법',
            articleNumber: '제10조의4',
            summary: '권리금 회수기회의 보호',
          },
        ],
      },
      {
        clauseName: '계약 갱신 요구권 특약',
        clauseText:
          '임차인은 관련 법령이 정한 기간 내에서 계약 갱신을 요구할 수 있으며, 임대인은 법정 사유 없이 이를 거절하지 아니한다.',
        reason:
          '갱신 요구권을 명확히 하지 않으면 임차인의 영업 계속성이 위협받을 수 있습니다.',
        benefit:
          '임차인은 안정적인 영업 기간을 확보하여 사업 계획을 예측 가능하게 수립할 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '상가건물 임대차보호법',
            articleNumber: '제10조',
            summary: '계약갱신 요구 등',
          },
        ],
      },
    ],
    landlord: [
      {
        clauseName: '관리비 정산 특약',
        clauseText:
          '임차인은 목적물 사용에 따른 관리비·공과금을 부담하며, 매월 정해진 일자에 이를 납부한다.',
        reason:
          '관리비 부담 주체와 납부 방식을 명확히 하지 않으면 정산 과정에서 분쟁이 발생할 수 있습니다.',
        benefit:
          '임대인은 관리비·공과금의 부담 주체와 납부 시기를 명확히 하여 정산 분쟁을 예방할 수 있습니다.',
        legalBasis: [
          {
            type: 'law_article',
            lawName: '민법',
            articleNumber: '제618조',
            summary: '임대차의 의의 및 차임 지급 의무',
          },
        ],
      },
    ],
  },
};
