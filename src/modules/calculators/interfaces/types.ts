/**
 * 부동산 계산기 통합 시스템 기본 타입 정의
 *
 * 취득비용·양도소득세·중개수수료 계산기 전반에서 사용되는 핵심 공통 타입을
 * 정의한다. 계산기 유형, 부동산 유형, 주택 수, 거래 유형, 취득세 감면 유형,
 * 금액 단위 등 결정론적 계산에 필요한 열거형 타입을 포함한다.
 */

/**
 * 계산기 유형
 *
 * 취득비용 | 양도소득세 | 중개수수료
 */
export type CalculatorType = 'acquisition' | 'transfer_tax' | 'brokerage';

/**
 * 부동산 유형
 *
 * 주택 | 비주택
 */
export type PropertyType = 'house' | 'non_house';

/**
 * 비주택 세부 유형
 *
 * 비주택(non_house) 취득세율은 취득 대상의 성격에 따라 세분화된다. propertyType이
 * 'non_house'일 때만 유효하며, 미지정 시 'general'(일반 유상취득)로 간주한다.
 *
 * - general: 상가·건물·토지 등 일반 유상취득 (참고용 추정치 4%)
 * - farmland: 농지 유상취득 (참고용 추정치 3%)
 * - original_acquisition: 원시취득(신축 보존등기) (참고용 추정치 2.8%)
 */
export type NonHouseType = 'general' | 'farmland' | 'original_acquisition';

/**
 * 중개수수료 물건 유형
 *
 * 주택 | 오피스텔 | 주택 외
 */
export type BrokeragePropertyType = 'house' | 'officetel' | 'other';

/**
 * 주택 수
 *
 * 1주택 | 2주택 | 3주택 이상
 */
export type HousingCount = 'one' | 'two' | 'three_or_more';

/**
 * 거래 유형 (중개수수료)
 *
 * 매매/교환 | 임대차
 */
export type TransactionType = 'sale_exchange' | 'lease';

/**
 * 취득세 감면 유형
 *
 * 생애최초 주택 구입 | 신혼부부 | 장기임대사업자 등록 임대주택 | 감면 없음
 */
export type AcquisitionReductionType =
  | 'first_time_buyer'
  | 'newlywed'
  | 'long_term_rental_business'
  | 'none';

/**
 * 금액 단위 (원 기준)
 */
export type CurrencyUnit = 'KRW';
