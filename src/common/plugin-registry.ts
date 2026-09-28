/**
 * 플러그인 레지스트리
 *
 * 서비스 모듈의 등록, 해제, 조회, 상태 관리를 담당하는 싱글턴 레지스트리.
 * 새로운 모듈을 추가할 때 기존 코드 변경 없이 등록 절차만으로 시스템에 통합할 수 있다.
 *
 * Requirements:
 * - 8.2: 새로운 서비스 모듈을 설정/등록 절차만으로 시스템에 통합
 * - 8.3: 모듈 간 통신은 명확히 정의된 인터페이스를 통해서만 수행
 * - 8.5: 각 서비스 모듈의 동작 상태를 실시간으로 모니터링
 */

import { EventEmitter } from 'events';
import {
  ServiceModule,
  ModuleConfig,
  HealthStatus,
  HealthStatusEnum,
} from './interfaces/index.js';

/**
 * 모듈 라이프사이클 이벤트 타입
 */
export type PluginRegistryEvent =
  | 'registered'
  | 'deregistered'
  | 'health-changed';

/**
 * 등록된 모듈의 내부 관리 엔트리
 */
interface RegisteredModuleEntry {
  module: ServiceModule;
  config: ModuleConfig;
  registeredAt: string;
  enabled: boolean;
  lastHealthStatus: HealthStatus;
}

/**
 * 모듈 목록 조회 시 반환되는 항목 타입
 */
export interface ModuleListItem {
  name: string;
  version: string;
  enabled: boolean;
  health: HealthStatus;
}

/**
 * 플러그인 레지스트리 클래스
 *
 * 싱글턴 패턴으로 구현되어 애플리케이션 전역에서 하나의 인스턴스만 사용한다.
 * 모든 서비스 모듈은 이 레지스트리에 등록되어야 시스템 내에서 사용할 수 있다.
 */
export class PluginRegistry {
  private static instance: PluginRegistry | null = null;

  private readonly modules: Map<string, RegisteredModuleEntry> = new Map();
  private readonly eventEmitter: EventEmitter = new EventEmitter();

  /**
   * 생성자는 private으로 외부에서 직접 인스턴스를 생성할 수 없다.
   * getInstance()를 통해서만 접근 가능.
   */
  private constructor() {}

  /**
   * 싱글턴 인스턴스 반환
   */
  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  /**
   * 테스트 등에서 싱글턴 인스턴스를 초기화할 때 사용
   */
  static resetInstance(): void {
    PluginRegistry.instance = null;
  }

  /**
   * 서비스 모듈 등록
   *
   * 모듈이 ServiceModule 인터페이스를 올바르게 구현하는지 검증하고,
   * 중복 등록을 방지하며, 초기화를 수행한다.
   *
   * @param module - 등록할 서비스 모듈
   * @param config - 모듈 설정
   * @throws 모듈이 ServiceModule 인터페이스를 구현하지 않은 경우
   * @throws 동일한 이름의 모듈이 이미 등록된 경우
   */
  async register(module: ServiceModule, config: ModuleConfig): Promise<void> {
    // ServiceModule 인터페이스 구현 여부 검증
    this.validateModule(module);

    const moduleName = module.getName();

    // 중복 등록 방지
    if (this.modules.has(moduleName)) {
      throw new Error(
        `Module "${moduleName}" is already registered. Deregister it first before re-registering.`
      );
    }

    // 모듈 초기화
    await module.initialize(config);

    // 초기 헬스 상태 조회
    const initialHealth: HealthStatus = {
      status: HealthStatusEnum.HEALTHY,
      lastCheck: new Date().toISOString(),
      details: { message: 'Module just registered' },
    };

    // 레지스트리에 등록
    const entry: RegisteredModuleEntry = {
      module,
      config,
      registeredAt: new Date().toISOString(),
      enabled: config.enabled,
      lastHealthStatus: initialHealth,
    };

    this.modules.set(moduleName, entry);

    // 등록 이벤트 발행
    this.eventEmitter.emit('registered', {
      name: moduleName,
      version: module.getVersion(),
      timestamp: entry.registeredAt,
    });
  }

