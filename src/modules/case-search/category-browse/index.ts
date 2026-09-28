/**
 * @fileoverview 카테고리 탐색 모듈
 * @description 5가지 분쟁유형별 판례 카테고리 목록, 판례 목록 조회,
 * 하위 분류, 개별 판례 상세 분석 기능을 제공하는 모듈의 진입점이다.
 *
 * @requirements 7.1 - 5가지 분쟁유형 카테고리 목록
 * @requirements 7.2 - 분쟁유형별 판례 목록 (선고일자 내림차순)
 * @requirements 7.3 - 하위 세부 분류
 * @requirements 7.4 - 페이지네이션 (기본 20)
 * @requirements 7.5 - 개별 판례 상세 분석
 */

import type {
  CategoryListInput,
  CategoryListOutput,
  CaseDetailInput,
  CaseDetailOutput,
  DisputeType,
  SubCategory,
} from '../interfaces/index.js';
import { CategoryService, CategoryServiceConfig, CategoryInfo } from './category-service.js';
import { CaseDetailService, CaseDetailServiceConfig } from './case-detail-service.js';

/**
 * 카테고리 탐색 모듈 설정
 */
export interface CategoryBrowseModuleConfig {
  /** CategoryService 설정 */
  categoryServiceConfig?: CategoryServiceConfig;
  /** CaseDetailService 설정 */
  detailServiceConfig?: CaseDetailServiceConfig;
}

/**
 * 카테고리 탐색 모듈 클래스
 *
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */
export class CategoryBrowseModule {
  private readonly categoryService: CategoryService;
  private readonly detailService: CaseDetailService;

  constructor(
    config?: CategoryBrowseModuleConfig,
    deps?: {
      categoryService?: CategoryService;
      detailService?: CaseDetailService;
    },
  ) {
    this.categoryService = deps?.categoryService ?? new CategoryService(config?.categoryServiceConfig);
    this.detailService = deps?.detailService ?? new CaseDetailService(config?.detailServiceConfig);
  }

  /**
   * 5가지 분쟁유형 카테고리 목록을 반환한다.
   */
  getCategories(): CategoryInfo[] {
    return this.categoryService.getCategories();
  }

  /**
   * 분쟁유형별 판례 목록을 조회한다.
   *
   * @param input - 카테고리 목록 조회 입력
   * @returns 판례 목록 (선고일자 내림차순, 페이지네이션)
   */
  async getCasesByCategory(input: CategoryListInput): Promise<CategoryListOutput> {
    return this.categoryService.getCasesByCategory(input);
  }

  /**
   * 분쟁유형의 하위 세부 분류를 반환한다.
   *
   * @param disputeType - 분쟁 유형
   * @returns 하위 분류 목록
   */
  async getSubCategories(disputeType: DisputeType): Promise<SubCategory[]> {
    return this.categoryService.getSubCategories(disputeType);
  }

  /**
   * 개별 판례 상세 분석을 수행한다.
   *
   * @param input - 판례 상세 조회 입력
   * @returns 상세 분석 결과 또는 null
   */
  async getCaseById(input: CaseDetailInput): Promise<CaseDetailOutput | null> {
    return this.detailService.getDetail(input);
  }

  getName(): string {
    return 'category-browse';
  }

  getVersion(): string {
    return '1.0.0';
  }
}

// 하위 모듈 re-export
export { CategoryService } from './category-service.js';
export { CaseDetailService } from './case-detail-service.js';
export type { CategoryInfo, CategoryServiceConfig } from './category-service.js';
export type { CaseDetailServiceConfig } from './case-detail-service.js';
