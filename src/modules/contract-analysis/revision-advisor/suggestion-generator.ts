/**
 * 수정제안 생성기 (SuggestionGenerator)
 *
 * 위험 조항에 대한 수정 문안 제안(mode=suggest)과 사용자 문의 조항의 법적
 * 유효성·유불리 판단(mode=judge)을 LLM을 통해 생성하는 핵심 생성기이다.
 * LLM 호출은 `RevisionLlmAdapter`(bedrock | gemini | mock)로 위임하여 제공자를
 * 교체할 수 있도록 한다.
 *
 * 주요 규칙:
 *   - Property 19: mode=suggest 결과의 수정 제안 수는 1개 이상 5개 이하.
 *   - Property 20: 근거(법조항/판례)가 1건도 없으면 hasExplicitBasis=false +
 *     확정적 판단 대신 일반 주의사항만 제공, 1건 이상이면 true.
 *   - Property 21: 모든 결과의 disclaimer(면책 고지)는 비어있지 않음.
 *   - Property 22: 부동산 계약 범위 외 문의는 isOutOfScope=true + judgment 미생성.
 *   - 30초 이내 생성(타임아웃), 존댓말(해요체/합쇼체) 한국어.
 *   - 생성 실패 시 오류를 던지며(부분 결과 미저장), 모듈이 표준 오류로 감싼다.
 *
 * @module SuggestionGenerator
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

import type {
  RevisionAdvisorInput,
  RevisionAdvisorOutput,
  RevisionSuggestion,
  ClauseJudgment,
  LegalReference,
  PartyImpact,
} from '../interfaces/index.js';
import {
  createRevisionLlmAdapter,
  type RevisionLlmAdapter,
} from './revision-llm-adapter.js';

/** 수정 제안 최대 개수 (Property 19) */
export const MAX_SUGGESTIONS = 5;

/** 수정 제안 최소 개수 (Property 19) */
export const MIN_SUGGESTIONS = 1;

/** 문의 조항 문구 최소 길이 */
export const MIN_QUERY_LENGTH = 1;

/** 문의 조항 문구 최대 길이 */
export const MAX_QUERY_LENGTH = 2000;

/** 기본 생성 타임아웃 (30초) */
export const DEFAULT_GENERATION_TIMEOUT_MS = 30_000;

/**
 * 면책 고지 문구 (Property 21).
 *
 * 본 내용이 참고용이며 법적 효력이 없고 실제 계약 체결 시 전문가 상담을
 * 권장한다는 취지를 존댓말로 담는다.
 */
export const DISCLAIMER =
  '본 내용은 참고용으로 제공되며 법적 효력이 없습니다. 실제 계약 체결 전에는 반드시 변호사 등 전문가와 상담하시기 바랍니다.';

/**
 * 근거를 확보하지 못했을 때 제공하는 일반 주의사항 (Property 20).
 */
export const GENERAL_CAUTION =
  '명시적인 근거 법조항이나 판례를 확인하지 못했습니다. 확정적인 판단 대신 일반적인 주의사항으로 참고해 주시고, 계약 체결 전 전문가의 검토를 받으시기 바랍니다.';

/** 유효한 당사자 관점 유불리 값 집합 */
const VALID_PARTY_IMPACTS: readonly PartyImpact[] = [
  'disadvantageous',
  'neutral',
  'advantageous',
];

/**
 * 부동산 계약 범위 판정을 위한 키워드 목록.
 *
 * 부동산 계약(매매/전세/월세/상가임대차) 및 관련 조항에서 흔히 등장하는
 * 용어를 포함한다. 문의 문구에 하나 이상 포함되면 부동산 계약 범위로 본다.
 */
const REAL_ESTATE_KEYWORDS: readonly string[] = [
  '계약',
  '임대',
  '임차',
  '전세',
  '월세',
  '매매',
  '매수',
  '매도',
  '보증금',
  '임대인',
  '임차인',
  '매수인',
  '매도인',
  '중개',
  '부동산',
  '주택',
  '아파트',
  '상가',
  '건물',
  '토지',
  '등기',
  '근저당',
  '특약',
  '계약금',
  '잔금',
  '해지',
  '해제',
  '갱신',
  '명도',
  '관리비',
  '소유권',
  '점유',
  '권리금',
];

