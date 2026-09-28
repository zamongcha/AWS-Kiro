/**
 * 인용 표시 모듈 (CitationModule)
 *
 * 답변에 포함된 법령 조항 및 판례 번호를 구조화된 형태로 표시하는 모듈이다.
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다.
 *
 * 주요 기능:
 * - 법령 인용: 법령명 + 조항 번호 + 100자 이내 요약
 * - 판례 인용: 사건번호 + 선고일자 + 200자 이내 요지
 * - 본문 내 [1], [2] 형식 각주 번호 삽입
 * - 답변 하단 각주 번호 순 인용 목록 생성
 * - 법령/판례 원문 URL 생성
 * - 개정된 법령 표시 및 현행 법령 정보 안내
 * - 인용할 문서가 없을 경우 안내 메시지 생성
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
} from '../../common/interfaces/service-module.js';
import {
  processCitations,
  LawCitationInput,
  CaseCitationInput,
  CitationResult,
} from './citation-formatter.js';

/**
 * 인용 모듈 실행 입력 페이로드
 */
export interface CitationModulePayload {
  /** 인용 마커가 포함된 답변 본문 */
  answerText: string;
  /** 법령 인용 입력 배열 */
  lawCitations: LawCitationInput[];
  /** 판례 인용 입력 배열 */
  caseCitations: CaseCitationInput[];
}

/**
 * 인용 표시 모듈 클래스
 *
 * 답변 텍스트에 각주를 삽입하고, 인용 목록을 생성하며,
 * 원문 URL을 제공하는 모듈이다.
 */
export class CitationModule implements ServiceModule {
  private name: string = 'citation-module';
  private version: string = '1.0.0';
  private initialized: boolean = false;
  private config: ModuleConfig | null = null;

  /**
   * 모듈 초기화
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    this.name = config.name || this.name;
    this.version = config.version || this.version;
    this.initialized = true;
  }

  /**
   * 인용 처리 실행
   *
   * 입력된 답변 텍스트와 법령/판례 인용 데이터를 기반으로
   * 각주를 삽입하고 인용 목록을 생성한다.
   *
   * @param input - 모듈 입력 (payload: CitationModulePayload)
   * @returns 인용 처리 결과를 포함하는 모듈 출력
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized) {
      return {
        success: false,
        errors: [
          {
            code: 'CITATION_NOT_INITIALIZED',
            message: '인용 모듈이 초기화되지 않았습니다.',
            severity: 'critical' as any,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }

    try {
      const payload = input.payload as CitationModulePayload;

      if (!payload || typeof payload.answerText !== 'string') {
        return {
          success: false,
          errors: [
            {
              code: 'CITATION_INVALID_INPUT',
              message: '유효한 답변 텍스트가 필요합니다.',
              severity: 'low' as any,
              timestamp: new Date().toISOString(),
            },
          ],
        };
      }

      const lawCitations: LawCitationInput[] = payload.lawCitations || [];
      const caseCitations: CaseCitationInput[] = payload.caseCitations || [];

      const result: CitationResult = processCitations(
        payload.answerText,
        lawCitations,
        caseCitations
      );

      // 최종 답변 생성: 본문 + 인용 목록
      const finalText = result.noCitationMessage
        ? `${result.annotatedText}\n\n※ ${result.noCitationMessage}`
        : `${result.annotatedText}${result.footnoteList}`;

      return {
        success: true,
        data: {
          finalText,
          annotatedText: result.annotatedText,
          footnoteList: result.footnoteList,
          citations: result.citations,
          noCitationMessage: result.noCitationMessage,
          hasCitations: result.citations.length > 0,
        },
        metadata: {
          citationCount: String(result.citations.length),
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      return {
        success: false,
        errors: [
          {
            code: 'CITATION_PROCESSING_ERROR',
            message: `인용 처리 중 오류가 발생했습니다: ${errorMessage}`,
            severity: 'medium' as any,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
  }

  /**
   * 모듈 헬스체크
   */
  async healthCheck(): Promise<HealthStatus> {
    return {
      status: this.initialized
        ? HealthStatusEnum.HEALTHY
        : HealthStatusEnum.UNHEALTHY,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: this.initialized,
        moduleName: this.name,
        version: this.version,
      },
    };
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return this.name;
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return this.version;
  }
}
