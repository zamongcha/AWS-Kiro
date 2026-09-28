/**
 * @fileoverview 등기부등본 정보 추출기 (RegistryExtractor)
 * @description 업로드된 등기부등본 파일(JPEG/PNG/PDF, ≤20MB)을 검증한 뒤,
 * OCR 제공자(document-recognizer의 OcrProvider 재사용)로 텍스트를 추출하고
 * 정규식/키워드 파싱으로 근저당 설정액·선순위 채권·소유자 정보를 뽑아낸다.
 *
 * 규칙:
 *   - 형식/크기 위반 시 거부하고 표준 오류로 안내하며, 기존 입력을 보존한다.
 *   - 파싱 실패 항목은 extractionFailures에 담으며, 실패 항목이 있으면 위험도
 *     산출을 진행하지 않는다(상위 FraudScorer가 이를 확인).
 *   - 외부 자동 조회를 하지 않고 오직 업로드된 파일(OCR 텍스트)만 사용한다.
 *
 * @requirements 5.1 - 등기부등본 파일(JPEG/PNG/PDF, ≤20MB) 업로드·검증
 * @requirements 5.2 - 형식/크기 위반 거부 및 안내, 기존 입력 보존
 * @requirements 5.3 - 근저당 설정액·선순위 채권·소유자 정보 추출
 * @requirements 5.4 - 추출 실패 항목 명시 시 위험도 산출 미진행, 입력 보존
 * @requirements 5.10 - 외부 자동 조회 금지, 업로드 파일만 사용
 */

import type { OcrProvider, OcrRequest } from '../interfaces/document-recognizer.js';
import type { RegistryInfo } from '../interfaces/registry-matcher.js';
import type { ErrorResponse } from '../../../common/interfaces/service-module.js';
import {
  UploadValidator,
  MAX_FILE_SIZE_BYTES,
} from '../upload/upload-validator.js';

/** 등기부등본 추출 실패 항목 식별자 */
export type RegistryExtractionField = 'mortgageAmount' | 'seniorClaims' | 'ownerName';

/** 파일 검증 실패 오류 코드 */
export const ERROR_CODE_REGISTRY_INVALID_FILE = 'CONTRACT_REGISTRY_INVALID_FILE';

/**
 * 등기부등본 추출 입력
 */
export interface RegistryExtractionInput {
  /** 문서 식별자 */
  documentId: string;
  /** 등기부등본 파일 S3 키 */
  registryS3Key: string;
  /** 파일 MIME 타입 */
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  /** 업로드 파일 크기 (바이트) */
  sizeBytes: number;
}

/**
 * 등기부등본 추출 결과
 *
 * `valid`가 false이면 파일 검증에 실패한 것이며 `error`에 표준 오류가 담긴다.
 * `valid`가 true이면 추출된 정보(`info`)와 실패 항목(`extractionFailures`)을 함께 제공한다.
 * 실패 항목이 하나라도 있으면 위험도 산출을 진행하지 않아야 한다.
 */
export type RegistryExtractionResult =
  | { valid: false; error: ErrorResponse }
  | {
      valid: true;
      /** 추출된 등기부 정보 (실패 항목은 0으로 채워짐) */
      info: RegistryInfo;
      /** 파싱 실패 항목 목록 (비어있으면 위험도 산출 가능) */
      extractionFailures: RegistryExtractionField[];
      /** 추출에 사용한 원본 OCR 텍스트 */
      rawText: string;
    };

/** 한국어 금액 억/만 단위 매핑 */
const AMOUNT_UNIT_MULTIPLIER: Record<string, number> = {
  억: 100_000_000,
  만: 10_000,
  천: 1_000,
};

/**
 * 등기부등본 정보 추출기
 *
 * 파일 검증(UploadValidator 재사용) → OCR 텍스트 추출(OcrProvider 재사용) →
 * 정규식/키워드 파싱의 순서로 동작한다. 외부 등기소 자동 조회는 수행하지 않는다.
 */