  /**
   * 서비스 모듈 해제
   *
   * @param moduleName - 해제할 모듈 이름
   * @returns 해제 성공 시 true, 모듈이 존재하지 않으면 false
   */
  deregister(moduleName: string): boolean {
    const entry = this.modules.get(moduleName);
    if (!entry) {
      return false;
    }

    this.modules.delete(moduleName);

    // 해제 이벤트 발행
    this.eventEmitter.emit('deregistered', {
      name: moduleName,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  /**
   * 등록된 모듈을 이름으로 조회
   *
   * @param moduleName - 조회할 모듈 이름
   * @returns 모듈 인스턴스 또는 undefined
   */
  getModule(moduleName: string): ServiceModule | undefined {
    const entry = this.modules.get(moduleName);
    return entry?.module;
  }

  /**
   * 등록된 전체 모듈 목록 및 상태 반환
   *
   * @returns 모듈 목록 (이름, 버전, 활성화 여부, 헬스 상태)
   */
  listModules(): ModuleListItem[] {
    const result: ModuleListItem[] = [];

    for (const [, entry] of this.modules) {
      result.push({
        name: entry.module.getName(),
        version: entry.module.getVersion(),
        enabled: entry.enabled,
        health: entry.lastHealthStatus,
      });
    }

    return result;
  }

  /**
   * 등록된 모든 모듈의 헬스체크 수행
   *
   * 각 모듈의 healthCheck()를 호출하고, 이전 상태와 비교하여
   * 변경이 감지되면 'health-changed' 이벤트를 발행한다.
   *
   * @returns 모듈 이름 → 헬스 상태 맵
   */
  async healthCheck(): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();

    for (const [moduleName, entry] of this.modules) {
      try {
        const health = await entry.module.healthCheck();
        results.set(moduleName, health);

        // 상태 변경 감지 시 이벤트 발행
        const previousStatus = entry.lastHealthStatus.status;
        if (previousStatus !== health.status) {
          this.eventEmitter.emit('health-changed', {
            name: moduleName,
            previousStatus,
            currentStatus: health.status,
            timestamp: health.lastCheck,
          });
        }

        // 마지막 헬스 상태 갱신
        entry.lastHealthStatus = health;
      } catch (error) {
        const unhealthyStatus: HealthStatus = {
          status: HealthStatusEnum.UNHEALTHY,
          lastCheck: new Date().toISOString(),
          details: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
        results.set(moduleName, unhealthyStatus);

        // 상태 변경 감지 시 이벤트 발행
        const previousStatus = entry.lastHealthStatus.status;
        if (previousStatus !== HealthStatusEnum.UNHEALTHY) {
          this.eventEmitter.emit('health-changed', {
            name: moduleName,
            previousStatus,
            currentStatus: HealthStatusEnum.UNHEALTHY,
            timestamp: unhealthyStatus.lastCheck,
          });
        }

        entry.lastHealthStatus = unhealthyStatus;
      }
    }

    return results;
  }

  /**
   * 라이프사이클 이벤트 리스너 등록
   *
   * @param event - 이벤트 타입 ('registered' | 'deregistered' | 'health-changed')
   * @param listener - 이벤트 핸들러
   */
  on(event: PluginRegistryEvent, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * 라이프사이클 이벤트 리스너 해제
   *
   * @param event - 이벤트 타입
   * @param listener - 제거할 이벤트 핸들러
   */
  off(
    event: PluginRegistryEvent,
    listener: (...args: unknown[]) => void
  ): void {
    this.eventEmitter.off(event, listener);
  }

  /**
   * 등록된 모듈 수 반환
   */
  get size(): number {
    return this.modules.size;
  }

  /**
   * ServiceModule 인터페이스 구현 여부 검증
   *
   * 필수 메서드(initialize, execute, healthCheck, getName, getVersion)가
   * 모두 함수로 정의되어 있는지 확인한다.
   */
  private validateModule(module: ServiceModule): void {
    const requiredMethods: Array<keyof ServiceModule> = [
      'initialize',
      'execute',
      'healthCheck',
      'getName',
      'getVersion',
    ];

    for (const method of requiredMethods) {
      if (typeof module[method] !== 'function') {
        throw new Error(
          `Invalid module: missing or invalid method "${method}". ` +
            `Module must implement the ServiceModule interface.`
        );
      }
    }
  }
}
