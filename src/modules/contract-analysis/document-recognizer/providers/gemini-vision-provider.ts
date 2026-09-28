/**
 * @fileoverview Gemini Vision 멀티모달 OCR 제공자
 * @description Gemini Vision(gemini-3.6-flash) 멀티모달 모델을 사용하여 계약서 이미지/PDF에서
 * 텍스트를 추출한다. 로컬 개발의 기본 제공자로 사용되며, base64로 인코딩한 파일을
 * `inline_data`로 전송한다. Gemini Vision은 좌표 정보를 제공하지 않으므로 blocks를
 * 반환하지 않는다(문서 인식기는 hasCoordinates=false 로 처리).
 *
 * Gemini API 호출 규약은 로컬 서버(src/local-server/server.ts)의 callGeminiAPI와 동일하다:
 *   - 모델: gemini-3.6-flash
 *   - URL: https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}
 *   - 멀티모달: contents[].parts 에 inline_data(base64 이미지/PDF) 포함
 *
 * @requirements 1.3 - 문서 인식기가 Gemini Vision 멀티모달 인식으로 텍스트를 추출한다
 */

import type {
  OcrProvider,
  OcrRequest,
  OcrResult,
} from '../../interfaces/document-recognizer.js';
import { ContractS3Store } from '../../storage/s3-store.js';

/** Gemini Vision 제공자 설정 인터페이스 */
export interface GeminiVisionProviderConfig {
  /** Gemini API 키 (미지정 시 GEMINI_API_KEY 환경 변수 사용) */
  apiKey?: string;
  /** Gemini 모델명 (기본: gemini-3.6-flash) */
  model?: string;
  /** S3 원본 파일을 조회할 저장소 (미지정 시 기본 ContractS3Store 생성) */
  s3Store?: ContractS3Store;
}

/** 기본 Gemini 모델명 */
const DEFAULT_MODEL = 'gemini-3.6-flash';

/** 텍스트 추출용 시스템 프롬프트 */
const OCR_SYSTEM_PROMPT = [
  '당신은 대한민국 부동산 계약서 텍스트 추출 전문 도구입니다.',
  '첨부된 계약서 이미지 또는 PDF에서 모든 텍스트를 원문 그대로 추출하세요.',
  '',
  '규칙:',
  '- 조항 번호, 특약사항, 표에 포함된 금액·날짜·당사자 정보를 빠짐없이 추출하세요.',
  '- 원문의 줄바꿈과 조항 구분을 최대한 보존하세요.',
  '- 요약하거나 해설하지 말고, 문서에 적힌 텍스트만 그대로 출력하세요.',
  '- 추출한 텍스트 외의 설명·머리말·꼬리말을 덧붙이지 마세요.',
].join('\n');

/**
 * Gemini Vision 멀티모달 OCR 제공자
 *
 * S3에서 원본 파일을 내려받아 base64로 인코딩한 뒤 Gemini Vision에 전송하여
 * 텍스트를 추출한다. 좌표(blocks)는 반환하지 않는다.
 */
export class GeminiVisionProvider implements OcrProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly s3Store: ContractS3Store;

  constructor(config: GeminiVisionProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
    this.model = config.model ?? DEFAULT_MODEL;
    this.s3Store = config.s3Store ?? new ContractS3Store();
  }

  /**
   * Gemini Vision을 사용하여 텍스트를 추출한다.
   *
   * 1. S3에서 원본 파일(바이너리)을 조회한다.
   * 2. base64로 인코딩하여 inline_data로 Gemini에 전송한다.
   * 3. 응답 텍스트를 추출하여 반환한다(좌표 없음).
   *
   * @param input - OCR 요청 (documentId, s3Key, mimeType)
   * @returns 추출된 텍스트를 담은 OCR 결과 (blocks 없음)
   * @throws API 키 미설정, 파일 조회 실패, API 호출 실패 시 오류
   */
  async extractText(input: OcrRequest): Promise<OcrResult> {
    if (!this.isKeyValid()) {
      throw new Error(
        'Gemini API 키가 설정되지 않았습니다. GEMINI_API_KEY 환경 변수를 확인하세요.',
      );
    }

    // 1. S3에서 원본 파일 조회 후 base64 인코딩
    const binary = await this.s3Store.getOriginal(input.s3Key);
    const base64Data = Buffer.from(binary).toString('base64');

    // 2. Gemini Vision 멀티모달 요청 구성 (텍스트 프롬프트 + inline_data)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const requestBody = {
      contents: [
        {
          parts: [
            { text: OCR_SYSTEM_PROMPT },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 8192,
      },
    };

    // 3. API 호출
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Gemini Vision API 호출 실패: ${response.status} ${errorBody}`,
      );
    }

    const data = (await response.json()) as GeminiResponse;
    const text = this.extractResponseText(data);

    // Gemini Vision은 좌표를 제공하지 않으므로 blocks를 반환하지 않는다.
    return { text };
  }

  /**
   * API 키가 유효한지(비어있지 않고 placeholder가 아닌지) 확인한다.
   *
   * @returns 키 유효 여부
   */
  private isKeyValid(): boolean {
    return this.apiKey !== '' && this.apiKey !== 'YOUR_API_KEY_HERE';
  }

  /**
   * Gemini 응답에서 텍스트를 추출한다.
   *
   * @param data - Gemini generateContent 응답
   * @returns 추출된 텍스트 (없으면 빈 문자열)
   */
  private extractResponseText(data: GeminiResponse): string {
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      return '';
    }
    return parts
      .map((part) => part.text ?? '')
      .join('')
      .trim();
  }
}

/** Gemini generateContent 응답 (필요 필드만 정의) */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}
