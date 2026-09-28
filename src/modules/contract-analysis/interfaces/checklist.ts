/**
 * 첨부서류 체크리스트 (checklist) 인터페이스 정의
 *
 * 계약 유형별 필수 첨부서류 체크리스트 항목과 목록 타입을 정의한다.
 * 체크리스트는 S3 config에 정의하고 로드한다.
 */

import type { ContractType, PartyPerspective } from './types.js';

/**
 * 체크리스트 항목
 */
export interface ChecklistItem {
  /** 서류명 */
  documentName: string;
  /** 확인 목적 설명 */
  purpose: string;
  /** 준비 주체 (당사자 관점별 구분) */
  preparedBy: PartyPerspective;
  /** 등기부 대조 시 갱신되는 상태 */
  status?: 'pending' | 'completed' | 'mismatch';
}

/**
 * 계약 유형별 첨부서류 체크리스트
 */
export interface ContractChecklist {
  /** 계약 유형 */
  contractType: ContractType;
  /** 체크리스트 항목 (1개 이상) */
  items: ChecklistItem[];
}
