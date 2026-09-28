/**
 * @fileoverview 카테고리 서비스
 * @description 5가지 분쟁유형 카테고리 목록 제공, 분쟁유형별 판례 목록 조회,
 * 하위 세부 분류 제공, 페이지네이션 지원.
 *
 * @requirements 7.1 - 5가지 분쟁유형 카테고리 목록 제공
 * @requirements 7.2 - 분쟁유형별 판례 목록 (선고일자 내림차순)
 * @requirements 7.3 - 하위 세부 분류 (SubCategory)
 * @requirements 7.4 - 페이지네이션 (기본 페이지 크기 20)
 */

import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import type {
  DisputeType,
  CategoryListInput,
  CategoryListOutput,
  CategoryCaseItem,
  SubCategory,
} from '../interfaces/index.js';

/** 기본 페이지 크기 */
const DEFAULT_PAGE_SIZE = 20;

/**
 * 카테고리 정보 인터페이스
 */
export interface CategoryInfo {
  type: DisputeType;
  name: string;
  description: string;
}

/**
 * 카테고리 서비스 설정
 */
export interface CategoryServiceConfig {
  /** OpenSearch 엔드포인트 */
  openSearchEndpoint?: string;
  /** 판례 인덱스명 */
  caseIndex?: string;
}

/** 5가지 분쟁유형 카테고리 */
const CATEGORIES: CategoryInfo[] = [
  { type: 'lease', name: '임대차 분쟁', description: '보증금 반환, 임차권 보호, 계약 해지 등' },
  { type: 'sale', name: '매매 분쟁', description: '매매계약 취소, 하자담보, 소유권 이전 등' },
  { type: 'registration', name: '등기 분쟁', description: '소유권이전등기, 말소등기, 등기무효 등' },
  { type: 'brokerage', name: '중개 분쟁', description: '중개보수, 중개과실, 정보 미고지 등' },
  { type: 'redevelopment', name: '재건축/재개발 분쟁', description: '조합원 분쟁, 보상, 분담금 등' },
];

/** 분쟁유형별 하위 분류 */
const SUB_CATEGORIES: Record<DisputeType, Array<{ id: string; name: string }>> = {
  lease: [
    { id: 'lease-deposit-return', name: '보증금 반환' },
    { id: 'lease-protection', name: '임차권 보호' },
    { id: 'lease-termination', name: '계약 해지/갱신' },
    { id: 'lease-rent-increase', name: '차임 증감' },
  ],
  sale: [
    { id: 'sale-cancel', name: '매매계약 취소/해제' },
    { id: 'sale-defect', name: '하자담보책임' },
    { id: 'sale-transfer', name: '소유권 이전' },
    { id: 'sale-fraud', name: '사기/착오' },
  ],
  registration: [
    { id: 'reg-transfer', name: '소유권이전등기' },
    { id: 'reg-cancel', name: '등기말소' },
    { id: 'reg-invalid', name: '등기무효' },
    { id: 'reg-provisional', name: '가등기' },
  ],
  brokerage: [
    { id: 'brok-fee', name: '중개보수 분쟁' },
    { id: 'brok-negligence', name: '중개 과실' },
    { id: 'brok-disclosure', name: '정보 미고지' },
    { id: 'brok-contract', name: '중개계약 분쟁' },
  ],
  redevelopment: [
    { id: 'redev-member', name: '조합원 자격' },
    { id: 'redev-compensation', name: '보상 분쟁' },
    { id: 'redev-contribution', name: '분담금/추가분담' },
    { id: 'redev-procedure', name: '절차 하자' },
  ],
};

/**
 * 카테고리 서비스 클래스
 *
 * @requirements 7.1, 7.2, 7.3, 7.4
 */
export class CategoryService {
  private readonly openSearchClient: OpenSearchClient | null;
  private readonly caseIndex: string;

  constructor(
    config?: CategoryServiceConfig,
    deps?: { openSearchClient?: OpenSearchClient },
  ) {
    this.caseIndex = config?.caseIndex ?? 'court-cases';

    if (deps?.openSearchClient) {
      this.openSearchClient = deps.openSearchClient;
    } else if (config?.openSearchEndpoint) {
      this.openSearchClient = new OpenSearchClient({
        node: config.openSearchEndpoint,
        ssl: { rejectUnauthorized: true },
      });
    } else {
      this.openSearchClient = null;
    }
  }

  /**
   * 5가지 분쟁유형 카테고리 목록을 반환한다.
   */
  getCategories(): CategoryInfo[] {
    return CATEGORIES;
  }

  /**
   * 분쟁유형별 판례 목록을 조회한다.
   *
   * @param input - 카테고리 목록 조회 입력
   * @returns 카테고리 판례 목록 출력
   */
  async getCasesByCategory(input: CategoryListInput): Promise<CategoryListOutput> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    const from = (page - 1) * pageSize;

    const subCategories = await this.getSubCategories(input.disputeType);

    if (!this.openSearchClient) {
      return {
        disputeType: input.disputeType,
        subCategories,
        cases: [],
        totalCount: 0,
        page,
        pageSize,
      };
    }

    try {
      const response = await this.openSearchClient.search({
        index: this.caseIndex,
        body: {
          from,
          size: pageSize,
          query: {
            bool: {
              filter: [
                { term: { case_type: input.disputeType } },
              ],
            },
          },
          sort: [{ judgment_date: { order: 'desc' } }],
          _source: ['case_number', 'court_name', 'judgment_date', 'chunk_content', 'metadata'],
        },
      });

      const body = response.body as Record<string, unknown>;
      const hits = body['hits'] as Record<string, unknown>;
      const total = (hits['total'] as Record<string, unknown>)?.['value'] as number ?? 0;
      const hitArray = (hits['hits'] as Record<string, unknown>[]) ?? [];

      const cases: CategoryCaseItem[] = hitArray.map((hit) => {
        const source = hit['_source'] as Record<string, unknown>;
        const metadata = source['metadata'] as Record<string, unknown> | undefined;

        return {
          caseId: (metadata?.['case_id'] as string) ?? (hit['_id'] as string),
          caseNumber: (source['case_number'] as string) ?? '',
          courtName: (source['court_name'] as string) ?? '',
          judgmentDate: (source['judgment_date'] as string) ?? '',
          keyIssueSummary: ((source['chunk_content'] as string) ?? '').substring(0, 100),
        };
      });

      return {
        disputeType: input.disputeType,
        subCategories,
        cases,
        totalCount: total,
        page,
        pageSize,
      };
    } catch {
      return {
        disputeType: input.disputeType,
        subCategories,
        cases: [],
        totalCount: 0,
        page,
        pageSize,
      };
    }
  }

  /**
   * 하위 세부 분류를 반환한다.
   *
   * @param disputeType - 분쟁 유형
   * @returns 하위 분류 목록 (판례 수 포함)
   */
  async getSubCategories(disputeType: DisputeType): Promise<SubCategory[]> {
    const subCats = SUB_CATEGORIES[disputeType] ?? [];

    // OpenSearch 연결이 없으면 카운트 0으로 반환
    return subCats.map((sc) => ({
      id: sc.id,
      name: sc.name,
      caseCount: 0, // 실제 운영 시 OpenSearch aggregation으로 카운트
    }));
  }
}
