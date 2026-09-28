/**
 * @fileoverview AWS Textract 정밀 OCR 제공자
 * @description AWS Textract를 사용하여 계약서 이미지에서 좌표(BoundingBox)를 포함한
 * 정밀 텍스트를 추출한다. 배포 환경에서 정밀 하이라이트가 필요한 경우 사용하며,
 * 로컬 개발에서는 사용하지 않는다(로컬 기본은 Gemini Vision).
 *
 * Textract는 LINE 블록 단위로 텍스트와 상대 좌표(0.0~1.0)를 반환하며,
 * 이를 OcrBlock(BoundingBox 포함)으로 변환한다(hasCoordinates=true).
 *
 * 주의: 이미지(JPEG/PNG)는 DetectDocumentText 동기 API로 처리 가능하지만,
 * 멀티페이지 PDF는 비동기 API(StartDocumentTextDetection)가 필요하다. 본 구현은
 * S3 오브젝트를 대상으로 동기 API를 사용하며, PDF의 경우 첫 페이지 기준으로 처리한다.
 *
 * @requirements 1.11 - Textract 정밀 OCR 옵션 활성화 시 좌표 기반 위치 정보 포함 추출
 */

import {
  TextractClient,
  DetectDocumentTextCommand,
  type Block,
} from '@aws-sdk/client-textract';
import type {
  OcrProvider,
  OcrRequest,
  OcrResult,
  OcrBlock,
} from '../../interfaces/document-recognizer.js';

/** Textract 제공자 설정 인터페이스 */
export interface TextractProviderConfig {
  /** AWS 리전 (기본: AWS_REGION 환경 변수 또는 ap-northeast-2) */
  region?: string;
  /** 원본 파일이 위치한 S3 버킷 (기본: real-estate-data-{ENVIRONMENT}) */
  bucketName?: string;
  /** 사전 구성된 TextractClient 주입 (테스트용) */
  client?: TextractClient;
}

/** 기본 버킷 이름 계산 */
function defaultBucketName(): string {
  return `real-estate-data-${process.env['ENVIRONMENT'] || 'dev'}`;
}

/**
 * AWS Textract 정밀 OCR 제공자
 *
 * S3에 저장된 계약서 파일을 Textract로 분석하여 좌표 포함 텍스트 블록을 반환한다.
 */
export class TextractProvider implements OcrProvider {
  private readonly client: TextractClient;
  private readonly bucketName: string;

  constructor(config: TextractProviderConfig = {}) {
    const region = config.region ?? process.env['AWS_REGION'] ?? 'ap-northeast-2';
    this.client = config.client ?? new TextractClient({ region });
    this.bucketName = config.bucketName ?? defaultBucketName();
  }

  /**
   * Textract를 사용하여 좌표 포함 텍스트를 추출한다.
   *
   * S3 오브젝트(input.s3Key)를 대상으로 DetectDocumentText를 호출하고,
   * LINE 블록을 순서대로 이어붙여 전체 텍스트를 구성하며 각 라인을 좌표 블록으로 변환한다.
   *
   * @param input - OCR 요청 (documentId, s3Key, mimeType)
   * @returns 추출된 텍스트와 좌표 포함 블록(OcrBlock[])
   * @throws Textract 호출 실패 시 오류
   */
  async extractText(input: OcrRequest): Promise<OcrResult> {
    const command = new DetectDocumentTextCommand({
      Document: {
        S3Object: {
          Bucket: this.bucketName,
          Name: input.s3Key,
        },
      },
    });

    const response = await this.client.send(command);
    const blocks = response.Blocks ?? [];

    // LINE 블록만 추출하여 텍스트와 좌표 블록을 구성한다.
    const lineBlocks = blocks.filter((block) => block.BlockType === 'LINE');

    const textLines: string[] = [];
    const ocrBlocks: OcrBlock[] = [];

    for (const block of lineBlocks) {
      const lineText = block.Text ?? '';
      textLines.push(lineText);

      const ocrBlock = this.toOcrBlock(block, lineText);
      if (ocrBlock) {
        ocrBlocks.push(ocrBlock);
      }
    }

    return {
      text: textLines.join('\n'),
      blocks: ocrBlocks,
    };
  }

  /**
   * Textract LINE 블록을 좌표 포함 OcrBlock으로 변환한다.
   *
   * Textract의 Geometry.BoundingBox는 0.0~1.0 상대 좌표를 사용하며,
   * 페이지 번호는 Block.Page(없으면 1)를 사용한다.
   *
   * @param block - Textract LINE 블록
   * @param text - 블록 텍스트
   * @returns 좌표 정보가 유효하면 OcrBlock, 없으면 null
   */
  private toOcrBlock(block: Block, text: string): OcrBlock | null {
    const boundingBox = block.Geometry?.BoundingBox;
    if (!boundingBox) {
      return null;
    }

    return {
      text,
      boundingBox: {
        page: block.Page ?? 1,
        left: boundingBox.Left ?? 0,
        top: boundingBox.Top ?? 0,
        width: boundingBox.Width ?? 0,
        height: boundingBox.Height ?? 0,
      },
    };
  }
}
