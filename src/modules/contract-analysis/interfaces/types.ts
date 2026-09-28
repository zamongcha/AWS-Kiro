/**
 * 계약서 AI 분석 서비스 기본 타입 정의
 *
 * 계약 유형, 당사자 관점, 위험도 등급, 당사자 관점 기준 유불리,
 * 위험 조항 원문 매칭 스팬, 문서 좌표 등 계약서 분석 모듈 전반에서
 * 사용되는 핵심 공통 타입을 정의한다.
 */

/**
 * 계약 유형
 *
 * 매매 | 전세 | 월세 | 상가임대차
 */
export type ContractType = 'sale' | 'jeonse' | 'wolse' | 'commercial_lease';

/**
 * 당사자 관점
 *
 * 매수인 | 매도인 | 임대인 | 임차인
 */
export type PartyPerspective = 'buyer' | 'seller' | 'landlord' | 'tenant';

/**
 * 위험도 등급
 *
 * 상(빨강) | 중(노랑) | 하(초록)
 */
export type RiskGrade = 'high' | 'medium' | 'low';

/**
 * 당사자 관점 기준 유불리
 *
 * 불리 | 중립 | 유리
 */
export type PartyImpact = 'disadvantageous' | 'neutral' | 'advantageous';

/**
 * 위험 조항 원문 매칭 (텍스트 매칭 하이라이트용)
 *
 * 탐지된 위험 조항의 원문 위치를 표현하며, 프론트엔드 하이라이트에 사용된다.
 */
export interface ClauseSpan {
  /** 문서 내 고유 조항 식별자 */
  clauseId: string;
  /** 원문 매칭 문구 (100자 미만이면 조항 전체, 5000자 초과 시 절단) */
  matchedText: string;
  /** 추출 텍스트 내 시작 위치 */
  startOffset?: number;
  /** 추출 텍스트 내 끝 위치 */
  endOffset?: number;
  /** Textract 좌표 (존재 시) */
  boundingBox?: BoundingBox;
}

/**
 * 문서 좌표 (Textract 등 정밀 OCR 제공자가 반환하는 위치 정보)
 */
export interface BoundingBox {
  /** 페이지 번호 */
  page: number;
  /** 좌측 위치 (0.0~1.0 상대 좌표) */
  left: number;
  /** 상단 위치 (0.0~1.0 상대 좌표) */
  top: number;
  /** 너비 (0.0~1.0 상대 좌표) */
  width: number;
  /** 높이 (0.0~1.0 상대 좌표) */
  height: number;
}
