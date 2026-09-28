/**
 * 계약서 분석 오케스트레이터 (AnalysisOrchestrator)
 *
 * 문서 인식 이후의 전체 계약서 분석 파이프라인을 조율하는 조율자이다.
 * 이미 구현된 하위 모듈들을 생성자 주입으로 받아 조합하며, 순서·타임아웃·
 * 부분 실패 대응(Graceful Degradation)·결과 구조화를 책임진다.
 *
 * 파이프라인 순서:
 *   인식(입력) → 정보 추출 → 룰셋 로드 → 위험조항 탐지 → 위험도 평가(+등기부)
 *   → 수정 제안 → 판례 연동 → 인용(각주) → 비교 → 체크리스트 → 저장
 *
 * 핵심 규칙:
 *   - 요구사항 14.1: 요청 접수 후 3초 이내 처리 상태 표시를 시작한다.
 *   - 요구사항 14.2: 처리 상태를 5초 이하 간격으로 갱신한다.
 *   - 요구사항 14.3(Property 35): 결과는 종합 위험도 → 위험 조항 목록 →
 *     누락 특약 → 수정 제안 → 근거 각주 → 추출 정보 요약 → 첨부서류 체크리스트
 *     순서로 구조화한다.
 *   - 요구사항 14.4/14.5: 문서 인식 제외 조항 분석은 90초 이내 완료하며, 초과
 *     시 시간 초과를 안내하고 최대 1회 자동 재시도한 뒤 여전히 초과하면 수동
 *     재시도 옵션을 제공한다.
 *   - 요구사항 14.6: 분석 대상 조항이 0건이면 추출 정보 요약과 체크리스트만
 *     포함한 결과를 반환한다.
 *   - 요구사항 14.7: 모든 사용자 대면 메시지는 존댓말 한국어로 제공한다.
 *   - 요구사항 14.8: 오류 발생 시 문서 식별자를 24시간 보존한다.
 *   - 요구사항 3.5: 위험 조항이 0건이어도 누락 특약은 항상 별도 항목으로 제시한다.
 *   - Graceful Degradation: 판례 연동·수정 제안·비교·등기부 대조 실패 시 해당
 *     선택 결과를 생략하고 핵심 결과(종합 위험도·위험 조항·누락 특약·추출 정보·
 *     체크리스트)는 유지한다.
 *
 * @module AnalysisOrchestrator
 * @requirements 3.5, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8
 */

import type {
  ContractType,
  PartyPerspective,
  RiskGrade,
} from '../interfaces/types.js';
import type {
  RecognizedClause,
} from '../interfaces/document-recognizer.js';
import type {
  RiskClause,
  MissingClause,
} from '../interfaces/risk-detector.js';
import type {
  GradedRiskClause,
  FraudRiskScore,
} from '../interfaces/risk-evaluator.js';
import type { RegistryMatchResult } from '../interfaces/registry-matcher.js';
import type {
  RevisionSuggestion,
  LegalReference,
} from '../interfaces/revision-advisor.js';
import type { AnnotatedClause } from '../interfaces/citation.js';
import type { ExtractedField } from '../interfaces/info-extractor.js';
import type { ClauseComparison } from '../interfaces/comparator.js';
import type { ClauseLinkedCases } from '../interfaces/case-linker.js';
import type { ChecklistItem } from '../interfaces/checklist.js';

import type { InfoExtractorModule } from '../info-extractor/index.js';
import { RuleSetLoader, type ToxicRule } from '../contract-context/ruleset-loader.js';
import type { RiskDetectorModule } from '../risk-detector/index.js';
import type { RiskEvaluatorModule } from '../risk-evaluator/index.js';
import type { GradeAssignmentInput } from '../risk-evaluator/grade-assigner.js';
import type { RevisionAdvisorModule } from '../revision-advisor/index.js';
import type { CaseLinkerModule } from '../case-linker/index.js';
import type { CitationModule } from '../citation/index.js';
import type { ComparatorModule } from '../comparator/index.js';
import type { ChecklistService } from '../checklist/checklist-service.js';
import type { ContractDynamoStore } from '../storage/dynamo-store.js';

/** 조항 분석 전체 타임아웃 (밀리초). 요구사항 14.4: 90초 이내 */
export const ANALYSIS_TIMEOUT_MS = 90_000;

/** 조항 분석 자동 재시도 최대 횟수. 요구사항 14.5: 최대 1회 */
export const MAX_AUTO_RETRIES = 1;

/** 상태 갱신 간격 (밀리초). 요구사항 14.2: 5초 이하 */
export const STATUS_UPDATE_INTERVAL_MS = 5_000;

/** 상태 표시 시작 데드라인 (밀리초). 요구사항 14.1: 3초 이내 */
export const STATUS_START_DEADLINE_MS = 3_000;

/** 조항 분석 시간 초과 오류 코드 */
export const ANALYSIS_TIMEOUT_CODE = 'CONTRACT_ANALYSIS_TIMEOUT';

/** 조항 분석 실패 오류 코드 */
export const ANALYSIS_FAILED_CODE = 'CONTRACT_ANALYSIS_FAILED';

/**
 * 분석 처리 단계.
 *
 * 처리 상태 표시(요구사항 14.1/14.2)에 사용된다.
 */
