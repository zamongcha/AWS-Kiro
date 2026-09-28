/**
 * 첨부서류 체크리스트 서비스 (ChecklistService)
 *
 * 확정된 계약 유형에 대응하는 필수 첨부서류 체크리스트를 3초 이내에 제공하고,
 * 등기부등본 대조 결과를 반영하여 체크리스트 항목 상태를 갱신하는 책임을
 * 담당한다.
 *
 * 주요 규칙:
 *   - 요구사항 10.1: 계약 유형이 확정되면 3초 이내에 필수 첨부서류 체크리스트를
 *     1개 이상 항목으로 제공한다.
 *   - 요구사항 10.2: 대응 체크리스트가 정의되어 있지 않으면 항목을 제공하지 않고
 *     대응 항목 없음 안내(hasChecklist=false)를 표시하며 이전 입력 상태를 유지한다.
 *   - 요구사항 10.3: 각 항목에 서류명(documentName)과 확인 목적(purpose)을 함께 제공한다.
 *   - 요구사항 10.4: 등기부등본 대조가 완료되면 등기부등본 항목을 완료(completed)로 표시한다.
 *   - 요구사항 10.5: 대조 중 불일치가 발견되면 등기부등본 항목을 완료로 표시하지 않고
 *     불일치(mismatch) 표시를 함께 제공한다.
 *   - 요구사항 10.6: 당사자 관점에 따라 준비 주체(preparedBy)가 다른 서류를 구분하여 표시한다.
 *
 * 체크리스트 시드는 코드 내 시드(`checklist-seed.ts`)를 기본으로 사용하되,
 * `ChecklistSource`를 주입하여 S3 config(`contract-data/config/checklists/{type}.json`)
 * 로부터 로드하도록 확장할 수 있다.
 *
 * @module ChecklistService
 * @requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import type {
  ChecklistItem,
  ContractChecklist,
  ContractType,
  PartyPerspective,
  RegistryMatchResult,
} from '../interfaces/index.js';
import { CHECKLIST_SEED } from './checklist-seed.js';

/** 체크리스트 제공 기본 타임아웃 (ms) - 요구사항 10.1: 3초 이내 */
export const CHECKLIST_PROVIDE_TIMEOUT_MS = 3_000;

/**
 * 등기부등본 항목으로 간주되는 서류명 키워드.
 *
 * 이 키워드를 서류명에 포함하는 항목을 등기부 대조 결과 반영 대상으로 본다.
 */
export const REGISTRY_DOCUMENT_KEYWORD = '등기부등본';

/**
 * 체크리스트 조회 결과.
 */
export interface ChecklistResult {
  /** 조회 성공 여부 */
  success: boolean;
  /** 대응 체크리스트 존재 여부 (항목 1개 이상이면 true, 요구사항 10.2) */
  hasChecklist: boolean;
  /** 계약 유형별 체크리스트 (없으면 undefined) */
  checklist?: ContractChecklist;
  /** 사용자 안내 메시지 (대응 항목 없음/오류 시) */
  message?: string;
}

/**
 * 계약 유형별 체크리스트 시드를 제공하는 소스 인터페이스.
 *
 * 기본 구현은 코드 내 시드(`checklist-seed.ts`)를 사용하지만, S3 config 기반
 * 구현으로 교체할 수 있다.
 */
export interface ChecklistSource {
  /**
   * 계약 유형에 해당하는 체크리스트 항목 목록을 반환한다.
   *
   * @param contractType - 계약 유형
   * @returns 체크리스트 항목 목록 (없으면 빈 배열)
   */
  getItems(
    contractType: ContractType,
  ): Promise<ChecklistItem[]> | ChecklistItem[];
}

/**
 * 코드 내 시드 데이터를 사용하는 기본 체크리스트 소스.
 */
class DefaultChecklistSource implements ChecklistSource {
  getItems(contractType: ContractType): ChecklistItem[] {
    const items = CHECKLIST_SEED[contractType];
    // 방어적 복사: 시드 원본이 외부에서 변경되지 않도록 항목을 깊은 복사한다.
    return (items ?? []).map((item) => ({ ...item }));
  }
}

/**
 * 첨부서류 체크리스트 서비스 설정.
 */
export interface ChecklistServiceConfig {
  /** 체크리스트 항목 소스 (기본: 코드 내 시드) */
  source?: ChecklistSource;
  /** 제공 타임아웃 (ms, 기본 3000) */
  timeoutMs?: number;
}

/**
 * 첨부서류 체크리스트 서비스.
 *
 * @requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */
export class ChecklistService {
  private readonly source: ChecklistSource;
  private readonly timeoutMs: number;

  constructor(config: ChecklistServiceConfig = {}) {
    this.source = config.source ?? new DefaultChecklistSource();
    this.timeoutMs = config.timeoutMs ?? CHECKLIST_PROVIDE_TIMEOUT_MS;
  }

