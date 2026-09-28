/**
 * @fileoverview OCR 제공자 어댑터 인터페이스 재노출 및 팩토리
 * @description 문서 인식기가 사용하는 OCR 제공자(Gemini Vision / AWS Textract / Mock)를
 * 공통 어댑터 인터페이스(OcrProvider) 뒤에 두고, `OCR_PROVIDER` 환경 변수로 교체할 수 있는
 * 팩토리를 제공한다.
 *
 * 제공자 선택 규칙(OCR_PROVIDER):
 *   - 'multimodal'       → Gemini Vision (로컬 기본, 좌표 없음)
 *   - 'textract_precise' → AWS Textract (배포 정밀 OCR, 좌표 포함)
 *   - 'mock'             → Mock (결정적 텍스트, 테스트/오프라인용)
 *
 * 환경 변수가 없거나 알 수 없는 값이면 로컬 개발 기본값인 'multimodal'을 사용한다.
 *
 * @requirements 1.3 - Gemini Vision 멀티모달 텍스트 추출
 * @requirements 1.11 - Textract 정밀 OCR 좌표 포함 추출
 */

// OcrProvider 어댑터 인터페이스 및 관련 타입 재노출
export type {
  OcrProvider,
  OcrRequest,
  OcrResult,
  OcrBlock,
} from '../../interfaces/document-recognizer.js';

import type { OcrProvider } from '../../interfaces/document-recognizer.js';
import { GeminiVisionProvider } from './gemini-vision-provider.js';
import { TextractProvider } from './textract-provider.js';
import { MockOcrProvider } from './mock-provider.js';

/** OCR 제공자 종류 */
export type OcrProviderKind = 'multimodal' | 'textract_precise' | 'mock';

/** 기본 OCR 제공자 종류 (로컬 개발 기본: Gemini Vision 멀티모달) */
export const DEFAULT_OCR_PROVIDER: OcrProviderKind = 'multimodal';

/**
 * `OCR_PROVIDER` 환경 변수 값을 정규화하여 유효한 제공자 종류로 변환한다.
 *
 * @param raw - 환경 변수 원시 값
 * @returns 유효한 OcrProviderKind (알 수 없는 값이면 기본값)
 */
export function resolveOcrProviderKind(raw: string | undefined): OcrProviderKind {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'multimodal':
      return 'multimodal';
    case 'textract_precise':
      return 'textract_precise';
    case 'mock':
      return 'mock';
    default:
      return DEFAULT_OCR_PROVIDER;
  }
}

/**
 * 지정한 종류의 OCR 제공자 인스턴스를 생성한다.
 *
 * @param kind - 생성할 제공자 종류
 * @returns OcrProvider 구현 인스턴스
 */
export function createOcrProviderByKind(kind: OcrProviderKind): OcrProvider {
  switch (kind) {
    case 'textract_precise':
      return new TextractProvider();
    case 'mock':
      return new MockOcrProvider();
    case 'multimodal':
    default:
      return new GeminiVisionProvider();
  }
}

/**
 * `OCR_PROVIDER` 환경 변수(또는 명시적 인자)에 따라 OCR 제공자를 생성하는 팩토리.
 *
 * @param override - 환경 변수 대신 강제로 사용할 제공자 종류 (선택)
 * @returns 선택된 OcrProvider 구현 인스턴스
 */
export function createOcrProvider(override?: OcrProviderKind): OcrProvider {
  const kind = override ?? resolveOcrProviderKind(process.env['OCR_PROVIDER']);
  return createOcrProviderByKind(kind);
}