export type AnalysisStage =
  | 'received'
  | 'extracting_info'
  | 'loading_ruleset'
  | 'detecting_risks'
  | 'evaluating_risks'
  | 'generating_revisions'
  | 'linking_cases'
  | 'annotating'
  | 'comparing'
  | 'building_checklist'
  | 'saving'
  | 'completed'
  | 'failed';

/**
 * 처리 상태 알림.
 *
 * 오케스트레이터는 상태가 바뀔 때마다 이 객체를 상태 리스너로 전달한다.
 * 리스너 미주입 시 상태 알림은 생략된다.
 */
export interface AnalysisStatusUpdate {
  /** 현재 단계 */
  stage: AnalysisStage;
  /** 존댓말 한국어 안내 메시지 */
  message: string;
  /** 요청 접수 이후 경과 시간(밀리초) */
  elapsedMs: number;
  /** 자동 재시도 횟수 (0-based) */
  retryCount: number;
}

/** 처리 상태 변경을 수신하는 리스너 */
export type AnalysisStatusListener = (update: AnalysisStatusUpdate) => void;

/**
 * 오케스트레이터 실행 입력.
 *
 * 문서 인식 결과(조항 목록·전체 텍스트)와 확정된 계약 유형·당사자 관점을
 * 받는다. 등기부 대조 결과가 있으면 위험도 평가에 반영한다.
 */
export interface AnalysisOrchestratorInput {
  /** 문서 식별자 */
  documentId: string;
  /** 전체 인식 텍스트 (정보 추출 입력) */
  fullText: string;
  /** 문서 인식으로 분할된 조항 목록 */
  clauses: RecognizedClause[];
  /** 확정된 계약 유형 */
  contractType: ContractType;
  /** 확정된 당사자 관점 */
  perspective: PartyPerspective;
  /** 등기부 대조 결과 (선택, 위험도 평가에 반영) */
  registryResult?: RegistryMatchResult;
}

/**
 * 부분 실패로 생략된 선택 기능 목록.
 *
 * Graceful Degradation 시 어떤 선택 기능이 생략되었는지 사용자에게 안내하기
 * 위한 정보이다.
 */
export interface DegradedFeatures {
  /** 수정 제안 생략 여부 */
  revisions: boolean;
  /** 판례 연동 생략 여부 */
  caseLinks: boolean;
  /** 표준계약서 비교 생략 여부 */
  comparison: boolean;
  /** 등기부 대조 반영 생략 여부 */
  registry: boolean;
}

/**
 * 구조화된 계약서 분석 결과.
 *
 * 필드 선언 순서 자체가 Property 35의 결과 구조 순서(종합 위험도 → 위험 조항
 * 목록 → 누락 특약 → 수정 제안 → 근거 각주 → 추출 정보 요약 → 첨부서류
 * 체크리스트)와 일치한다. `sectionOrder`는 이 순서를 명시적으로 노출하여
 * 소비자(핸들러·UI·테스트)가 검증·렌더링에 사용할 수 있게 한다.
 */
export interface AnalysisResult {
  /** 문서 식별자 */
  documentId: string;
  /** 결과 섹션 순서 (Property 35) */
  sectionOrder: AnalysisSection[];
  /** 1) 종합 위험도 */
  overallRisk: OverallRiskSection;
  /** 2) 위험 조항 목록 */
  riskClauses: RiskClauseView[];
  /** 3) 누락 특약 */
  missingClauses: MissingClause[];
  /** 4) 수정 제안 (조항별) */
  revisionSuggestions: ClauseRevisionSuggestions[];
  /** 5) 근거 각주 */
  footnotes: AnnotatedClause[];
  /** 6) 추출 정보 요약 */
  extractedInfo: ExtractedInfoSection;
  /** 7) 첨부서류 체크리스트 */
  checklist: ChecklistSection;
  /** 표준계약서 비교 결과 (선택) */
  comparison?: ClauseComparison[];
  /** 판례 연동 결과 (선택) */
  linkedCases?: ClauseLinkedCases[];
  /** 부분 실패로 생략된 선택 기능 */
  degraded: DegradedFeatures;
  /** 분석 대상 조항 0건 여부 (요구사항 14.6) */
  isEmptyAnalysis: boolean;
  /** 사용자 대면 안내 메시지 (존댓말 한국어) */
  message: string;
  /** 조항 분석 소요 시간(밀리초) */
  processingTimeMs: number;
}

/** 결과 섹션 식별자 (Property 35 순서 검증용) */
export type AnalysisSection =
  | 'overallRisk'
  | 'riskClauses'
  | 'missingClauses'
  | 'revisionSuggestions'
  | 'footnotes'
  | 'extractedInfo'
  | 'checklist';

/** Property 35가 규정하는 결과 섹션 순서 (불변) */
export const RESULT_SECTION_ORDER: readonly AnalysisSection[] = [
  'overallRisk',
  'riskClauses',
  'missingClauses',
  'revisionSuggestions',
  'footnotes',
  'extractedInfo',
  'checklist',
] as const;

/** 종합 위험도 섹션 */
export interface OverallRiskSection {
  /** 종합 위험도 등급 */
  grade: RiskGrade;
  /** 등급-색상 매핑 */
  color: 'red' | 'yellow' | 'green';
  /** 전세사기 위험 점수 (등기부 대조 반영 시) */
  fraudScore?: FraudRiskScore;
}

