/**
 * @fileoverview 당사자 관점 제한기 (PerspectiveRestrictor)
 * @description 확정된 계약 유형에 따라 사용자가 선택 가능한 당사자 관점
 * (매수인/매도인/임대인/임차인)을 제한한다.
 *
 * 관점 제한 규칙:
 *   - 매매(sale) → {매수인(buyer), 매도인(seller)}
 *   - 전세(jeonse)·월세(wolse)·상가임대차(commercial_lease) → {임차인(tenant), 임대인(landlord)}
 *
 * 핵심 불변식 (Property 7 대비):
 *   계약 유형이 매매이면 허용 관점 집합은 정확히 {buyer, seller},
 *   그 외(전세/월세/상가임대차)이면 정확히 {tenant, landlord}이어야 한다.
 *
 * @requirements 2.6 - 매매 선택 시 관점을 매수인/매도인으로만 제한
 * @requirements 2.7 - 전세/월세/상가임대차 선택 시 관점을 임차인/임대인으로만 제한
 */

import type { ContractType, PartyPerspective } from '../interfaces/types.js';

/** 매매 계약에서 허용되는 당사자 관점 집합 */
const SALE_PERSPECTIVES: readonly PartyPerspective[] = ['buyer', 'seller'];

/** 임대차 계열 계약(전세/월세/상가임대차)에서 허용되는 당사자 관점 집합 */
const LEASE_PERSPECTIVES: readonly PartyPerspective[] = ['tenant', 'landlord'];

/**
 * 당사자 관점 제한기
 *
 * 계약 유형을 입력받아 허용 가능한 당사자 관점 목록을 반환하고,
 * 특정 관점이 해당 계약 유형에서 유효한지 검증한다.
 */
export class PerspectiveRestrictor {
  /**
   * 계약 유형에 대해 허용되는 당사자 관점 목록을 반환한다.
   *
   * Property 7 대비:
   *   매매 → 정확히 {buyer, seller}
   *   전세/월세/상가임대차 → 정확히 {tenant, landlord}
   *
   * @param contractType - 확정된 계약 유형
   * @returns 허용 당사자 관점 배열 (호출자가 변경할 수 없도록 복사본 반환)
   */
  getAllowedPerspectives(contractType: ContractType): PartyPerspective[] {
    if (contractType === 'sale') {
      return [...SALE_PERSPECTIVES];
    }
    // jeonse | wolse | commercial_lease
    return [...LEASE_PERSPECTIVES];
  }

  /**
   * 주어진 당사자 관점이 해당 계약 유형에서 허용되는지 검증한다.
   *
   * @param contractType - 확정된 계약 유형
   * @param perspective - 검증할 당사자 관점
   * @returns 허용 여부
   */
  isAllowed(contractType: ContractType, perspective: PartyPerspective): boolean {
    return this.getAllowedPerspectives(contractType).includes(perspective);
  }
}
