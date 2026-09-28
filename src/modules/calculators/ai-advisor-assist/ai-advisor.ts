/**
 * AI 자문 보조기 (AiAdvisorAssist)
 *
 * 결정론적 계산 경로와 완전히 분리된 별도의 "AI에게 물어보기" 설명 보조 채널이다.
 * 질문과 계산 컨텍스트(입력 조건·적용 세율/요율·과세표준·항목별 내역·총액)를 프롬프트로
 * 구성해 제공자(로컬 Gemini 경로 / 배포 세무 자문 서비스 위임)에 위임하며, 세율·세액을
 * 재계산하지 않고 설명·보완만 수행한다. 계산 결과는 응답에 포함하지 않고 절대 변경하지 않는다.
 *
 * 장애 격리: Circuit Breaker(`src/common/utils/circuit-breaker.ts` 재활용)와 30초
 * 타임아웃으로 AI 채널 장애가 계산 경로에 전파되지 않도록 하며, 실패/타임아웃 시
 * `isAvailable=false`로 안내하되 계산 결과는 그대로 유지한다.
 *
 * 범위 판정: 부동산 취득·양도·중개보수 및 관련 세무 범위를 벗어나는 질문은
 * `isOutOfScope=true`로 자문 범위를 안내한다.
 *
 * @requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10
 */

import {
  CircuitBreaker,
  type CircuitBreakerConfig,
} from '../../../common/utils/circuit-breaker.js';
import type {
  AiAssistInput,
  AiAssistOutput,
  AiCalculationContext,
} from '../interfaces/ai-advisor.js';
import type { CalculatorType } from '../interfaces/types.js';

/**
 * AI 자문 보조 면책 고지 (요구사항 10.6)
 *
 * 참고용·법적 효력 없음·전문가 상담 안내를 포함한다.
 */
export const AI_ADVISOR_DISCLAIMER =
  '⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 정확한 세액 계산과 신고, 감면·예외 적용 여부는 반드시 세무사 등 전문가와 상담하시기 바랍니다.';

/**
 * 범위 외 질문 안내 메시지 (요구사항 10.7)
 */
export const AI_ADVISOR_OUT_OF_SCOPE_MESSAGE =
  '이 AI 보조는 부동산 취득·양도·중개보수 및 관련 세무 범위의 질문만 지원합니다. 해당 범위에 대한 질문을 입력해 주세요.';

/**
 * AI 일시 불가 안내 메시지 (요구사항 10.8)
 */
export const AI_ADVISOR_UNAVAILABLE_MESSAGE =
  'AI 자문 보조를 일시적으로 제공할 수 없습니다. 잠시 후 다시 시도해 주세요. 계산 결과는 그대로 유지됩니다.';

/** AI 자문 보조 호출 타임아웃 (요구사항 10.8) */
export const AI_ADVISOR_TIMEOUT_MS = 30000;

/** AI 자문 보조 Circuit Breaker 기본 설정 */
export const AI_ADVISOR_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 60000,
  monitoringWindow: 120000,
};

/**
 * AI 자문 보조 제공자 종류.
 *
 * - `local`: 로컬 Gemini 경로(gemini-3.6-flash) 직접 호출
 * - `tax-service`: 배포 환경의 세무 자문 서비스(real-estate-tax-ai-advisor) 위임
 */
export type AiAdvisorProviderType = 'local' | 'tax-service';

/**
 * AI 자문 보조 제공자 어댑터 인터페이스.
 *
 * 제공자는 완성된 프롬프트를 입력받아 설명형 답변 문자열을 반환한다. 세율·세액을
 * 재계산하지 않으며, 계산 결과를 반환하거나 변경하지 않는다. 타임아웃/Circuit Breaker
 * 제어는 상위(AiAdvisorAssist)에서 담당하므로 어댑터는 단순 위임 호출만 수행한다.
 */
export interface AiAdvisorProvider {
  /** 제공자 식별자 */
  readonly name: AiAdvisorProviderType;
  /**
   * 프롬프트를 위임 실행하여 설명형 답변을 생성한다.
   *
   * @param prompt - 질문과 계산 컨텍스트로 구성된 프롬프트
   * @returns 설명형 답변 문자열
   * @throws 호출 실패 시 오류를 던진다(상위에서 Circuit Breaker로 격리).
   */
  generate(prompt: string): Promise<string>;
}

/**
 * 로컬 Gemini 제공자 어댑터.
 *
 * 로컬 개발 환경에서 Gemini(gemini-3.6-flash)를 직접 호출한다. 기존 로컬 서버
 * (`src/local-server/server.ts`)의 Gemini 호출 방식을 따른다.
 */