  /**
   * 확정된 계약 유형에 대응하는 필수 첨부서류 체크리스트를 3초 이내에 제공한다.
   *
   * 대응 항목이 하나도 없으면 `hasChecklist=false`로 대응 항목 없음을 안내하며
   * (요구사항 10.2), 어떤 경우에도 이전 입력 상태를 변경하지 않는다.
   *
   * @param contractType - 확정된 계약 유형
   * @returns 체크리스트 조회 결과
   *
   * @requirements 10.1, 10.2, 10.3, 10.6
   */
  async getChecklist(contractType: ContractType): Promise<ChecklistResult> {
    let items: ChecklistItem[];
    try {
      items = await this.withTimeout(
        Promise.resolve(this.source.getItems(contractType)),
        this.timeoutMs,
      );
    } catch {
      // 오류 시에도 사용자 입력 상태는 변경하지 않고 안내만 반환한다.
      return {
        success: false,
        hasChecklist: false,
        message:
          '첨부서류 체크리스트를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      };
    }

    // 요구사항 10.2: 대응하는 체크리스트가 정의되어 있지 않은 경우.
    if (!items || items.length === 0) {
      return {
        success: true,
        hasChecklist: false,
        message:
          '해당 계약 유형에 대응하는 첨부서류 체크리스트가 아직 정의되어 있지 않아요.',
      };
    }

    // 요구사항 10.1/10.3: 각 항목에 서류명·확인 목적을 포함한 pending 상태로 초기화.
    const normalized: ChecklistItem[] = items.map((item) => ({
      documentName: item.documentName,
      purpose: item.purpose,
      preparedBy: item.preparedBy,
      status: item.status ?? 'pending',
    }));

    return {
      success: true,
      hasChecklist: true,
      checklist: {
        contractType,
        items: normalized,
      },
    };
  }

  /**
   * 당사자 관점별 준비 주체에 따라 체크리스트 항목을 그룹화한다.
   *
   * 요구사항 10.6: 당사자 관점에 따라 준비 주체가 다른 서류를 구분하여 표시할 수
   * 있도록, preparedBy 기준으로 항목을 분류한 매핑을 반환한다.
   *
   * @param checklist - 계약 유형별 체크리스트
   * @returns 준비 주체(PartyPerspective)별 항목 목록 매핑
   *
   * @requirements 10.6
   */
  groupByPreparedBy(
    checklist: ContractChecklist,
  ): Partial<Record<PartyPerspective, ChecklistItem[]>> {
    const grouped: Partial<Record<PartyPerspective, ChecklistItem[]>> = {};
    for (const item of checklist.items) {
      const bucket = grouped[item.preparedBy] ?? [];
      bucket.push({ ...item });
      grouped[item.preparedBy] = bucket;
    }
    return grouped;
  }

  /**
   * 등기부등본 대조 결과를 반영하여 체크리스트를 갱신한다.
   *
   * 요구사항 10.4: 대조가 완료되고 불일치가 없으면 등기부등본 항목을 완료
   * (completed) 상태로 표시한다.
   * 요구사항 10.5: 대조 중 계약서 정보와 불일치(소유자 불일치 등)가 발견되면
   * 등기부등본 항목을 완료로 표시하지 않고 불일치(mismatch) 상태로 표시한다.
   *
   * 원본 체크리스트는 변경하지 않고 갱신된 새 체크리스트를 반환한다.
   *
   * @param checklist - 기존 체크리스트
   * @param registryResult - 등기부 대조 결과
   * @returns 등기부등본 항목 상태가 갱신된 새 체크리스트
   *
   * @requirements 10.4, 10.5
   */
  applyRegistryMatch(
    checklist: ContractChecklist,
    registryResult: RegistryMatchResult,
  ): ContractChecklist {
    // 추출 실패 항목이 있으면 대조가 완료되지 않은 것으로 보고 pending을 유지한다.
    const hasExtractionFailure =
      Array.isArray(registryResult.extractionFailures) &&
      registryResult.extractionFailures.length > 0;

    // 요구사항 10.5: 소유자 불일치 등 불일치 발견 시 mismatch로 표시한다.
    const hasMismatch = registryResult.ownerMismatch === true;

    const updatedStatus: ChecklistItem['status'] = hasExtractionFailure
      ? 'pending'
      : hasMismatch
        ? 'mismatch'
        : 'completed';

    const items = checklist.items.map((item) => {
      if (this.isRegistryItem(item)) {
        return { ...item, status: updatedStatus };
      }
      return { ...item };
    });

    return {
      contractType: checklist.contractType,
      items,
    };
  }

  /**
   * 항목이 등기부등본 서류에 해당하는지 판정한다.
   *
   * @param item - 체크리스트 항목
   * @returns 등기부등본 항목이면 true
   */
  private isRegistryItem(item: ChecklistItem): boolean {
    return item.documentName.includes(REGISTRY_DOCUMENT_KEYWORD);
  }

  /**
   * 주어진 Promise를 타임아웃과 함께 대기한다.
   *
   * 타임아웃이 먼저 도달하면 타임아웃 오류를 던진다(요구사항 10.1: 3초 이내).
   *
   * @param promise - 대상 Promise
   * @param timeoutMs - 타임아웃 (ms)
   * @returns Promise 결과
   * @throws 타임아웃 도달 시 오류
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `첨부서류 체크리스트 제공이 ${timeoutMs}ms 이내에 완료되지 않았습니다.`,
          ),
        );
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}
