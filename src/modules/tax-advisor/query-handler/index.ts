/**
 * @fileoverview 세무 질문 처리 모듈
 * @description ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능한
 * 세무 질문 처리 인터페이스 모듈이다. 입력 검증, 세션 관리, 오케스트레이터를 통합한다.
 *
 * @requirements 8.1, 8.6, 8.8
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../../common/interfaces/service-module.js';
import { TaxInputValidator } from './tax-input-validator.js';
import { TaxSessionManager } from './tax-session-manager.js';
import { TaxOrchestrator, TaxOrchestratorInput, TaxOrchestratorOutput } from './tax-orchestrator.js';

/**
 * 세무 질문 처리 모듈 입력 페이로드
 */
export interface TaxQueryHandlerPayload {
  /** 수행할 작업 유형 */
  action: 'processQuestion' | 'validate' | 'createSession' | 'getSession';
  /** 사용자 질문 */
  query?: string;
  /** 세션 ID */
  sessionId?: string;
  /** 구조화된 수치 입력 */
  numericInputs?: Record<string, number>;
}

/**
 * 세무 질문 처리 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하다.
 */
export class TaxQueryHandlerModule implements ServiceModule {
  private config: ModuleConfig | null = null;
  private inputValidator: TaxInputValidator | null = null;
  private sessionManager: TaxSessionManager | null = null;
  private orchestrator: TaxOrchestrator | null = null;
  private initialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const region = (config.config['region'] as string) || 'ap-northeast-2';
    const sessionsTableName = config.config['sessionsTableName'] as string | undefined;
    const timeoutMs = config.config['timeoutMs'] as number | undefined;

    this.inputValidator = new TaxInputValidator();
    this.sessionManager = new TaxSessionManager(region, sessionsTableName);
    this.orchestrator = new TaxOrchestrator({
      timeoutMs,
      region,
      sessionsTableName,
    });

    this.initialized = true;
  }

  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.inputValidator || !this.sessionManager || !this.orchestrator) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '세무 질문 처리 모듈이 초기화되지 않았습니다.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const payload = input.payload as TaxQueryHandlerPayload;

    try {
      switch (payload.action) {
        case 'processQuestion':
          return this.handleProcessQuestion(payload);

        case 'validate':
          return this.handleValidate(payload.query || '');

        case 'createSession':
          return this.handleCreateSession();

        case 'getSession':
          return this.handleGetSession(payload.sessionId || '');

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
          code: 'TAX_QUERY_HANDLER_ERROR',
          message: errorMessage,
          severity: ErrorSeverity.HIGH,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

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
      details: { initialized: true, service: 'tax-query-handler' },
    };
  }

  getName(): string {
    return 'tax-query-handler';
  }

  getVersion(): string {
    return '1.0.0';
  }

  getOrchestrator(): TaxOrchestrator | null {
    return this.orchestrator;
  }

  private async handleProcessQuestion(payload: TaxQueryHandlerPayload): Promise<ModuleOutput> {
    const input: TaxOrchestratorInput = {
      query: payload.query || '',
      sessionId: payload.sessionId,
      numericInputs: payload.numericInputs,
    };

    const result = await this.orchestrator!.process(input);

    return {
      success: result.success,
      data: result,
      errors: result.success ? undefined : [{
        code: 'PROCESSING_FAILED',
        message: result.error || '질문 처리에 실패했습니다.',
        severity: ErrorSeverity.HIGH,
        timestamp: new Date().toISOString(),
      }],
    };
  }

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

  private async handleCreateSession(): Promise<ModuleOutput> {
    const session = await this.sessionManager!.createSession();
    return { success: true, data: session };
  }

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
          message: `세무 세션을 찾을 수 없습니다: ${sessionId}`,
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    return { success: true, data: session };
  }
}

export { TaxInputValidator } from './tax-input-validator.js';
export { TaxSessionManager, TaxSessionRecord, TaxConversationEntry } from './tax-session-manager.js';
export { TaxOrchestrator, TaxOrchestratorInput, TaxOrchestratorOutput } from './tax-orchestrator.js';