export class RegistryExtractor {
  private readonly ocrProvider: OcrProvider;
  private readonly validator: UploadValidator;

  constructor(ocrProvider: OcrProvider, validator: UploadValidator = new UploadValidator()) {
    this.ocrProvider = ocrProvider;
    this.validator = validator;
  }

  /**
   * 등기부등본 파일을 검증하고 정보를 추출한다.
   *
   * 형식/크기 위반 시 표준 오류를 담은 실패 결과를 반환하며(기존 입력은
   * 상위 계층에서 보존), 검증 통과 시 OCR 텍스트를 파싱하여 근저당액·선순위
   * 채권·소유자를 추출한다. 파싱하지 못한 항목은 extractionFailures에 담는다.
   *
   * @param input - 추출 입력 (파일 위치·형식·크기)
   * @returns 추출 결과 (검증 실패 또는 추출 정보 + 실패 항목)
   * @requirements 5.1, 5.2, 5.3, 5.4, 5.10
   */
  async extract(input: RegistryExtractionInput): Promise<RegistryExtractionResult> {
    // 1) 형식/크기 검증 (JPEG/PNG/PDF, 1KB~20MB) — 재사용
    const validation = this.validator.validate({
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    if (!validation.valid) {
      // 안내 메시지를 등기부등본 맥락으로 보강한 오류를 반환한다.
      return {
        valid: false,
        error: {
          ...validation.error,
          code: ERROR_CODE_REGISTRY_INVALID_FILE,
          message: `등기부등본 ${validation.error.message}`,
          context: {
            ...(validation.error.context ?? {}),
            maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
            documentId: input.documentId,
          },
        },
      };
    }

    // 2) OCR로 텍스트만 추출 (외부 자동 조회 없이 업로드 파일만 사용)
    const request: OcrRequest = {
      documentId: input.documentId,
      s3Key: input.registryS3Key,
      mimeType: input.mimeType,
    };
    const ocrResult = await this.ocrProvider.extractText(request);
    const text = ocrResult.text ?? '';

    // 3) 정규식/키워드 파싱
    const parsed = this.parseRegistryText(text);

    return {
      valid: true,
      info: parsed.info,
      extractionFailures: parsed.failures,
      rawText: text,
    };
  }

  /**
   * OCR 텍스트에서 근저당 설정액·선순위 채권·소유자를 파싱한다.
   *
   * 각 항목을 개별적으로 시도하며, 값을 찾지 못한 항목은 실패 목록에 담고
   * 정보 필드는 0(금액) 또는 빈 문자열(소유자)로 채운다.
   *
   * @param text - OCR로 추출한 등기부 텍스트
   * @returns 파싱된 정보와 실패 항목 목록
   */
  private parseRegistryText(text: string): {
    info: RegistryInfo;
    failures: RegistryExtractionField[];
  } {
    const failures: RegistryExtractionField[] = [];

    const mortgageAmount = this.parseAmountNear(text, ['근저당권설정', '근저당권', '채권최고액']);
    if (mortgageAmount === null) {
      failures.push('mortgageAmount');
    }

    const seniorClaims = this.parseAmountNear(text, ['선순위', '선순위채권', '전세권']);
    if (seniorClaims === null) {
      failures.push('seniorClaims');
    }

    const ownerName = this.parseOwnerName(text);
    if (ownerName === null) {
      failures.push('ownerName');
    }

    return {
      info: {
        mortgageAmount: mortgageAmount ?? 0,
        seniorClaims: seniorClaims ?? 0,
        ownerName: ownerName ?? '',
      },
      failures,
    };
  }

  /**
   * 지정한 키워드 뒤에 등장하는 금액을 파싱한다.
   *
   * 숫자(콤마 포함) 또는 한글 금액 표기(예: "삼억원", "1억 5천만원")를 인식한다.
   * 키워드 근처에서 금액을 찾지 못하면 null을 반환한다.
   *
   * @param text - 전체 텍스트
   * @param keywords - 금액 앞에 등장할 수 있는 키워드 목록
   * @returns 파싱된 금액(원) 또는 null
   */
  private parseAmountNear(text: string, keywords: string[]): number | null {
    for (const keyword of keywords) {
      const idx = text.indexOf(keyword);
      if (idx === -1) {
        continue;
      }
      // 키워드 이후 120자 범위 내에서 금액을 탐색한다.
      const window = text.slice(idx, idx + 120);
      const amount = this.parseAmountFromSegment(window);
      if (amount !== null) {
        return amount;
      }
    }
    return null;
  }

  /**
   * 텍스트 조각에서 금액을 파싱한다.
   *
   * 우선 아라비아 숫자(예: "300,000,000" 또는 "₩300,000,000")를 시도하고,
   * 실패하면 한글 금액 표기(예: "삼억원", "5천만원")를 시도한다.
   *
   * @param segment - 금액이 포함되었을 수 있는 텍스트 조각
   * @returns 파싱된 금액(원) 또는 null
   */
  private parseAmountFromSegment(segment: string): number | null {
    // 1) 아라비아 숫자 (₩ 또는 금 기호 뒤, 콤마 포함, 4자리 이상)
    const numericMatch = segment.match(/[₩]?\s*([0-9][0-9,]{3,})\s*원?/);
    if (numericMatch) {
      const digits = numericMatch[1].replace(/,/g, '');
      const value = Number(digits);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }

    // 2) 한글 금액 표기 (예: "삼억원", "일억오천만원", "5천만원")
    const koreanValue = this.parseKoreanAmount(segment);
    if (koreanValue !== null) {
      return koreanValue;
    }

    return null;
  }

  /**
   * 한글 금액 표기를 정수(원)로 변환한다.
   *
   * 억/만/천 단위와 한글 숫자(영~구) 및 아라비아 숫자 조합을 처리한다.
   * 예: "삼억원" → 300000000, "일억오천만원" → 150000000, "5천만원" → 50000000.
   *
   * @param segment - 한글 금액 표기가 포함된 텍스트
   * @returns 파싱된 금액(원) 또는 null
   */
  private parseKoreanAmount(segment: string): number | null {
    const koreanDigits: Record<string, number> = {
      영: 0, 일: 1, 이: 2, 삼: 3, 사: 4,
      오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9,
    };

    // "금 ... 원" 사이 또는 금액 표기 구간을 대상으로 한다.
    const amountRegion = segment.match(/(?:금\s*)?([0-9일이삼사오육칠팔구천만억]+)\s*원/);
    if (!amountRegion) {
      return null;
    }
    const expr = amountRegion[1];

    let total = 0;
    let currentNumber = 0;
    let matchedUnit = false;

    for (const char of expr) {
      if (/[0-9]/.test(char)) {
        currentNumber = currentNumber * 10 + Number(char);
      } else if (char in koreanDigits) {
        currentNumber = currentNumber * 10 + koreanDigits[char];
      } else if (char in AMOUNT_UNIT_MULTIPLIER) {
        const digit = currentNumber === 0 ? 1 : currentNumber;
        total += digit * AMOUNT_UNIT_MULTIPLIER[char];
        currentNumber = 0;
        matchedUnit = true;
      }
    }
    total += currentNumber;

    if (!matchedUnit && total === 0) {
      return null;
    }
    return total > 0 ? total : null;
  }

  /**
   * 등기부 텍스트에서 소유자 이름을 파싱한다.
   *
   * "소유자", "소유권자", "등기명의인" 키워드 뒤에 등장하는 한글 이름(2~4자)을 추출한다.
   * 이름을 찾지 못하면 null을 반환한다.
   *
   * @param text - 전체 텍스트
   * @returns 파싱된 소유자 이름 또는 null
   */
  private parseOwnerName(text: string): string | null {
    const ownerMatch = text.match(
      /(?:소유자|소유권자|등기명의인)\s*[:：]?\s*([가-힣]{2,4})/,
    );
    if (ownerMatch && ownerMatch[1]) {
      return ownerMatch[1].trim();
    }
    return null;
  }
}