/**
 * SuggestionGenerator 생성자 설정
 */
export interface SuggestionGeneratorConfig {
  /** LLM 어댑터 (미지정 시 환경 변수 기반 생성) */
  llmAdapter?: RevisionLlmAdapter;
  /** 생성 타임아웃 (밀리초, 기본 30초) */
  timeoutMs?: number;
}

/**
 * 입력 검증 실패를 나타내는 오류.
 *
 * 모듈 계층에서 스키마 불일치 표준 오류로 변환할 수 있도록 별도 타입을 둔다.
 */
export class SuggestionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuggestionInputError';
  }
}

/**
 * 수정제안 생성 실패를 나타내는 오류 (Property/요구사항 6.8).
 *
 * LLM 호출 실패, 타임아웃, 응답 파싱 실패 등 생성 과정에서 발생한 오류를
 * 감싼다. 이 오류가 던져지면 부분 결과를 저장하지 않는다.
 */
export class SuggestionGenerationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SuggestionGenerationError';
  }
}

/**
 * 수정제안 생성기
 *
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */
export class SuggestionGenerator {
  private readonly llmAdapter: RevisionLlmAdapter;
  private readonly timeoutMs: number;

  constructor(config: SuggestionGeneratorConfig = {}) {
    this.llmAdapter = config.llmAdapter ?? createRevisionLlmAdapter();
    this.timeoutMs = config.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
  }

  /**
   * 입력 모드에 따라 수정 제안 또는 조항 판단을 생성한다.
   *
   * 부동산 계약 범위 외 문의(mode=judge)는 LLM을 호출하지 않고 즉시
   * isOutOfScope=true 결과를 반환한다(Property 22).
   *
   * @param input - 수정제안 생성기 입력
   * @returns 수정제안 생성기 출력
   * @throws SuggestionInputError 입력이 스키마와 불일치할 때
   * @throws SuggestionGenerationError 생성이 실패했을 때 (6.8)
   *
   * @requirements 6.1, 6.2, 6.7, 6.8
   */
  async generate(
    input: RevisionAdvisorInput,
  ): Promise<RevisionAdvisorOutput> {
    this.validateInput(input);

    if (input.mode === 'judge') {
      // Property 22: 범위 외 문의는 판단을 생성하지 않는다.
      const queryClause = input.queryClause ?? '';
      if (!this.isRealEstateScope(queryClause)) {
        return {
          mode: 'judge',
          isOutOfScope: true,
          disclaimer: DISCLAIMER,
        };
      }
      return this.generateJudgment(input, queryClause);
    }

    return this.generateSuggestions(input);
  }

