/**
 * @fileoverview 질문 처리 인터페이스 모듈
 * @description 사용자 질문 입력을 검증하고 세션을 관리하는 핵심 모듈이다.
 * 입력 검증(10~1000자), 세션 CRUD(최대 50개 대화, 24시간 TTL)를 제공하며,
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다.
 *
 * @requirements 6.1 - 입력 길이 검증 (10~1000자)
 * @requirements 6.6 - 대화 이력 최대 50개 유지
 * @requirements 6.8 - 빈 입력 거부, TTL 기반 자동 만료
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../common/interfaces/service-module.js';
import { InputValidator } from './input-validator.js';
import { SessionManager } from './session-manager.js';

/**
 * 질문 처리 모듈 입력 페이로드 타입
 */
export interface QueryHandlerPayload {
  /** 수행할 작업 유형 */
  action: 'validate' | 'createSession' | 'getSession' | 'addConversation';
  /** 사용자 질문 (validate, addConversation에 사용) */
  query?: string;
  /** 세션 ID (getSession, addConversation에 사용) */
  sessionId?: string;
  /** AI 답변 (addConversation에 사용) */
  answer?: string;
  /** 인용 정보 (addConversation에 사용) */
  citations?: unknown[];
}

/**
 * 질문 처리 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * 사용자 질문 입력 검증과 DynamoDB 세션 관리 기능을 제공한다.
 *
 * 주요 기능:
 * - 입력 검증: 10~1000자 길이 제한, 빈 입력 거부
 * - 세션 생성: 고유 ID + 24시간 TTL
 * - 세션 조회: sessionId 기반 단건 조회
 * - 대화 추가: Q&A 쌍 추가 (최대 50개 유지, 초과 시 오래된 항목 제거)
 *
 * @requirements 6.1, 6.6, 6.8
 */
export class QueryHandlerModule implements ServiceModule {
  private config: ModuleConfig | null = null;
  private inputValidator: InputValidator | null = null;
  private sessionManager: SessionManager | null = null;
  private initialized = false;

  /**
   * 모듈 초기화
   *
   * InputValidator와 SessionManager를 초기화한다.
   *
   * @param config - 모듈 설정
   *   config.config에 다음 필드를 포함할 수 있다:
   *   - region: AWS 리전 (기본값: 'ap-northeast-2')
   *   - sessionsTableName: DynamoDB 세션 테이블 이름 (기본값: process.env['SESSIONS_TABLE'] || 'Sessions')
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const region = (config.config['region'] as string) || 'ap-northeast-2';
    const sessionsTableName = config.config['sessionsTableName'] as string | undefined;

    // 입력 검증기 초기화
    this.inputValidator = new InputValidator();

    // 세션 관리자 초기화
    this.sessionManager = new SessionManager(region, sessionsTableName);

    this.initialized = true;
  }

  /**
   * 모듈 실행
   *
   * 입력의 action 필드에 따라 적절한 작업을 수행한다:
   * - validate: 질문 입력 검증
   * - createSession: 새 세션 생성
   * - getSession: 세션 조회
   * - addConversation: 대화 항목 추가
   *
   * @param input - 모듈 입력 (payload에 QueryHandlerPayload 포함)
   * @returns 모듈 출력
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.inputValidator || !this.sessionManager) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '질문 처리 모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const payload = input.payload as QueryHandlerPayload;

    try {
      switch (payload.action) {
        case 'validate':
          return this.handleValidate(payload.query || '');

        case 'createSession':
          return this.handleCreateSession();

        case 'getSession':
          return this.handleGetSession(payload.sessionId || '');

        case 'addConversation':
          return this.handleAddConversation(payload);

        default:
          return {
            success: false,
            errors: [{
              code: 'INVALID_ACTION',
              message: `지원하지 않는 작업입니다: ${payload.action}`,
              severity: ErrorSeverity.LOW,
              timestamp: new Date().toISOString(),
            }],
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        errors: [{
          code: 'QUERY_HANDLER_ERROR',
          message: errorMessage,
          severity: ErrorSeverity.HIGH,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

  /**
   * 모듈 헬스체크
   *
   * 모듈 초기화 상태를 확인한다.
   */
  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { reason: 'Module not initialized' },
      };
    }

    return {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
      details: {
        initialized: true,
        tableName: this.config?.config['sessionsTableName'] || process.env['SESSIONS_TABLE'] || 'Sessions',
      },
    };
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'query-handler';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * InputValidator 인스턴스를 반환한다.
   * 외부에서 직접 검증기를 활용할 수 있도록 제공한다.
   */
  getInputValidator(): InputValidator | null {
    return this.inputValidator;
  }

  /**
   * SessionManager 인스턴스를 반환한다.
   * 외부에서 직접 세션 매니저를 활용할 수 있도록 제공한다.
   */
  getSessionManager(): SessionManager | null {
    return this.sessionManager;
  }

  // --- Private Handlers ---

  /**
   * 질문 입력 검증을 수행한다.
   */
  private handleValidate(query: string): ModuleOutput {
    const result = this.inputValidator!.validate(query);
    return {
      success: result.valid,
      data: result,
      errors: result.valid ? undefined : [{
        code: 'VALIDATION_FAILED',
        message: result.error || '입력 검증에 실패했습니다.',
        severity: ErrorSeverity.LOW,
        timestamp: new Date().toISOString(),
      }],
    };
  }

  /**
   * 새 세션을 생성한다.
   */
  private async handleCreateSession(): Promise<ModuleOutput> {
    const session = await this.sessionManager!.createSession();
    return {
      success: true,
      data: session,
    };
  }

  /**
   * 세션을 조회한다.
   */
  private async handleGetSession(sessionId: string): Promise<ModuleOutput> {
    if (!sessionId) {
      return {
        success: false,
        errors: [{
          code: 'MISSING_SESSION_ID',
          message: '세션 ID가 필요합니다.',
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const session = await this.sessionManager!.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        errors: [{
          code: 'SESSION_NOT_FOUND',
          message: `세션을 찾을 수 없습니다: ${sessionId}`,
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    return {
      success: true,
      data: session,
    };
  }

  /**
   * 대화 항목을 추가한다.
   */
  private async handleAddConversation(payload: QueryHandlerPayload): Promise<ModuleOutput> {
    const { sessionId, query, answer, citations } = payload;

    if (!sessionId) {
      return {
        success: false,
        errors: [{
          code: 'MISSING_SESSION_ID',
          message: '세션 ID가 필요합니다.',
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    if (!query || !answer) {
      return {
        success: false,
        errors: [{
          code: 'MISSING_REQUIRED_FIELDS',
          message: '질문(query)과 답변(answer)은 필수입니다.',
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const updatedSession = await this.sessionManager!.addConversation(
      sessionId,
      query,
      answer,
      (citations || []) as import('../../common/interfaces/data-models.js').Citation[],
    );

    return {
      success: true,
      data: updatedSession,
    };
  }
}

export { InputValidator } from './input-validator.js';
export { SessionManager, StoredSessionRecord } from './session-manager.js';
