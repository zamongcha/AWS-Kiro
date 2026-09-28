/**
 * 첨부서류 체크리스트 시드 데이터 (checklist-seed)
 *
 * 계약 유형별 필수 첨부서류 체크리스트의 기본 시드를 코드 내에 정의한다.
 * 각 항목은 서류명(documentName)·확인 목적(purpose)·준비 주체(preparedBy)를
 * 포함하며, 당사자 관점에 따라 준비 주체가 구분된다(요구사항 10.6).
 *
 * 시드는 S3 config(`contract-data/config/checklists/{type}.json`)로 교체할 수
 * 있도록 `ChecklistSource`(checklist-service.ts)를 통해 주입 가능하다. 시드
 * JSON 자체는 다른 작업(14.1)에서 `src/data/`에 별도로 구축한다.
 *
 * @module ChecklistSeed
 * @requirements 10.1, 10.3, 10.6
 */

import type { ChecklistItem, ContractType } from '../interfaces/index.js';

/**
 * 계약 유형별 체크리스트 항목 시드 매핑.
 *
 * 각 계약 유형은 최소 1개 이상의 항목을 가진다(요구사항 10.1).
 */
export type ChecklistSeedMap = Record<ContractType, ChecklistItem[]>;

/**
 * 계약 유형별 필수 첨부서류 체크리스트 기본 시드.
 *
 * - sale(매매): 매수인·매도인 준비 서류
 * - jeonse(전세): 임차인·임대인 준비 서류
 * - wolse(월세): 임차인·임대인 준비 서류
 * - commercial_lease(상가임대차): 임차인·임대인 준비 서류
 */
export const CHECKLIST_SEED: ChecklistSeedMap = {
  sale: [
    {
      documentName: '등기부등본',
      purpose: '소유권·근저당·선순위 채권 등 권리관계를 확인하기 위한 서류예요.',
      preparedBy: 'buyer',
    },
    {
      documentName: '매도인 신분증',
      purpose: '매도인이 실제 소유자 본인인지 확인하기 위한 서류예요.',
      preparedBy: 'seller',
    },
    {
      documentName: '건축물대장',
      purpose: '건물의 용도·면적·위반건축물 여부를 확인하기 위한 서류예요.',
      preparedBy: 'buyer',
    },
    {
      documentName: '토지대장',
      purpose: '토지의 지목·면적 등 토지 정보를 확인하기 위한 서류예요.',
      preparedBy: 'buyer',
    },
    {
      documentName: '매매계약서',
      purpose: '거래 조건·대금·특약 사항을 명확히 하기 위한 서류예요.',
      preparedBy: 'seller',
    },
  ],
  jeonse: [
    {
      documentName: '등기부등본',
      purpose: '임대인의 소유권과 근저당·선순위 채권을 확인해 전세사기 위험을 점검하기 위한 서류예요.',
      preparedBy: 'tenant',
    },
    {
      documentName: '임대인 신분증',
      purpose: '계약 상대방이 실제 소유자 본인인지 확인하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
    {
      documentName: '전세계약서',
      purpose: '보증금·계약기간·특약 사항을 명확히 하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
    {
      documentName: '납세증명서',
      purpose: '임대인의 세금 체납으로 인한 우선변제 위험을 확인하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
    {
      documentName: '전입세대 열람내역',
      purpose: '선순위 임차인 존재 여부를 확인하기 위한 서류예요.',
      preparedBy: 'tenant',
    },
  ],
  wolse: [
    {
      documentName: '등기부등본',
      purpose: '임대인의 소유권과 권리관계를 확인하기 위한 서류예요.',
      preparedBy: 'tenant',
    },
    {
      documentName: '임대인 신분증',
      purpose: '계약 상대방이 실제 소유자 본인인지 확인하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
    {
      documentName: '월세계약서',
      purpose: '보증금·월세·관리비·계약기간을 명확히 하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
    {
      documentName: '납세증명서',
      purpose: '임대인의 세금 체납 여부를 확인하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
  ],
  commercial_lease: [
    {
      documentName: '등기부등본',
      purpose: '건물주의 소유권과 근저당·선순위 채권을 확인하기 위한 서류예요.',
      preparedBy: 'tenant',
    },
    {
      documentName: '임대인 신분증',
      purpose: '계약 상대방이 실제 소유자 본인인지 확인하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
    {
      documentName: '상가임대차계약서',
      purpose: '보증금·월세·환산보증금·계약기간을 명확히 하기 위한 서류예요.',
      preparedBy: 'landlord',
    },
    {
      documentName: '사업자등록증',
      purpose: '임차인의 상가건물 임대차보호법 적용 요건을 확인하기 위한 서류예요.',
      preparedBy: 'tenant',
    },
    {
      documentName: '건축물대장',
      purpose: '건물의 용도·위반건축물 여부를 확인하기 위한 서류예요.',
      preparedBy: 'tenant',
    },
  ],
};
