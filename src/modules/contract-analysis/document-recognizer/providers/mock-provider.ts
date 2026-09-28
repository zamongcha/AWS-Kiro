/**
 * @fileoverview Mock OCR 제공자 (결정적 텍스트 추출)
 * @description 외부 API(Gemini/Textract) 호출 없이 입력값에 따라 고정된(결정적) 텍스트를
 * 반환하는 테스트/로컬 개발용 OCR 제공자이다. 동일한 입력에 대해 항상 동일한 출력을
 * 반환하므로 단위 테스트·속성 기반 테스트·오프라인 로컬 개발에 적합하다.
 *
 * 좌표(blocks)는 반환하지 않으므로 문서 인식기는 hasCoordinates=false 로 처리한다.
 *
 * @requirements 1.3 - 문서 인식기가 계약서 이미지/PDF로부터 텍스트를 추출한다
 */

import type {
  OcrProvider,
  OcrRequest,
  OcrResult,
} from '../../interfaces/document-recognizer.js';

/** Mock 제공자 설정 인터페이스 */
export interface MockOcrProviderConfig {
  /**
   * 고정 반환 텍스트를 직접 지정한다. 지정 시 documentId와 무관하게 이 텍스트를 반환한다.
   * (테스트에서 특정 시나리오를 강제할 때 사용)
   */
  fixedText?: string;
}

/**
 * 계약 유형별 결정적 Mock 계약서 본문 조각.
 *
 * documentId 문자열에 특정 키워드가 포함되면 해당 유형의 표본 텍스트를 반환한다.
 * 어떤 키워드에도 해당하지 않으면 기본(매매) 표본을 사용한다.
 */
const MOCK_CONTRACT_TEXTS: Record<string, string> = {
  jeonse: [
    '부동산 전세계약서',
    '제1조 (목적) 위 부동산의 임대차에 한하여 임대인과 임차인은 합의에 의하여 전세보증금을 아래와 같이 지불하기로 한다.',
    '제2조 (존속기간) 임대인은 위 부동산을 전세목적대로 사용·수익할 수 있는 상태로 임차인에게 인도한다.',
    '제3조 (보증금) 전세보증금은 금 삼억원정(₩300,000,000)으로 한다.',
    '특약사항: 임차인은 전입신고와 확정일자를 받을 수 있으며, 임대인은 이에 협조한다.',
  ].join('\n'),
  wolse: [
    '부동산 월세계약서',
    '제1조 (목적) 위 부동산의 임대차에 한하여 임대인과 임차인은 합의에 의하여 임대차보증금 및 차임을 아래와 같이 지불하기로 한다.',
    '제2조 (보증금 및 차임) 보증금은 금 오천만원정(₩50,000,000), 월 차임은 금 팔십만원정(₩800,000)으로 한다.',
    '제3조 (관리비) 관리비는 월 십만원(₩100,000)으로 한다.',
    '특약사항: 월세 연체 시 임대인은 계약을 해지할 수 있다.',
  ].join('\n'),
  commercial: [
    '상가건물 임대차계약서',
    '제1조 (목적) 위 상가건물의 임대차에 관하여 임대인과 임차인은 아래와 같이 계약을 체결한다.',
    '제2조 (보증금 및 차임) 보증금은 금 일억원정(₩100,000,000), 월 차임은 금 삼백만원정(₩3,000,000)으로 한다.',
    '제3조 (권리금) 권리금에 관한 사항은 별도로 정한다.',
    '특약사항: 임차인은 영업 목적으로만 사용하며, 임대인의 동의 없이 전대할 수 없다.',
  ].join('\n'),
  sale: [
    '부동산 매매계약서',
    '제1조 (목적) 위 부동산의 매매에 관하여 매도인과 매수인은 합의에 의하여 매매대금을 아래와 같이 지불하기로 한다.',
    '제2조 (매매대금) 매매대금은 금 오억원정(₩500,000,000)으로 한다.',
    '제3조 (소유권 이전) 매도인은 잔금 수령과 동시에 소유권이전등기에 필요한 모든 서류를 매수인에게 교부한다.',
    '특약사항: 등기부등본상 근저당권은 잔금 지급 전까지 매도인이 말소한다.',
  ].join('\n'),
};

/**
 * documentId에서 계약 유형 키를 추정한다.
 *
 * @param documentId - 문서 식별자
 * @returns 추정된 계약 유형 키 (sale | jeonse | wolse | commercial)
 */
function inferContractKey(documentId: string): keyof typeof MOCK_CONTRACT_TEXTS {
  const lower = documentId.toLowerCase();
  if (lower.includes('jeonse') || lower.includes('전세')) {
    return 'jeonse';
  }
  if (lower.includes('wolse') || lower.includes('월세')) {
    return 'wolse';
  }
  if (lower.includes('commercial') || lower.includes('상가')) {
    return 'commercial';
  }
  return 'sale';
}

/**
 * Mock OCR 제공자
 *
 * 입력값(documentId 또는 설정된 fixedText)에 따라 결정적으로 동일한 텍스트를 반환한다.
 * 외부 네트워크 호출이 전혀 없으므로 테스트와 로컬 개발에서 안정적으로 사용할 수 있다.
 */
export class MockOcrProvider implements OcrProvider {
  private readonly config: MockOcrProviderConfig;

  constructor(config: MockOcrProviderConfig = {}) {
    this.config = config;
  }

  /**
   * 결정적 텍스트를 추출한다.
   *
   * fixedText가 설정되어 있으면 항상 해당 텍스트를 반환하고,
   * 그렇지 않으면 documentId로부터 계약 유형을 추정하여 대응하는 표본 텍스트를 반환한다.
   * 좌표 블록은 반환하지 않는다.
   *
   * @param input - OCR 요청 (documentId, s3Key, mimeType)
   * @returns 추출된 텍스트를 담은 OCR 결과 (blocks 없음)
   */
  async extractText(input: OcrRequest): Promise<OcrResult> {
    if (this.config.fixedText !== undefined) {
      return { text: this.config.fixedText };
    }

    const key = inferContractKey(input.documentId);
    return { text: MOCK_CONTRACT_TEXTS[key] };
  }
}