  /**
   * mode=suggest: 위험 조항에 대한 수정 문안을 1~5개 생성한다.
   *
   * @param input - 입력 (riskClause 포함)
   * @returns 수정 제안 결과 (suggestions 1~5개)
   * @throws SuggestionGenerationError 생성 실패 시
   *
   * @requirements 6.1, 6.3, 6.4, 6.5, 6.6
   */
  private async generateSuggestions(
    input: RevisionAdvisorInput,
  ): Promise<RevisionAdvisorOutput> {
    const systemPrompt = this.buildSuggestSystemPrompt();
    const userPrompt = this.buildSuggestUserPrompt(input);

    let raw: string;
    try {
      raw = await this.llmAdapter.generate(
        systemPrompt,
        userPrompt,
        this.timeoutMs,
      );
    } catch (error) {
      throw new SuggestionGenerationError(
        '수정 제안 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        error,
      );
    }

    const parsed = this.parseSuggestions(raw);
    // Property 19: 1개 이상 5개 이하로 정규화한다.
    const bounded = this.boundSuggestions(parsed);

    return {
      mode: 'suggest',
      suggestions: bounded,
      isOutOfScope: false,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * mode=judge: 문의 조항의 법적 유효성·유불리·주의사항 판단을 생성한다.
   *
   * @param input - 입력 (queryClause 포함)
   * @param queryClause - 검증된 문의 조항 문구
   * @returns 조항 판단 결과
   * @throws SuggestionGenerationError 생성 실패 시
   *
   * @requirements 6.2, 6.3, 6.4, 6.5, 6.6
   */
  private async generateJudgment(
    input: RevisionAdvisorInput,
    queryClause: string,
  ): Promise<RevisionAdvisorOutput> {
    const systemPrompt = this.buildJudgeSystemPrompt();
    const userPrompt = this.buildJudgeUserPrompt(input, queryClause);

    let raw: string;
    try {
      raw = await this.llmAdapter.generate(
        systemPrompt,
        userPrompt,
        this.timeoutMs,
      );
    } catch (error) {
      throw new SuggestionGenerationError(
        '조항 판단 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        error,
      );
    }

    const judgment = this.parseJudgment(raw);

    return {
      mode: 'judge',
      judgment,
      isOutOfScope: false,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * 입력을 검증한다.
   *
   * mode별 필수 필드를 확인한다. mode=suggest는 riskClause,
   * mode=judge는 1~2000자 queryClause를 요구한다.
   *
   * @param input - 입력
   * @throws SuggestionInputError 검증 실패 시
   *
   * @requirements 6.2, 16.8
   */
  private validateInput(input: RevisionAdvisorInput): void {
    if (!input || typeof input !== 'object') {
      throw new SuggestionInputError('입력이 비어있습니다.');
    }
    if (input.mode !== 'suggest' && input.mode !== 'judge') {
      throw new SuggestionInputError(
        `알 수 없는 모드입니다: ${String(input.mode)}`,
      );
    }
    if (input.mode === 'suggest') {
      if (!input.riskClause || typeof input.riskClause !== 'object') {
        throw new SuggestionInputError(
          'mode=suggest에는 riskClause가 필요합니다.',
        );
      }
    } else {
      const query = input.queryClause;
      if (typeof query !== 'string') {
        throw new SuggestionInputError(
          'mode=judge에는 queryClause 문자열이 필요합니다.',
        );
      }
      const length = query.trim().length;
      if (length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) {
        throw new SuggestionInputError(
          `문의 조항 문구는 ${MIN_QUERY_LENGTH}자 이상 ${MAX_QUERY_LENGTH}자 이하여야 합니다.`,
        );
      }
    }
  }

  /**
   * 문의 문구가 부동산 계약 범위에 해당하는지 판정한다 (Property 22).
   *
   * 부동산 계약 관련 키워드가 하나 이상 포함되면 범위 내로 본다.
   *
   * @param queryClause - 문의 조항 문구
   * @returns 부동산 계약 범위 여부
   *
   * @requirements 6.7
   */
  private isRealEstateScope(queryClause: string): boolean {
    const text = queryClause.trim();
    if (text.length === 0) {
      return false;
    }
    return REAL_ESTATE_KEYWORDS.some((keyword) => text.includes(keyword));
  }

  /**
   * 수정 제안 목록을 1~5개 범위로 정규화한다 (Property 19).
   *
   * 비어있으면 안전한 폴백 제안 1개를 만들어 최소 1개를 보장하고,
   * 5개를 초과하면 앞에서부터 5개만 취한다. 각 제안의 근거 유무에 따라
   * hasExplicitBasis를 재계산한다(Property 20).
   *
   * @param suggestions - 파싱된 제안 목록
   * @returns 1~5개로 정규화된 제안 목록
   *
   * @requirements 6.1, 6.3, 6.4
   */
  private boundSuggestions(
    suggestions: RevisionSuggestion[],
  ): RevisionSuggestion[] {
    const normalized = suggestions.map((s) => this.normalizeSuggestion(s));
    if (normalized.length === 0) {
      normalized.push(this.buildFallbackSuggestion());
    }
    if (normalized.length > MAX_SUGGESTIONS) {
      return normalized.slice(0, MAX_SUGGESTIONS);
    }
    return normalized;
  }

  /**
   * 개별 수정 제안을 정규화한다.
   *
   * 근거 목록을 정리하고 hasExplicitBasis를 근거 유무에 맞춰 설정한다.
   * 근거가 없으면 일반 주의사항을 rationale에 보강한다(Property 20).
   *
   * @param suggestion - 원본 제안
   * @returns 정규화된 제안
   *
   * @requirements 6.3, 6.4
   */
  private normalizeSuggestion(
    suggestion: RevisionSuggestion,
  ): RevisionSuggestion {
    const legalBasis = this.normalizeLegalBasis(suggestion.legalBasis);
    const hasExplicitBasis = legalBasis.length > 0;
    const revisedText =
      typeof suggestion.revisedText === 'string' &&
      suggestion.revisedText.trim().length > 0
        ? suggestion.revisedText
        : '조항을 당사자 쌍방의 권리와 의무가 균형을 이루도록 수정하시기 바랍니다.';
    let rationale =
      typeof suggestion.rationale === 'string' &&
      suggestion.rationale.trim().length > 0
        ? suggestion.rationale
        : '기존 문구가 일방에게 불리하게 해석될 여지가 있어 형평에 맞게 조정하는 것이 안전합니다.';
    if (!hasExplicitBasis) {
      rationale = `${rationale} ${GENERAL_CAUTION}`;
    }
    return {
      revisedText,
      rationale,
      legalBasis,
      hasExplicitBasis,
    };
  }

  /**
   * 근거 부재 시 사용하는 폴백 수정 제안을 만든다.
   *
   * @returns 근거 없는 폴백 제안 (hasExplicitBasis=false)
   *
   * @requirements 6.1, 6.4
   */
  private buildFallbackSuggestion(): RevisionSuggestion {
    return {
      revisedText:
        '해당 조항을 당사자 쌍방의 권리와 의무가 균형을 이루도록 수정하시기 바랍니다.',
      rationale: `기존 문구가 일방에게 불리하게 해석될 여지가 있어 형평에 맞게 조정하시는 것을 권장합니다. ${GENERAL_CAUTION}`,
      legalBasis: [],
      hasExplicitBasis: false,
    };
  }

  /**
   * 조항 판단 결과를 정규화한다.
   *
   * 근거가 없으면 hasExplicitBasis=false로 두고 확정적 판단 대신 일반
   * 주의사항을 제공한다(Property 20).
   *
   * @param judgment - 원본 판단
   * @returns 정규화된 판단
   *
   * @requirements 6.3, 6.4
   */
  private normalizeJudgment(judgment: ClauseJudgment): ClauseJudgment {
    const legalBasis = this.normalizeLegalBasis(judgment.legalBasis);
    const hasExplicitBasis = legalBasis.length > 0;
    const partyImpactJudgment = VALID_PARTY_IMPACTS.includes(
      judgment.partyImpactJudgment,
    )
      ? judgment.partyImpactJudgment
      : 'neutral';

    if (!hasExplicitBasis) {
      // 근거가 없으면 확정적 유효성 판단 대신 일반 주의사항만 제공한다.
      return {
        legalValidity: GENERAL_CAUTION,
        partyImpactJudgment,
        cautions:
          typeof judgment.cautions === 'string' &&
          judgment.cautions.trim().length > 0
            ? judgment.cautions
            : GENERAL_CAUTION,
        legalBasis: [],
        hasExplicitBasis: false,
      };
    }

    return {
      legalValidity:
        typeof judgment.legalValidity === 'string' &&
        judgment.legalValidity.trim().length > 0
          ? judgment.legalValidity
          : '제시된 근거를 기준으로 볼 때 해당 조항은 검토가 필요합니다.',
      partyImpactJudgment,
      cautions:
        typeof judgment.cautions === 'string' &&
        judgment.cautions.trim().length > 0
          ? judgment.cautions
          : '조항의 구체적 해석은 계약 전체 맥락에 따라 달라질 수 있으니 주의하시기 바랍니다.',
      legalBasis,
      hasExplicitBasis: true,
    };
  }

  /**
   * 근거 법조항/판례 목록을 정규화한다.
   *
   * 배열이 아니거나 요약이 비어있는 항목을 제거한다.
   *
   * @param basis - 원본 근거 목록
   * @returns 정규화된 근거 목록
   *
   * @requirements 6.3, 6.4
   */
  private normalizeLegalBasis(basis: unknown): LegalReference[] {
    if (!Array.isArray(basis)) {
      return [];
    }
    const result: LegalReference[] = [];
    for (const item of basis) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const ref = item as Partial<LegalReference>;
      const type = ref.type === 'precedent' ? 'precedent' : 'law_article';
      const summary =
        typeof ref.summary === 'string' ? ref.summary.trim() : '';
      // 근거로 인정하려면 최소한의 식별 정보(요약 또는 법령명/사건번호)가 있어야 한다.
      const hasIdentity =
        summary.length > 0 ||
        (typeof ref.lawName === 'string' && ref.lawName.trim().length > 0) ||
        (typeof ref.caseNumber === 'string' &&
          ref.caseNumber.trim().length > 0);
      if (!hasIdentity) {
        continue;
      }
      const normalized: LegalReference = {
        type,
        summary: summary.length > 0 ? summary : '근거 요약이 제공되지 않았습니다.',
      };
      if (typeof ref.lawName === 'string' && ref.lawName.trim().length > 0) {
        normalized.lawName = ref.lawName.trim();
      }
      if (
        typeof ref.articleNumber === 'string' &&
        ref.articleNumber.trim().length > 0
      ) {
        normalized.articleNumber = ref.articleNumber.trim();
      }
      if (
        typeof ref.caseNumber === 'string' &&
        ref.caseNumber.trim().length > 0
      ) {
        normalized.caseNumber = ref.caseNumber.trim();
      }
      result.push(normalized);
    }
    return result;
  }

  /**
   * LLM의 suggest 응답(JSON)을 수정 제안 목록으로 파싱한다.
   *
   * @param raw - LLM 응답 텍스트
   * @returns 파싱된 수정 제안 목록 (정규화 전)
   * @throws SuggestionGenerationError 파싱 실패 시
   *
   * @requirements 6.8
   */
  private parseSuggestions(raw: string): RevisionSuggestion[] {
    const json = this.extractJson(raw);
    const data = json as { suggestions?: unknown };
    if (!Array.isArray(data.suggestions)) {
      throw new SuggestionGenerationError(
        '수정 제안 응답 형식이 올바르지 않습니다.',
      );
    }
    return data.suggestions.map((item) => {
      const s = (item ?? {}) as Partial<RevisionSuggestion>;
      return {
        revisedText: typeof s.revisedText === 'string' ? s.revisedText : '',
        rationale: typeof s.rationale === 'string' ? s.rationale : '',
        legalBasis: Array.isArray(s.legalBasis) ? s.legalBasis : [],
        hasExplicitBasis: false,
      } satisfies RevisionSuggestion;
    });
  }

  /**
   * LLM의 judge 응답(JSON)을 조항 판단으로 파싱·정규화한다.
   *
   * @param raw - LLM 응답 텍스트
   * @returns 정규화된 조항 판단
   * @throws SuggestionGenerationError 파싱 실패 시
   *
   * @requirements 6.8
   */
  private parseJudgment(raw: string): ClauseJudgment {
    const json = this.extractJson(raw);
    const data = (json ?? {}) as Partial<ClauseJudgment>;
    if (
      typeof data.legalValidity !== 'string' &&
      typeof data.cautions !== 'string' &&
      !Array.isArray(data.legalBasis)
    ) {
      throw new SuggestionGenerationError(
        '조항 판단 응답 형식이 올바르지 않습니다.',
      );
    }
    const candidate: ClauseJudgment = {
      legalValidity:
        typeof data.legalValidity === 'string' ? data.legalValidity : '',
      partyImpactJudgment: VALID_PARTY_IMPACTS.includes(
        data.partyImpactJudgment as PartyImpact,
      )
        ? (data.partyImpactJudgment as PartyImpact)
        : 'neutral',
      cautions: typeof data.cautions === 'string' ? data.cautions : '',
      legalBasis: Array.isArray(data.legalBasis) ? data.legalBasis : [],
      hasExplicitBasis: false,
    };
    return this.normalizeJudgment(candidate);
  }

  /**
   * LLM 응답 텍스트에서 JSON 객체를 추출·파싱한다.
   *
   * 응답이 코드펜스(```json ... ```)로 감싸져 있거나 앞뒤에 설명 문구가
   * 붙어 있는 경우를 대비해 첫 '{'부터 마지막 '}'까지를 추출한다.
   *
   * @param raw - LLM 응답 텍스트
   * @returns 파싱된 JSON 값
   * @throws SuggestionGenerationError 파싱 실패 시
   */
  private extractJson(raw: string): unknown {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new SuggestionGenerationError('LLM 응답이 비어있습니다.');
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      throw new SuggestionGenerationError('LLM 응답에서 JSON을 찾지 못했습니다.');
    }
    const candidate = raw.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch (error) {
      throw new SuggestionGenerationError(
        'LLM 응답 JSON 파싱에 실패했습니다.',
        error,
      );
    }
  }

  /**
   * suggest 모드 시스템 프롬프트를 만든다.
   *
   * @returns 시스템 프롬프트
   */
  private buildSuggestSystemPrompt(): string {
    return [
      '당신은 대한민국 부동산 계약 전문 자문 도우미입니다.',
      '위험 조항에 대해 사용자가 선택한 당사자 관점에서 유리한 수정 문안을 제안하세요.',
      `수정 제안은 최소 ${MIN_SUGGESTIONS}개에서 최대 ${MAX_SUGGESTIONS}개까지 생성합니다.`,
      '모든 문장은 반드시 존댓말(해요체 또는 합쇼체)로 작성하세요.',
      '각 제안에는 가능하면 근거 법조항 또는 판례를 최소 1건 명시하세요. 확인되지 않으면 legalBasis를 빈 배열로 두세요.',
      '응답은 반드시 다음 JSON 형식만 출력하세요(설명 문구 금지):',
      '{"suggestions":[{"revisedText":"...","rationale":"...","legalBasis":[{"type":"law_article|precedent","lawName":"...","articleNumber":"...","caseNumber":"...","summary":"..."}]}]}',
    ].join('\n');
  }

  /**
   * suggest 모드 사용자 프롬프트를 만든다.
   *
   * @param input - 입력
   * @returns 사용자 프롬프트
   */
  private buildSuggestUserPrompt(input: RevisionAdvisorInput): string {
    const clause = input.riskClause;
    const original = clause?.span?.matchedText ?? '';
    return [
      '[MODE:suggest]',
      `계약 유형: ${input.contractType}`,
      `당사자 관점: ${input.perspective}`,
      `위험 유형: ${clause?.riskType ?? '미상'}`,
      `위험 사유: ${clause?.riskReason ?? '미상'}`,
      `대상 조항 원문: ${original}`,
    ].join('\n');
  }

  /**
   * judge 모드 시스템 프롬프트를 만든다.
   *
   * @returns 시스템 프롬프트
   */
  private buildJudgeSystemPrompt(): string {
    return [
      '당신은 대한민국 부동산 계약 전문 자문 도우미입니다.',
      '사용자가 문의한 조항 문구의 법적 유효성, 당사자 관점 기준 유불리, 주의사항을 판단하세요.',
      '모든 문장은 반드시 존댓말(해요체 또는 합쇼체)로 작성하세요.',
      '가능하면 근거 법조항 또는 판례를 최소 1건 명시하세요. 확인되지 않으면 legalBasis를 빈 배열로 두세요.',
      '응답은 반드시 다음 JSON 형식만 출력하세요(설명 문구 금지):',
      '{"legalValidity":"...","partyImpactJudgment":"disadvantageous|neutral|advantageous","cautions":"...","legalBasis":[{"type":"law_article|precedent","lawName":"...","articleNumber":"...","caseNumber":"...","summary":"..."}]}',
    ].join('\n');
  }

  /**
   * judge 모드 사용자 프롬프트를 만든다.
   *
   * @param input - 입력
   * @param queryClause - 문의 조항 문구
   * @returns 사용자 프롬프트
   */
  private buildJudgeUserPrompt(
    input: RevisionAdvisorInput,
    queryClause: string,
  ): string {
    return [
      '[MODE:judge]',
      `계약 유형: ${input.contractType}`,
      `당사자 관점: ${input.perspective}`,
      `문의 조항 문구: ${queryClause}`,
    ].join('\n');
  }
}