export class LocalGeminiProvider implements AiAdvisorProvider {
  public readonly name: AiAdvisorProviderType = 'local';
  private readonly apiKey: string;
  private readonly model: string;

  /**
   * @param apiKey - Gemini API 키 (미지정 시 GEMINI_API_KEY 환경변수 사용)
   * @param model - 사용 모델 (기본 gemini-3.6-flash)
   */
  constructor(apiKey?: string, model = 'gemini-3.6-flash') {
    this.apiKey = apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.model = model;
  }

  /**
   * Gemini API를 호출하여 설명형 답변을 생성한다.
   *
   * @param prompt - 완성된 프롬프트
   * @returns 설명형 답변 문자열
   */
  async generate(prompt: string): Promise<string> {
    if (!this.apiKey || this.apiKey === 'YOUR_API_KEY_HERE') {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      system_instruction: { parts: [{ text: AI_ADVISOR_SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Gemini API 호출 실패: ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) {
      throw new Error('Gemini API: 응답 후보가 없습니다.');
    }
    return answer;
  }
}

/**
 * 배포 세무 자문 서비스 위임 제공자 어댑터.
 *
 * 배포 환경에서 기존 세무 자문 서비스(real-estate-tax-ai-advisor)에 위임 호출한다.
 * 실제 호출 세부 구현(엔드포인트/인증 등)은 배포 시점에 주입하는 delegate 함수로 분리하며,
 * delegate 미주입 시에는 위임 대상 미구성으로 실패한다(상위 폴백으로 안내).
 */
export class TaxServiceProvider implements AiAdvisorProvider {
  public readonly name: AiAdvisorProviderType = 'tax-service';
  private readonly delegate?: (prompt: string) => Promise<string>;

  /**
   * @param delegate - 세무 자문 서비스 위임 호출 함수 (배포 시 주입)
   */
  constructor(delegate?: (prompt: string) => Promise<string>) {
    this.delegate = delegate;
  }

  /**
   * 세무 자문 서비스에 위임하여 설명형 답변을 생성한다.
   *
   * @param prompt - 완성된 프롬프트
   * @returns 설명형 답변 문자열
   */
  async generate(prompt: string): Promise<string> {
    if (!this.delegate) {
      throw new Error(
        '세무 자문 서비스 위임 대상이 구성되지 않았습니다. (real-estate-tax-ai-advisor)',
      );
    }
    return this.delegate(prompt);
  }
}

/**
 * AI 자문 보조 시스템 프롬프트.
 *
 * 세율·세액을 재계산하지 말고 설명·보완만 수행하며, 계산 결과를 응답에 포함하거나
 * 변경하지 않도록 지시한다. 면책 고지·범위 안내 규칙을 포함한다.
 */
export const AI_ADVISOR_SYSTEM_PROMPT = `당신은 대한민국 부동산 취득·양도·중개보수 및 관련 세무 계산을 보조하는 설명 전문 AI입니다.

## 역할
- 사용자에게 이미 산출된 결정론적 계산 결과(총액, 항목별 내역, 적용 세율/요율, 과세표준)를 근거로 설명과 보완 안내만 수행합니다.
- 장기임대사업자 감면 요건, 사후관리 요건에 따른 추징 조건 등 기준표에 세분화되지 않은 복잡한 감면·예외 사항을 설명형으로 안내합니다.

## 엄격한 금지 사항
- 세율·세액을 절대 재계산하지 마세요. 새로운 금액이나 세율을 산출하거나 제시하지 마세요.
- 제공된 계산 결과 수치(총액·항목 금액·세율)를 변경하거나 다른 값으로 대체하지 마세요.
- 계산 결과 자체를 다시 나열하기보다는 그 의미와 배경, 예외·감면 사항을 설명하세요.

## 답변 규칙
- 반드시 한국어 존댓말로 답변하세요.
- 부동산 취득·양도·중개보수 및 관련 세무 범위의 질문에만 답변하세요.`;

/**
 * AI 자문 보조 옵션.
 */
export interface AiAdvisorAssistOptions {
  /** 제공자 종류 (미지정 시 AI_ADVISOR_PROVIDER 환경변수, 기본 local) */
  provider?: AiAdvisorProviderType;
  /** 제공자 어댑터 직접 주입 (테스트/배포용, 지정 시 provider보다 우선) */
  providerAdapter?: AiAdvisorProvider;
  /** 세무 자문 서비스 위임 함수 (provider가 tax-service일 때 사용) */
  taxServiceDelegate?: (prompt: string) => Promise<string>;
  /** 호출 타임아웃 (밀리초, 기본 30000) */
  timeoutMs?: number;
  /** Circuit Breaker 설정 */
  circuitBreakerConfig?: CircuitBreakerConfig;
  /** Circuit Breaker 인스턴스 직접 주입 (미지정 시 내부 생성) */
  circuitBreaker?: CircuitBreaker;
}

/**
 * 계산기 유형별 자문 범위 키워드.
 *
 * 질문 범위 판정(요구사항 10.7)에 사용한다.
 */
const SCOPE_KEYWORDS: readonly string[] = [
  // 취득
  '취득', '취득세', '매입', '구입', '살 때',
  // 양도
  '양도', '양도세', '양도소득세', '매도', '매각', '팔 때', '양도차익',
  '장기보유', '비과세',
  // 중개보수
  '중개', '중개보수', '중개수수료', '복비', '공인중개사', '요율',
  // 관련 세무 일반
  '세금', '세액', '세율', '과세', '과세표준', '공제', '감면', '추징',
  '사후관리', '임대사업자', '조정대상지역', '주택', '부동산', '지방교육세',
  '농어촌특별세', '인지세',
];

/**
 * AI 자문 보조기 클래스.
 *
 * 계산 결과와 분리된 별도 설명 채널로 동작한다. 범위 판정 → 프롬프트 구성 → 제공자 위임
 * (Circuit Breaker + 30초 타임아웃) → 면책 고지 부착 순으로 처리하며, 어떤 경로에서도
 * 계산 결과를 응답에 포함하거나 변경하지 않는다.
 */
export class AiAdvisorAssist {
  private readonly provider: AiAdvisorProvider;
  private readonly timeoutMs: number;
  private readonly breaker: CircuitBreaker;

  /**
   * @param options - AI 자문 보조 옵션 (제공자·타임아웃·Circuit Breaker)
   */
  constructor(options: AiAdvisorAssistOptions = {}) {
    this.provider = this.resolveProvider(options);
    this.timeoutMs = options.timeoutMs ?? AI_ADVISOR_TIMEOUT_MS;
    this.breaker =
      options.circuitBreaker ??
      new CircuitBreaker(
        options.circuitBreakerConfig ?? AI_ADVISOR_CIRCUIT_BREAKER_CONFIG,
      );
  }

  /**
   * 옵션과 환경변수(AI_ADVISOR_PROVIDER)로 제공자 어댑터를 결정한다.
   *
   * @param options - AI 자문 보조 옵션
   * @returns 제공자 어댑터
   */
  private resolveProvider(options: AiAdvisorAssistOptions): AiAdvisorProvider {
    if (options.providerAdapter) {
      return options.providerAdapter;
    }
    const providerType: AiAdvisorProviderType =
      options.provider ??
      (process.env.AI_ADVISOR_PROVIDER as AiAdvisorProviderType | undefined) ??
      'local';

    if (providerType === 'tax-service') {
      return new TaxServiceProvider(options.taxServiceDelegate);
    }
    return new LocalGeminiProvider();
  }

  /**
   * 질문에 대한 AI 자문 보조 응답을 생성한다.
   *
   * 계산 결과는 응답에 포함하지 않고 절대 변경하지 않는다. 범위 외 질문은
   * `isOutOfScope=true`로 자문 범위를 안내하고, 호출 실패/타임아웃 시
   * `isAvailable=false`로 안내한다. 모든 응답은 면책 고지를 포함한다.
   *
   * @param input - AI 자문 보조 입력 (질문 + 계산 컨텍스트)
   * @returns AI 자문 보조 출력 (계산 결과 미포함)
   */
  async assist(input: AiAssistInput): Promise<AiAssistOutput> {
    // 범위 판정 (요구사항 10.7)
    if (this.isOutOfScope(input.question)) {
      return {
        answer: AI_ADVISOR_OUT_OF_SCOPE_MESSAGE,
        isOutOfScope: true,
        isAvailable: true,
        disclaimer: AI_ADVISOR_DISCLAIMER,
      };
    }

    // 프롬프트 구성 (요구사항 10.2) — 입력 조건·계산 결과 컨텍스트 포함
    const prompt = this.buildPrompt(input);

    try {
      // 제공자 위임: Circuit Breaker + 30초 타임아웃 (요구사항 10.3, 10.8, 10.10)
      const answer = await this.breaker.execute(() =>
        this.withTimeout(this.provider.generate(prompt), this.timeoutMs),
      );

      return {
        answer,
        isOutOfScope: false,
        isAvailable: true,
        disclaimer: AI_ADVISOR_DISCLAIMER,
      };
    } catch {
      // 실패/타임아웃 시 AI 일시 불가 안내, 계산 결과는 그대로 유지 (요구사항 10.8)
      return {
        answer: AI_ADVISOR_UNAVAILABLE_MESSAGE,
        isOutOfScope: false,
        isAvailable: false,
        disclaimer: AI_ADVISOR_DISCLAIMER,
      };
    }
  }

  /**
   * 질문이 부동산 취득·양도·중개보수 및 관련 세무 범위를 벗어나는지 판정한다.
   *
   * 계산기 유형은 항상 범위 내이므로, 계산기 유형별 대표 키워드와 공통 세무 키워드가
   * 하나도 포함되지 않으면 범위 외로 판정한다.
   *
   * @param question - 사용자 질문
   * @returns 범위 외 여부
   */
  private isOutOfScope(question: string): boolean {
    const normalized = question.trim().toLowerCase();
    if (normalized.length === 0) {
      return true;
    }
    return !SCOPE_KEYWORDS.some((keyword) =>
      normalized.includes(keyword.toLowerCase()),
    );
  }

  /**
   * 질문과 계산 컨텍스트(입력 조건·적용 세율/요율·과세표준·항목별 내역·총액)로
   * 프롬프트를 구성한다 (요구사항 10.2).
   *
   * 계산 결과는 설명 근거로만 프롬프트에 포함하며, 응답 출력에는 포함하지 않는다.
   *
   * @param input - AI 자문 보조 입력
   * @returns 완성된 프롬프트 문자열
   */
  private buildPrompt(input: AiAssistInput): string {
    const { calculatorType, question, calculationContext } = input;
    const ctx = this.formatContext(calculatorType, calculationContext);
    return [
      `[계산기 유형] ${this.calculatorTypeLabel(calculatorType)}`,
      '',
      '[현재 계산 컨텍스트]',
      ctx,
      '',
      '[사용자 질문]',
      question,
      '',
      '위 계산 결과는 이미 확정된 값입니다. 세율·세액을 재계산하지 말고, 질문에 대한 설명과 보완 안내만 제공하세요.',
    ].join('\n');
  }

  /**
   * 계산 컨텍스트를 프롬프트용 텍스트로 직렬화한다.
   *
   * 입력 조건, 총액, 항목별 내역, 적용 세율/요율, 과세표준(해당 시)을 포함한다.
   *
   * @param calculatorType - 계산기 유형
   * @param context - 계산 컨텍스트
   * @returns 직렬화된 컨텍스트 텍스트
   */
  private formatContext(
    _calculatorType: CalculatorType,
    context: AiCalculationContext,
  ): string {
    const { inputs, result } = context;

    const inputLines = Object.entries(inputs)
      .map(([key, value]) => `  - ${key}: ${this.stringify(value)}`)
      .join('\n');

    const lineItemLines = result.lineItems
      .map(
        (item) =>
          `  - ${item.name}: ${item.amount.toLocaleString('ko-KR')}원 (근거: ${item.basis.formula})`,
      )
      .join('\n');

    const rateLines = Object.entries(result.appliedRates)
      .map(([key, rate]) => `  - ${key}: ${rate}`)
      .join('\n');

    const parts: string[] = [
      '입력 조건:',
      inputLines || '  - (없음)',
      `총액: ${result.total.toLocaleString('ko-KR')}원`,
      '항목별 내역:',
      lineItemLines || '  - (없음)',
      '적용 세율/요율:',
      rateLines || '  - (없음)',
    ];

    if (typeof result.taxBase === 'number') {
      parts.push(`과세표준: ${result.taxBase.toLocaleString('ko-KR')}원`);
    }

    return parts.join('\n');
  }

  /**
   * 값을 프롬프트용 문자열로 안전하게 변환한다.
   *
   * @param value - 임의 값
   * @returns 문자열
   */
  private stringify(value: unknown): string {
    if (value === null || value === undefined) {
      return '(없음)';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  /**
   * 계산기 유형의 한국어 표시명을 반환한다.
   *
   * @param calculatorType - 계산기 유형
   * @returns 표시명
   */
  private calculatorTypeLabel(calculatorType: CalculatorType): string {
    switch (calculatorType) {
      case 'acquisition':
        return '취득비용 계산';
      case 'transfer_tax':
        return '양도소득세 계산';
      case 'brokerage':
        return '중개수수료 계산';
      default:
        return '부동산 계산';
    }
  }

  /**
   * Promise에 타임아웃을 적용한다. 지정 시간 초과 시 거부한다 (요구사항 10.8).
   *
   * @template T - Promise 반환 타입
   * @param promise - 대상 Promise
   * @param timeoutMs - 타임아웃 (밀리초)
   * @returns 원본 결과 또는 타임아웃 시 거부
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`AI 자문 보조 호출이 ${timeoutMs}ms 내에 응답하지 않았습니다.`));
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
