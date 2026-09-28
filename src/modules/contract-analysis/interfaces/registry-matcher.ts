/**
 * 등기부 대조기 (registry-matcher) 인터페이스 정의
 *
 * 등기부등본 파일에서 근저당 설정액·선순위 채권·소유자 정보를 추출하고
 * 계약서상 정보와 대조하여 전세가율·선순위 비율·소유자 불일치를 산출하는
 * 대조기의 입출력 타입을 정의한다.
 */

/**
 * 등기부 대조기 입력
 */
export interface RegistryMatcherInput {
  /** 문서 식별자 */
  documentId: string;
  /** 등기부등본 파일 S3 키 */
  registryS3Key: string;
  /** 파일 MIME 타입 */
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  /** 계약서상 보증금 (원) */
  contractDeposit: number;
  /** 주택 시세 (원) */
  marketPrice: number;
  /** 계약서상 임대인 */
  contractLandlordName: string;
}

/**
 * 등기부 대조 결과
 */
export interface RegistryMatchResult {
  /** 추출된 등기부 정보 */
  extractedInfo: RegistryInfo;
  /** 전세가율 (%) */
  jeonseRatio: number;
  /** 선순위 채권 비율 (%) */
  seniorClaimRatio: number;
  /** 소유자 불일치 여부 */
  ownerMismatch: boolean;
  /** 추출 실패 항목 (있으면 위험도 산출 중단) */
  extractionFailures: string[];
}

/**
 * 등기부 추출 정보
 */
export interface RegistryInfo {
  /** 근저당권 설정 금액 (원) */
  mortgageAmount: number;
  /** 선순위 채권 총액 (원) */
  seniorClaims: number;
  /** 등기부상 소유자 */
  ownerName: string;
}