/** 위험 조항 뷰 (탐지 + 등급 결합) */
export interface RiskClauseView {
  /** 위험 조항 원본 */
  clause: RiskClause;
  /** 부여된 등급 정보 */
  grade: GradedRiskClause;
}

/** 조항별 수정 제안 */
export interface ClauseRevisionSuggestions {
  /** 조항 식별자 */
  clauseId: string;
  /** 수정 문안 목록 */
  suggestions: RevisionSuggestion[];
}

/** 추출 정보 요약 섹션 */
export interface ExtractedInfoSection {
  /** 추출된 필드 목록 */
  fields: ExtractedField[];
  /** 추출 상태 */
  status: 'success' | 'partial' | 'failed';
}

/** 첨부서류 체크리스트 섹션 */
export interface ChecklistSection {
  /** 체크리스트 존재 여부 */
  hasChecklist: boolean;
  /** 체크리스트 항목 */
  items: ChecklistItem[];
  /** 대응 항목 없음 등 안내 메시지 */
  message?: string;
}

/**
 * 오케스트레이터 실행 결과 (성공 또는 실패).
 */
export type OrchestrationResult =
  | { success: true; result: AnalysisResult }
  | { success: false; error: OrchestrationError };

/**
 * 오케스트레이션 실패 정보.
 *
 * 시간 초과·핵심 파이프라인 실패 시 반환된다. 문서 식별자는 24시간 보존되며
 * (요구사항 14.8), 시간 초과의 경우 수동 재시도 옵션을 제공한다(요구사항 14.5).
 */
export interface OrchestrationError {
  /** 오류 코드 */
  code: string;
  /** 존댓말 한국어 안내 메시지 */
  message: string;
  /** 수동 재시도 옵션 제공 여부 */
  manualRetryAvailable: boolean;
  /** 자동 재시도 시도 횟수 */
  autoRetryCount: number;
  /** 문서 식별자 24시간 보존 완료 여부 */
  documentPreserved: boolean;
  /** 원인 상세 */
  reason: string;
}

/**
 * 오케스트레이터가 조합하는 하위 모듈 의존성.
 *
 * 각 모듈은 생성자 주입으로 받는다. 선택 기능(수정 제안·판례 연동·비교)은
 * 미주입 시 해당 단계를 생략한다. 순환 의존을 피하기 위해 오케스트레이터는
 * 모듈들을 참조만 하며, 모듈은 오케스트레이터를 참조하지 않는다.
 */
export interface AnalysisOrchestratorDeps {
  /** 정보 추출기 (필수) */
  infoExtractor: InfoExtractorModule;
  /** 룰셋 로더 (필수) */
  ruleSetLoader: RuleSetLoader;
  /** 위험조항 탐지기 (필수) */
  riskDetector: RiskDetectorModule;
  /** 위험도 평가기 (필수) */
  riskEvaluator: RiskEvaluatorModule;
  /** 첨부서류 체크리스트 서비스 (필수) */
  checklistService: ChecklistService;
  /** 수정제안 생성기 (선택) */
  revisionAdvisor?: RevisionAdvisorModule;
  /** 판례 연동기 (선택) */
  caseLinker?: CaseLinkerModule;
  /** 인용 표시기 (선택) */
  citation?: CitationModule;
  /** 비교 분석기 (선택) */
  comparator?: ComparatorModule;
  /** DynamoDB 저장소 (선택, 결과 저장·오류 보존) */
  dynamoStore?: ContractDynamoStore;
}

/**
 * 오케스트레이터 설정.
 */
export interface AnalysisOrchestratorConfig {
  /** 조항 분석 타임아웃 (밀리초, 기본 90000) */
  timeoutMs?: number;
  /** 최대 자동 재시도 횟수 (기본 1) */
  maxAutoRetries?: number;
  /** 처리 상태 리스너 (선택) */
  statusListener?: AnalysisStatusListener;
}

/**
 * 조항 분석 시간 초과 오류.
 *
 * 조항 분석 파이프라인이 설정된 타임아웃(기본 90초)을 초과했음을 나타낸다.
 */
export class AnalysisTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`조항 분석이 ${timeoutMs}ms 타임아웃을 초과했습니다.`);
    this.name = 'AnalysisTimeoutError';
  }
}

/**
 * 계약서 분석 오케스트레이터.
 *
 * @requirements 3.5, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8
 */
export class AnalysisOrchestrator {
  private readonly deps: AnalysisOrchestratorDeps;
  private readonly timeoutMs: number;
  private readonly maxAutoRetries: number;
  private readonly statusListener?: AnalysisStatusListener;

  constructor(
    deps: AnalysisOrchestratorDeps,
    config: AnalysisOrchestratorConfig = {},
  ) {
    this.deps = deps;
    this.timeoutMs = config.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
    this.maxAutoRetries = config.maxAutoRetries ?? MAX_AUTO_RETRIES;
    if (config.statusListener) {
      this.statusListener = config.statusListener;
    }
  }

