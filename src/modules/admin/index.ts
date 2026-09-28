/**
 * @fileoverview 관리 모듈
 * @description 데이터 관리 현황 조회 및 사용자 피드백 수집 기능을 제공하는
 * 서비스 모듈이다. ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에
 * 등록할 수 있다.
 *
 * @requirements 7.1 - 수집된 법령 수, 판례 수 조회
 * @requirements 7.2 - 최종 갱신 일시 조회
 * @requirements 7.3 - 벡터 적재 상태 조회
 * @requirements 3.7 - 검색 로그 저장
 * @requirements 3.8 - 피드백 수집 및 검색 품질 관리
 */

import {
  ServiceModule,
  ModuleConfig,
  ModuleInput,
  ModuleOutput,
  HealthStatus,
  HealthStatusEnum,
  ErrorSeverity,
} from '../../common/interfaces/index.js';
import { DataDashboard, DataStatus } from './data-dashboard.js';
import { FeedbackCollector, FeedbackSubmission, FeedbackStats, FeedbackRecord } from './feedback-collector.js';

/**
 * 관리 모듈 실행 결과 타입
 */
export type AdminResult = DataStatus | FeedbackRecord | FeedbackStats;

/**
 * 관리 모듈 클래스
 *
 * ServiceModule 인터페이스를 구현하여 플러그인 레지스트리에 등록 가능하며,
 * 데이터 현황 조회(getStatus)와 피드백 수집(submitFeedback, getFeedbackStats) 기능을 제공한다.
 */
export class AdminModule implements ServiceModule {
  private dashboard: DataDashboard | null = null;
  private feedbackCollector: FeedbackCollector | null = null;
  private config: ModuleConfig | null = null;
  private initialized = false;

  /**
   * 모듈 초기화
   *
   * DataDashboard와 FeedbackCollector를 설정한다.
   *
   * @param config - 모듈 설정
   *   - config.config.dataManagementTable: DataManagement DynamoDB 테이블 이름
   *   - config.config.feedbackTable: Feedback DynamoDB 테이블 이름
   *   - config.config.region: AWS 리전 (선택, 기본 'ap-northeast-2')
   */
  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;

    const dataManagementTable = (config.config['dataManagementTable'] as string) || 'DataManagement';
    const feedbackTable = (config.config['feedbackTable'] as string) || 'Feedback';
    const region = (config.config['region'] as string) || undefined;

    this.dashboard = new DataDashboard({
      tableName: dataManagementTable,
      region,
    });

    this.feedbackCollector = new FeedbackCollector({
      tableName: feedbackTable,
      region,
    });

    this.initialized = true;
  }

  /**
   * 모듈 실행
   *
   * input.type에 따라 적절한 작업을 수행한다:
   * - 'getStatus': 데이터 현황 조회
   * - 'submitFeedback': 피드백 제출
   * - 'getFeedbackStats': 피드백 통계 조회
   *
   * @param input - 모듈 입력
   * @returns 모듈 출력
   */
  async execute(input: ModuleInput): Promise<ModuleOutput> {
    if (!this.initialized || !this.dashboard || !this.feedbackCollector) {
      return {
        success: false,
        errors: [{
          code: 'MODULE_NOT_INITIALIZED',
          message: '모듈이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.',
          severity: ErrorSeverity.CRITICAL,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    try {
      switch (input.type) {
        case 'getStatus':
          return await this.handleGetStatus();
        case 'submitFeedback':
          return await this.handleSubmitFeedback(input.payload as FeedbackSubmission);
        case 'getFeedbackStats':
          return await this.handleGetFeedbackStats();
        default:
          return {
            success: false,
            errors: [{
              code: 'INVALID_INPUT_TYPE',
              message: `지원하지 않는 작업 유형입니다: ${input.type}. 사용 가능: getStatus, submitFeedback, getFeedbackStats`,
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
          code: 'EXECUTION_ERROR',
          message: `작업 실행 중 오류가 발생했습니다: ${errorMessage}`,
          severity: ErrorSeverity.HIGH,
          timestamp: new Date().toISOString(),
        }],
      };
    }
  }

  /**
   * 모듈 헬스체크
   *
   * DynamoDB 연결 상태를 확인하기 위해 데이터 현황 조회를 시도한다.
   *
   * @returns 현재 헬스 상태
   */
  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized || !this.dashboard) {
      return {
        status: HealthStatusEnum.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        details: { reason: 'Module not initialized' },
      };
    }

    try {
      await this.dashboard.getStatus();
      return {
        status: HealthStatusEnum.HEALTHY,
        lastCheck: new Date().toISOString(),
        details: { dynamoDbConnected: true },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        status: HealthStatusEnum.DEGRADED,
        lastCheck: new Date().toISOString(),
        details: { dynamoDbConnected: false, error: errorMessage },
      };
    }
  }

  /**
   * 모듈 이름 반환
   */
  getName(): string {
    return 'admin';
  }

  /**
   * 모듈 버전 반환
   */
  getVersion(): string {
    return '1.0.0';
  }

  /**
   * 데이터 현황 조회 처리
   */
  private async handleGetStatus(): Promise<ModuleOutput> {
    const status = await this.dashboard!.getStatus();
    return {
      success: true,
      data: status,
      metadata: {
        action: 'getStatus',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 피드백 제출 처리
   */
  private async handleSubmitFeedback(submission: FeedbackSubmission): Promise<ModuleOutput> {
    if (!submission || !submission.sessionId || !submission.questionId || !submission.rating) {
      return {
        success: false,
        errors: [{
          code: 'INVALID_FEEDBACK_INPUT',
          message: '피드백 입력이 유효하지 않습니다. sessionId, questionId, rating은 필수입니다.',
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    if (submission.rating !== 'helpful' && submission.rating !== 'not_helpful') {
      return {
        success: false,
        errors: [{
          code: 'INVALID_RATING',
          message: "rating은 'helpful' 또는 'not_helpful'이어야 합니다.",
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
        }],
      };
    }

    const record = await this.feedbackCollector!.submitFeedback(submission);
    return {
      success: true,
      data: record,
      metadata: {
        action: 'submitFeedback',
        feedbackId: record.feedbackId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 피드백 통계 조회 처리
   */
  private async handleGetFeedbackStats(): Promise<ModuleOutput> {
    const stats = await this.feedbackCollector!.getFeedbackStats();
    return {
      success: true,
      data: stats,
      metadata: {
        action: 'getFeedbackStats',
        timestamp: new Date().toISOString(),
      },
    };
  }
}

export { DataDashboard, DataStatus } from './data-dashboard.js';
export { FeedbackCollector, FeedbackSubmission, FeedbackStats, FeedbackRecord, FeedbackRating } from './feedback-collector.js';