  /**
   * 계약서 분석 파이프라인을 실행한다.
   *
   * 요청 접수 즉시 처리 상태 표시를 시작하고(요구사항 14.1), 조항 분석을 90초
   * 타임아웃으로 통제한다(요구사항 14.4). 타임아웃 시 최대 1회 자동 재시도하며
   * (요구사항 14.5), 재시도도 초과하면 수동 재시도 옵션을 담은 실패 결과를
   * 반환한다. 어떤 실패에서도 문서 식별자는 24시간 보존한다(요구사항 14.8).
   *
   * @param input - 오케스트레이터 실행 입력
   * @returns 분석 성공 결과 또는 실패 정보
   *
   * @requirements 14.1, 14.4, 14.5, 14.8
   */
  async analyze(input: AnalysisOrchestratorInput): Promise<OrchestrationResult> {
    const startedAt = Date.now();

    // 요구사항 14.1: 요청 접수 즉시(3초 이내) 처리 상태 표시를 시작한다.
    this.emitStatus('received', '분석 요청을 접수했어요. 곧 분석을 시작할게요.', startedAt, 0);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxAutoRetries; attempt += 1) {
      try {
        const result = await this.withTimeout(
          this.runPipeline(input, startedAt, attempt),
          this.timeoutMs,
        );
        result.processingTimeMs = Date.now() - startedAt;
        this.emitStatus(
          'completed',
          '계약서 분석이 완료되었어요.',
          startedAt,
          attempt,
        );
        return { success: true, result };
      } catch (error) {
        lastError = error;
        const isTimeout = error instanceof AnalysisTimeoutError;
        // 요구사항 14.5: 시간 초과 시 최대 1회 자동 재시도한다.
        if (isTimeout && attempt < this.maxAutoRetries) {
          this.emitStatus(
            'received',
            '분석이 지연되고 있어 한 번 더 시도할게요.',
            startedAt,
            attempt + 1,
          );
          continue;
        }
        break;
      }
    }

    // 모든 시도가 실패한 경우: 문서 식별자 보존 + 실패 결과 반환
    return this.buildFailure(input.documentId, lastError, startedAt);
  }

  /**
   * 조항 분석 파이프라인 본체.
   *
   * 정보 추출 → 룰셋 로드 → 위험조항 탐지 → 위험도 평가 → (선택) 수정 제안 →
   * (선택) 판례 연동 → (선택) 인용 → (선택) 비교 → 체크리스트 → 저장 순으로
   * 처리한다. 선택 단계 실패는 예외로 전파하지 않고 Graceful Degradation으로
   * 흡수한다. 핵심 단계(룰셋 로드·위험조항 탐지·위험도 평가) 실패는 예외로
   * 전파되어 상위에서 재시도/실패 처리된다.
   *
   * @param input - 실행 입력
   * @param startedAt - 요청 접수 시각(epoch 밀리초)
   * @param attempt - 현재 시도 번호(0-based)
   * @returns 구조화된 분석 결과
   *
   * @requirements 3.5, 14.3, 14.6
   */
  private async runPipeline(
    input: AnalysisOrchestratorInput,
    startedAt: number,
    attempt: number,
  ): Promise<AnalysisResult> {
    const { documentId, contractType, perspective, clauses } = input;

    // 1) 정보 추출 (요구사항 14.6에서 조항 0건이어도 항상 제공)
    this.emitStatus('extracting_info', '계약서 정보를 정리하고 있어요.', startedAt, attempt);
    const extractedInfo = this.extractInfo(input);

    // 첨부서류 체크리스트는 조항 유무와 무관하게 계약 유형 기준으로 제공한다.
    this.emitStatus('building_checklist', '첨부서류 체크리스트를 준비하고 있어요.', startedAt, attempt);
    const checklist = await this.buildChecklist(contractType, input.registryResult);

    // 요구사항 14.6: 분석 대상 조항이 0건이면 추출 정보 요약과 체크리스트만 반환한다.
    if (clauses.length === 0) {
      return this.buildEmptyResult(documentId, extractedInfo, checklist);
    }

    // 2) 룰셋 로드 (핵심 단계, 실패 시 예외 전파)
    this.emitStatus('loading_ruleset', '분석 기준을 불러오고 있어요.', startedAt, attempt);
    const rules = await this.loadRuleSet(contractType);

    // 3) 위험조항 탐지 (핵심 단계)
    this.emitStatus('detecting_risks', '위험 조항을 탐지하고 있어요.', startedAt, attempt);
    const detection = await this.deps.riskDetector.detect({
      documentId,
      contractType,
      perspective,
      clauses,
      rules: rules.rules,
      ...(rules.version !== undefined ? { ruleSetVersion: rules.version } : {}),
    });

    // 4) 위험도 평가 (+등기부 대조 결과 반영, 핵심 단계)
    this.emitStatus('evaluating_risks', '위험도를 평가하고 있어요.', startedAt, attempt);
    // 위험 조항(RiskClause)은 그대로 등급 부여 입력(GradeAssignmentInput)으로
    // 사용한다. 사전 산출 등급이 없으므로 GradeAssigner가 Property 12에 따라
    // 미확정 등급을 처리한다.
    const gradeInputs: GradeAssignmentInput[] = detection.riskClauses.map(
      (clause) => ({ ...clause }),
    );
    const evaluation = this.deps.riskEvaluator.evaluate({
      riskClauses: gradeInputs,
      ...(input.registryResult ? { registryResult: input.registryResult } : {}),
    });

    // 위험 조항과 등급을 조항 식별자 기준으로 결합한다.
    const riskClauseViews = this.mergeClauseGrades(
      detection.riskClauses,
      evaluation.gradedClauses,
    );

    const degraded: DegradedFeatures = {
      revisions: false,
      caseLinks: false,
      comparison: false,
      registry: input.registryResult === undefined,
    };

    // 5) 수정 제안 (선택, 실패 시 생략)
    this.emitStatus('generating_revisions', '수정 제안을 만들고 있어요.', startedAt, attempt);
    const { revisionSuggestions, legalReferences } = await this.generateRevisions(
      detection.riskClauses,
      contractType,
      perspective,
      degraded,
    );

    // 6) 판례 연동 (선택, 실패 시 caseLinkAvailable=false)
    this.emitStatus('linking_cases', '유사 판례를 연동하고 있어요.', startedAt, attempt);
    const linkedCases = await this.linkCases(detection.riskClauses, degraded);

    // 7) 인용(각주) (선택, 실패 시 생략)
    this.emitStatus('annotating', '근거 각주를 정리하고 있어요.', startedAt, attempt);
    const footnotes = this.annotate(detection.riskClauses, legalReferences);

    // 8) 표준계약서 비교 (선택, 실패 시 생략)
    this.emitStatus('comparing', '표준계약서와 비교하고 있어요.', startedAt, attempt);
    const comparison = await this.compare(contractType, clauses, degraded);

    // 9) 결과 구조화 (Property 35 순서)
    const result = this.buildResult({
      documentId,
      overallRisk: this.buildOverallRisk(evaluation.overallGrade, evaluation.fraudScore),
      riskClauseViews,
      missingClauses: detection.missingClauses,
      revisionSuggestions,
      footnotes,
      extractedInfo,
      checklist,
      comparison,
      linkedCases,
      degraded,
    });

    // 10) 결과 저장 (선택, 실패는 무시하고 결과는 반환)
    this.emitStatus('saving', '분석 결과를 저장하고 있어요.', startedAt, attempt);
    await this.persistResult(documentId, result);

    return result;
  }

  /**
   * 정보 추출 단계.
   *
   * 정보 추출 실패는 분석 전체를 중단시키지 않고, 실패 상태의 빈 요약으로
   * 대체하여 파이프라인을 계속 진행한다(추출 정보는 핵심 결과의 일부이지만
   * 다른 단계의 선행 조건은 아니다).
   *
   * @param input - 실행 입력
   * @returns 추출 정보 요약 섹션
   */
  private extractInfo(input: AnalysisOrchestratorInput): ExtractedInfoSection {
    try {
      const output = this.deps.infoExtractor.extract({
        documentId: input.documentId,
        fullText: input.fullText,
        contractType: input.contractType,
      });
      return { fields: output.extractedFields, status: output.extractionStatus };
    } catch {
      return { fields: [], status: 'failed' };
    }
  }

  /**
   * 룰셋 로드 단계.
   *
   * 룰셋 로드는 핵심 선행 단계이므로, 실패 시 오류를 던져 파이프라인을
   * 중단시킨다(요구사항 2.9). 반환값에는 로드된 룰과 버전이 포함된다.
   *
   * @param contractType - 계약 유형
   * @returns 로드된 룰 목록과 버전
   * @throws 룰셋 로드 실패 시 오류
   */
  private async loadRuleSet(
    contractType: ContractType,
  ): Promise<{ rules: ToxicRule[]; version?: number }> {
    const loaded = await this.deps.ruleSetLoader.load(contractType);
    if (!loaded.success) {
      throw new Error(loaded.error.message);
    }
    return {
      rules: loaded.rules,
      ...(loaded.version !== undefined ? { version: loaded.version } : {}),
    };
  }

  /**
   * 수정 제안 생성 단계 (선택).
   *
   * 각 위험 조항에 대해 수정제안 생성기를 호출한다. 수정제안 생성기가
   * 미주입되었거나 어떤 조항의 생성이 실패하면 해당 단계를 생략하고
   * `degraded.revisions=true`로 표시한다(핵심 결과는 유지). 부분 성공을
   * 허용하되, 근거 목록은 인용(각주) 단계에서 재사용할 수 있도록 조항별로
   * 수집한다.
   *
   * @param riskClauses - 위험 조항 목록
   * @param contractType - 계약 유형
   * @param perspective - 당사자 관점
   * @param degraded - 부분 실패 상태 (변경됨)
   * @returns 조항별 수정 제안과 조항별 근거 매핑
   */
  private async generateRevisions(
    riskClauses: RiskClause[],
    contractType: ContractType,
    perspective: PartyPerspective,
    degraded: DegradedFeatures,
  ): Promise<{
    revisionSuggestions: ClauseRevisionSuggestions[];
    legalReferences: Record<string, LegalReference[]>;
  }> {
    const advisor = this.deps.revisionAdvisor;
    const revisionSuggestions: ClauseRevisionSuggestions[] = [];
    const legalReferences: Record<string, LegalReference[]> = {};

    if (!advisor || riskClauses.length === 0) {
      if (!advisor && riskClauses.length > 0) {
        degraded.revisions = true;
      }
      return { revisionSuggestions, legalReferences };
    }

    for (const clause of riskClauses) {
      try {
        const output = await advisor.advise({
          mode: 'suggest',
          perspective,
          riskClause: clause,
          contractType,
        });
        const suggestions = output.suggestions ?? [];
        if (suggestions.length > 0) {
          revisionSuggestions.push({ clauseId: clause.clauseId, suggestions });
          const refs = suggestions.flatMap((s) => s.legalBasis);
          if (refs.length > 0) {
            legalReferences[clause.clauseId] = refs;
          }
        }
      } catch {
        // 개별 조항 실패는 전체를 중단시키지 않고 생략으로 표시한다.
        degraded.revisions = true;
      }
    }

    return { revisionSuggestions, legalReferences };
  }

  /**
   * 판례 연동 단계 (선택).
   *
   * 판례 연동기는 내부적으로 10초 타임아웃/오류를 폴백으로 흡수하므로 예외를
   * 던지지 않는다. 연동기가 미주입되었거나 `caseLinkAvailable=false`이면
   * `degraded.caseLinks=true`로 표시하고 빈 목록을 반환한다.
   *
   * @param riskClauses - 위험 조항 목록
   * @param degraded - 부분 실패 상태 (변경됨)
   * @returns 조항별 연동 판례 목록
   */
  private async linkCases(
    riskClauses: RiskClause[],
    degraded: DegradedFeatures,
  ): Promise<ClauseLinkedCases[]> {
    const linker = this.deps.caseLinker;
    if (!linker || riskClauses.length === 0) {
      if (!linker && riskClauses.length > 0) {
        degraded.caseLinks = true;
      }
      return [];
    }

    try {
      const output = await linker.link({ riskClauses });
      if (!output.caseLinkAvailable) {
        degraded.caseLinks = true;
      }
      return output.linkedCases;
    } catch {
      degraded.caseLinks = true;
      return [];
    }
  }

  /**
   * 인용(각주) 단계 (선택).
   *
   * 인용 표시기가 미주입되었거나 처리에 실패하면 빈 각주 목록을 반환한다.
   * 인용은 근거 각주 섹션을 채우는 부가 기능이므로 실패해도 핵심 결과에는
   * 영향을 주지 않는다.
   *
   * @param riskClauses - 위험 조항 목록
   * @param legalReferences - 조항별 근거 매핑
   * @returns 각주가 부여된 조항 목록
   */
  private annotate(
    riskClauses: RiskClause[],
    legalReferences: Record<string, LegalReference[]>,
  ): AnnotatedClause[] {
    const citation = this.deps.citation;
    if (!citation || riskClauses.length === 0) {
      return [];
    }
    try {
      const output = citation.annotate({ riskClauses, legalReferences });
      return output.annotatedClauses;
    } catch {
      return [];
    }
  }

  /**
   * 표준계약서 비교 단계 (선택).
   *
   * 비교 분석기가 미주입되었거나 표준양식 로드 실패 등으로 예외가 발생하면
   * `degraded.comparison=true`로 표시하고 undefined를 반환한다(요구사항 8의
   * 데이터 보존은 비교 분석기가 담당한다).
   *
   * @param contractType - 계약 유형
   * @param clauses - 업로드 조항 목록
   * @param degraded - 부분 실패 상태 (변경됨)
   * @returns 조항 비교 결과 또는 undefined
   */
  private async compare(
    contractType: ContractType,
    clauses: RecognizedClause[],
    degraded: DegradedFeatures,
  ): Promise<ClauseComparison[] | undefined> {
    const comparator = this.deps.comparator;
    if (!comparator) {
      degraded.comparison = true;
      return undefined;
    }
    try {
      const output = await comparator.compare({
        contractType,
        uploadedClauses: clauses,
      });
      if (!output.standardFormExists) {
        // 표준양식 미존재는 정상 생략이므로 별도 저하 표시는 하지 않는다.
        return output.comparisons;
      }
      return output.comparisons;
    } catch {
      degraded.comparison = true;
      return undefined;
    }
  }

  /**
   * 첨부서류 체크리스트 단계.
   *
   * 계약 유형 기준으로 체크리스트를 조회하고, 등기부 대조 결과가 있으면
   * 등기부등본 항목 상태를 반영한다. 체크리스트 조회 실패는 핵심 흐름을
   * 막지 않고 안내 메시지를 담은 빈 체크리스트로 대체한다.
   *
   * @param contractType - 계약 유형
   * @param registryResult - 등기부 대조 결과 (선택)
   * @returns 체크리스트 섹션
   *
   * @requirements 10.1, 10.4, 10.5
   */
  private async buildChecklist(
    contractType: ContractType,
    registryResult?: RegistryMatchResult,
  ): Promise<ChecklistSection> {
    try {
      const checklistResult = await this.deps.checklistService.getChecklist(contractType);
      if (!checklistResult.hasChecklist || !checklistResult.checklist) {
        const section: ChecklistSection = { hasChecklist: false, items: [] };
        if (checklistResult.message) {
          section.message = checklistResult.message;
        }
        return section;
      }

      let checklist = checklistResult.checklist;
      // 요구사항 10.4/10.5: 등기부 대조 결과 반영
      if (registryResult) {
        checklist = this.deps.checklistService.applyRegistryMatch(
          checklist,
          registryResult,
        );
      }
      return { hasChecklist: true, items: checklist.items };
    } catch {
      return {
        hasChecklist: false,
        items: [],
        message: '첨부서류 체크리스트를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.',
      };
    }
  }

  /**
   * 위험 조항과 부여된 등급을 조항 식별자 기준으로 결합한다.
   *
   * 등급 정보가 없는 조항은(등급 부여 누락) 표시되지 않도록 등급 목록에 있는
   * 조항만 뷰로 구성하되, 등급이 없으면 안전하게 상(high) 미확정 등급으로
   * 대체한다.
   *
   * @param riskClauses - 위험 조항 목록
   * @param gradedClauses - 등급 부여 결과 목록
   * @returns 위험 조항 뷰 목록
   */
  private mergeClauseGrades(
    riskClauses: RiskClause[],
    gradedClauses: GradedRiskClause[],
  ): RiskClauseView[] {
    const gradeById = new Map<string, GradedRiskClause>();
    for (const graded of gradedClauses) {
      gradeById.set(graded.clauseId, graded);
    }

    return riskClauses.map((clause) => {
      const grade = gradeById.get(clause.clauseId) ?? {
        clauseId: clause.clauseId,
        grade: 'high' as RiskGrade,
        gradeCriteria: '등급 미확정으로 안전하게 상(高)으로 처리했어요.',
        isGradeUndetermined: true,
        colorMapping: 'red' as const,
      };
      return { clause, grade };
    });
  }

  /**
   * 종합 위험도 섹션을 구성한다.
   *
   * 종합 등급에 대응하는 색상을 매핑하고, 전세사기 위험 점수가 있으면 함께
   * 포함한다.
   *
   * @param grade - 종합 위험도 등급
   * @param fraudScore - 전세사기 위험 점수 (선택)
   * @returns 종합 위험도 섹션
   */
  private buildOverallRisk(
    grade: RiskGrade,
    fraudScore?: FraudRiskScore,
  ): OverallRiskSection {
    const color = grade === 'high' ? 'red' : grade === 'medium' ? 'yellow' : 'green';
    const section: OverallRiskSection = { grade, color };
    if (fraudScore) {
      section.fraudScore = fraudScore;
    }
    return section;
  }

  /**
   * 분석 결과를 Property 35 순서로 구조화한다.
   *
   * `sectionOrder`는 고정 순서 상수(`RESULT_SECTION_ORDER`)를 그대로 사용하여
   * 결과 구조 순서 불변식을 명시적으로 노출한다.
   *
   * @param parts - 결과 구성 요소
   * @returns 구조화된 분석 결과
   *
   * @requirements 14.3
   */
  private buildResult(parts: {
    documentId: string;
    overallRisk: OverallRiskSection;
    riskClauseViews: RiskClauseView[];
    missingClauses: MissingClause[];
    revisionSuggestions: ClauseRevisionSuggestions[];
    footnotes: AnnotatedClause[];
    extractedInfo: ExtractedInfoSection;
    checklist: ChecklistSection;
    comparison?: ClauseComparison[];
    linkedCases: ClauseLinkedCases[];
    degraded: DegradedFeatures;
  }): AnalysisResult {
    const result: AnalysisResult = {
      documentId: parts.documentId,
      sectionOrder: [...RESULT_SECTION_ORDER],
      overallRisk: parts.overallRisk,
      riskClauses: parts.riskClauseViews,
      missingClauses: parts.missingClauses,
      revisionSuggestions: parts.revisionSuggestions,
      footnotes: parts.footnotes,
      extractedInfo: parts.extractedInfo,
      checklist: parts.checklist,
      degraded: parts.degraded,
      isEmptyAnalysis: false,
      message: this.buildSummaryMessage(parts.degraded),
      processingTimeMs: 0,
    };
    if (parts.comparison !== undefined) {
      result.comparison = parts.comparison;
    }
    if (parts.linkedCases.length > 0) {
      result.linkedCases = parts.linkedCases;
    }
    return result;
  }

  /**
   * 분석 대상 조항이 0건일 때의 결과를 구성한다(요구사항 14.6).
   *
   * 추출 정보 요약과 첨부서류 체크리스트만 채우고, 나머지 섹션은 비운다.
   * 종합 위험도는 위험 조항이 없으므로 "하"(low)로 설정한다.
   *
   * @param documentId - 문서 식별자
   * @param extractedInfo - 추출 정보 요약
   * @param checklist - 첨부서류 체크리스트
   * @returns 빈 분석 결과
   *
   * @requirements 14.6
   */
  private buildEmptyResult(
    documentId: string,
    extractedInfo: ExtractedInfoSection,
    checklist: ChecklistSection,
  ): AnalysisResult {
    return {
      documentId,
      sectionOrder: [...RESULT_SECTION_ORDER],
      overallRisk: { grade: 'low', color: 'green' },
      riskClauses: [],
      missingClauses: [],
      revisionSuggestions: [],
      footnotes: [],
      extractedInfo,
      checklist,
      degraded: {
        revisions: false,
        caseLinks: false,
        comparison: false,
        registry: true,
      },
      isEmptyAnalysis: true,
      message:
        '분석할 조항을 찾지 못했어요. 추출한 정보 요약과 첨부서류 체크리스트를 제공해 드릴게요.',
      processingTimeMs: 0,
    };
  }

  /**
   * 부분 실패 상태에 따른 사용자 안내 메시지를 존댓말로 생성한다.
   *
   * @param degraded - 부분 실패 상태
   * @returns 안내 메시지
   *
   * @requirements 14.7
   */
  private buildSummaryMessage(degraded: DegradedFeatures): string {
    const omitted: string[] = [];
    if (degraded.revisions) omitted.push('수정 제안');
    if (degraded.caseLinks) omitted.push('유사 판례 연동');
    if (degraded.comparison) omitted.push('표준계약서 비교');

    if (omitted.length === 0) {
      return '계약서 분석을 마쳤어요. 결과를 확인해 주세요.';
    }
    return `계약서 분석을 마쳤어요. 다만 ${omitted.join(', ')} 기능은 일시적으로 제공하지 못했어요. 핵심 분석 결과는 정상적으로 제공해 드립니다.`;
  }

  /**
   * 분석 결과를 DynamoDB에 저장한다.
   *
   * 저장소가 미주입되었거나 저장이 실패해도 분석 결과는 사용자에게 반환되므로
   * 예외를 흡수한다(저장 실패는 핵심 결과 제공을 막지 않는다).
   *
   * @param documentId - 문서 식별자
   * @param result - 분석 결과
   */
  private async persistResult(
    documentId: string,
    result: AnalysisResult,
  ): Promise<void> {
    const store = this.deps.dynamoStore;
    if (!store) {
      return;
    }
    try {
      const record: Parameters<ContractDynamoStore['saveAnalysis']>[1] = {
        overallGrade: result.overallRisk.grade,
        riskClauseCount: result.riskClauses.length,
        ...(result.overallRisk.fraudScore
          ? { fraudScore: result.overallRisk.fraudScore.score }
          : {}),
      };
      await store.saveAnalysis(documentId, record);
    } catch {
      // 저장 실패는 무시하고 결과를 그대로 반환한다.
    }
  }

  /**
   * 파이프라인 실패 시 문서 식별자를 보존하고 실패 결과를 구성한다.
   *
   * 요구사항 14.8에 따라 문서 식별자를 24시간 보존하며, 시간 초과인 경우
   * 수동 재시도 옵션을 제공한다(요구사항 14.5). 보존 자체가 실패해도 실패
   * 결과는 반환한다.
   *
   * @param documentId - 문서 식별자
   * @param error - 원인 오류
   * @param startedAt - 요청 접수 시각
   * @returns 실패 오케스트레이션 결과
   *
   * @requirements 14.5, 14.8
   */
  private async buildFailure(
    documentId: string,
    error: unknown,
    startedAt: number,
  ): Promise<OrchestrationResult> {
    const isTimeout = error instanceof AnalysisTimeoutError;

    // 요구사항 14.8: 오류 발생 시 문서 식별자를 24시간 보존한다.
    let documentPreserved = false;
    if (this.deps.dynamoStore) {
      try {
        await this.deps.dynamoStore.preserveOnError(documentId);
        documentPreserved = true;
      } catch {
        documentPreserved = false;
      }
    }

    this.emitStatus(
      'failed',
      isTimeout
        ? '분석이 지연되어 완료하지 못했어요. 다시 시도해 주세요.'
        : '분석 중 오류가 발생했어요. 다시 시도해 주세요.',
      startedAt,
      this.maxAutoRetries,
    );

    return {
      success: false,
      error: {
        code: isTimeout ? ANALYSIS_TIMEOUT_CODE : ANALYSIS_FAILED_CODE,
        message: isTimeout
          ? '계약서 분석이 지연되어 자동 재시도까지 완료하지 못했어요. 수동으로 다시 시도해 주세요.'
          : '계약서 분석 중 오류가 발생했어요. 다시 시도해 주세요.',
        manualRetryAvailable: true,
        autoRetryCount: isTimeout ? this.maxAutoRetries : 0,
        documentPreserved,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * 처리 상태 알림을 리스너로 전달한다.
   *
   * 상태 리스너가 주입된 경우에만 호출되며, 리스너에서 발생한 예외는 분석
   * 흐름에 영향을 주지 않도록 흡수한다.
   *
   * @param stage - 현재 단계
   * @param message - 존댓말 안내 메시지
   * @param startedAt - 요청 접수 시각
   * @param retryCount - 자동 재시도 횟수
   *
   * @requirements 14.1, 14.2, 14.7
   */
  private emitStatus(
    stage: AnalysisStage,
    message: string,
    startedAt: number,
    retryCount: number,
  ): void {
    if (!this.statusListener) {
      return;
    }
    try {
      this.statusListener({
        stage,
        message,
        elapsedMs: Date.now() - startedAt,
        retryCount,
      });
    } catch {
      // 상태 리스너 오류는 분석에 영향을 주지 않는다.
    }
  }

  /**
   * 주어진 Promise가 타임아웃 내에 완료되지 않으면 타임아웃 오류를 던진다.
   *
   * 타이머는 성공/실패와 무관하게 항상 정리된다.
   *
   * @param promise - 감싸질 작업 Promise
   * @param timeoutMs - 타임아웃 (밀리초)
   * @returns 작업 결과
   * @throws AnalysisTimeoutError 타임아웃 초과 시
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AnalysisTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
    }) as Promise<T>;
  }
}
