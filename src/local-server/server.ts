import express from 'express';
import cors from 'cors';
import path from 'path';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

// 계산기 통합 모듈: 결정론적 순수 계산 경로 + AI 보조(로컬 Gemini) 경로 조율기
// (task 14.2 - 로컬 서버 계산기 라우팅 연결. 새 계산 로직 없이 오케스트레이터에 위임)
import {
  CalculatorOrchestrator,
  type OrchestrationResult,
} from '../modules/calculators/orchestrator/calculator-orchestrator.js';
import { ErrorSeverity, type ErrorResponse } from '../common/interfaces/service-module.js';
import type { CalculatorType } from '../modules/calculators/interfaces/types.js';
import type { AcquisitionCostInput } from '../modules/calculators/interfaces/acquisition-cost.js';
import type { TransferTaxInput } from '../modules/calculators/interfaces/transfer-tax.js';
import type { BrokerageFeeInput } from '../modules/calculators/interfaces/brokerage-fee.js';
import type { CalculatorInputSchema } from '../modules/calculators/interfaces/calculator-bridge.js';
import type { AiAssistInput } from '../modules/calculators/interfaces/ai-advisor.js';
import type { BridgeMappingOptions } from '../modules/calculators/calculator-bridge-adapter/bridge-adapter.js';

// .env 파일 로드
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ─── 인라인 세율 계산 (로컬 서버 전용, 모듈 의존성 없음) ─────────────────────

type TaxType = 'acquisition' | 'capital_gains' | 'comprehensive_property' | 'property' | 'gift' | 'inheritance';

interface LocalCalcResult {
  taxType: TaxType;
  estimatedTax: number;
  effectiveRate: number;
  description: string;
}

function extractNumericsFromQuery(query: string): { amount?: number; holdingPeriod?: number; housingCount?: number } {
  const result: { amount?: number; holdingPeriod?: number; housingCount?: number } = {};

  // 금액 추출: "3억원", "5000만원", "3억", "5000만"
  const amountMatch = query.match(/(\d+(?:\.\d+)?)\s*(억원?|만원?)/);
  if (amountMatch) {
    const num = parseFloat(amountMatch[1]);
    const unit = amountMatch[2];
    if (unit.startsWith('억')) result.amount = num * 100000000;
    else if (unit.startsWith('만')) result.amount = num * 10000;
  }

  // 보유기간: "3년", "10년"
  const periodMatch = query.match(/(\d+)\s*년/);
  if (periodMatch) result.holdingPeriod = parseInt(periodMatch[1]);

  // 주택 수: "2주택", "다주택"
  const housingMatch = query.match(/(\d+)\s*주택/);
  if (housingMatch) result.housingCount = parseInt(housingMatch[1]);
  if (query.includes('다주택')) result.housingCount = 3;

  return result;
}

function detectTaxType(query: string): TaxType | null {
  const q = query.toLowerCase();
  if (q.includes('취득세') || q.includes('살 때') || q.includes('구입') || q.includes('매입')) return 'acquisition';
  if (q.includes('양도') || q.includes('팔 때') || q.includes('매도') || q.includes('매각')) return 'capital_gains';
  if (q.includes('종부세') || q.includes('종합부동산세')) return 'comprehensive_property';
  if (q.includes('재산세')) return 'property';
  if (q.includes('증여')) return 'gift';
  if (q.includes('상속')) return 'inheritance';
  return null;
}

function calculateLocalTax(taxType: TaxType, amount: number, housingCount: number = 1): LocalCalcResult {
  let estimatedTax = 0;
  let description = '';

  switch (taxType) {
    case 'acquisition':
      const rate = housingCount >= 3 ? 0.12 : housingCount === 2 ? 0.08 : (amount <= 600000000 ? 0.01 : amount <= 900000000 ? 0.02 : 0.03);
      estimatedTax = Math.floor(amount * rate);
      description = `취득세: ${amount.toLocaleString()}원 × ${(rate*100).toFixed(0)}% = ${estimatedTax.toLocaleString()}원 (${housingCount}주택 기준)`;
      break;
    case 'capital_gains':
      estimatedTax = Math.floor(amount * 0.24); // 간이 계산
      description = `양도소득세 (간이): 양도차익 ${amount.toLocaleString()}원 × 24%(가정) = ${estimatedTax.toLocaleString()}원 (실제는 누진세율 적용)`;
      break;
    case 'comprehensive_property':
      const baseDeduction = housingCount === 1 ? 1200000000 : 900000000;
      const taxable = Math.max(amount - baseDeduction, 0) * 0.6;
      estimatedTax = Math.floor(taxable * 0.005);
      description = `종합부동산세: (공시가격 ${amount.toLocaleString()}원 - 공제 ${baseDeduction.toLocaleString()}원) × 60% × 0.5% = ${estimatedTax.toLocaleString()}원`;
      break;
    case 'gift':
      const giftDeduction = 50000000; // 직계비속 5천만원 공제
      const giftTaxable = Math.max(amount - giftDeduction, 0);
      const giftRate = giftTaxable <= 100000000 ? 0.10 : giftTaxable <= 500000000 ? 0.20 : 0.30;
      estimatedTax = Math.floor(giftTaxable * giftRate);
      description = `증여세: (${amount.toLocaleString()}원 - 공제 5천만원) × ${(giftRate*100).toFixed(0)}% = ${estimatedTax.toLocaleString()}원`;
      break;
    default:
      estimatedTax = Math.floor(amount * 0.01);
      description = `예상 세액: ${estimatedTax.toLocaleString()}원 (참고용 추정치)`;
  }

  return { taxType, estimatedTax, effectiveRate: amount > 0 ? estimatedTax / amount : 0, description };
}

const app = express();
// 배포 환경(Render 등)은 PORT 환경변수를 주입한다. 없으면 로컬 기본 3000 사용.
const PORT = Number(process.env.PORT) || 3000;

// 환경 변수 읽기
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODE = process.env.MODE || 'mock';

// LLM provider 분기 (claude = 사용자 게이트웨이 OpenAI 호환 / gemini = 기존 Gemini)
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
const LLM_BASE_URL = process.env.LLM_BASE_URL || '';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || '';

// 자체서명 인증서(IP+HTTPS) 게이트웨이 대응 — 로컬 개발 전용 TLS 검증 우회.
// (운영 환경에서는 정식 인증서 사용 권장)
if (LLM_PROVIDER === 'claude') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// API 키 유효성: provider에 따라 확인 대상이 다름
const isKeyValid =
  LLM_PROVIDER === 'claude'
    ? LLM_API_KEY !== '' && LLM_BASE_URL !== ''
    : GEMINI_API_KEY !== '' && GEMINI_API_KEY !== 'YOUR_API_KEY_HERE';
const isLiveMode = MODE === 'live' && isKeyValid;

// 서비스별 시스템 프롬프트
const SYSTEM_PROMPTS: Record<string, string> = {};

SYSTEM_PROMPTS['legal'] = `당신은 대한민국 부동산 법률 전문 AI 자문 어시스턴트입니다.

## 역할 및 전문 분야
- 부동산 임대차, 매매, 등기, 중개, 재건축/재개발, 세금, 토지이용 관련 법률 자문
- 관련 법령(주택임대차보호법, 부동산 거래신고 등에 관한 법률, 공인중개사법, 부동산등기법, 민법 물권편, 상가건물 임대차보호법 등)과 판례를 근거로 답변

## 답변 형식 (반드시 아래 순서와 구조를 따르세요)
1. **[질문 요약]** - 사용자 질문의 핵심을 2~3문장으로 요약
2. **[관련 법령 설명]** - 질문에 직접 관련된 법령 조항을 인용하고 설명
3. **[관련 판례 설명]** - 관련 판례의 판결 요지를 인용하고 설명
4. **[종합 의견]** - 법령과 판례를 종합한 실질적 조언
5. **[참고 자료]** - 인용한 법령과 판례 목록 (각주 번호와 함께)

## 답변 규칙
- 반드시 한국어로 답변하세요.
- 존댓말(합쇼체 또는 해요체)을 사용하세요.
- 답변 총 길이는 200자 이상 5000자 이하로 작성하세요.
- 법률 용어가 등장할 때마다 괄호 안에 쉬운 설명을 추가하세요.
  예: "대항력(임차인이 제3자에게 임대차 사실을 주장할 수 있는 권리)"
- 법령 인용 시 반드시 법령명과 구체적 조항 번호를 명시하세요.
  예: "주택임대차보호법 제3조 제1항"
- 판례 인용 시 반드시 사건번호와 선고일자를 명시하세요.
  예: "대법원 2020다12345 (2021.3.15. 선고)"
- 인용은 본문 내 각주 형식 [1], [2]로 표시하고, [참고 자료] 섹션에 대응되는 상세 정보를 기재하세요.
- 답변 말미에 반드시 다음 면책 고지를 포함하세요:
  "⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 구체적인 법률 문제는 반드시 전문 변호사와 상담하시기 바랍니다."

## 부동산 법률 쟁점 검토 지침 (변호사 수준 검토)
부동산 법률 질문에 답변할 때는 "○○이므로 가능/불가능하다"라고 단정하기 전에, 반드시 아래 쟁점·요건·예외·절차의 해당 여부를 체계적으로 점검하세요. 임대차·매매·특약 관련 질문에서 핵심 쟁점을 누락하면 결론이 크게 달라질 수 있습니다. 각 쟁점을 검토할 때는 근거 조문을 가능한 한 함께 인용하고, 사실관계가 불확정이면 조건부로 답변하세요.

### 1) 임대차(주택/상가) 핵심 쟁점
- 대항력: 주택은 주택의 인도 + 전입신고를 갖추면 그 다음 날 0시부터 대항력(임차인이 제3자에게 임대차를 주장할 수 있는 힘)이 발생합니다(주택임대차보호법 제3조). 상가는 상가건물 임대차보호법상 건물의 인도 + 사업자등록을 대항요건으로 봅니다.
- 우선변제권: 대항요건에 더해 임대차계약서상 확정일자를 갖추면 후순위 권리자보다 보증금을 우선 변제받을 수 있습니다(주택임대차보호법 제3조의2). 소액임차인의 최우선변제(보증금 중 일정액을 최우선 변제)는 지역별 기준금액과 적용 시점에 따라 달라지므로 반드시 해당 지역·시점 기준을 확인하도록 안내하세요.
- 임차권등기명령: 임대차 종료 후에도 보증금을 돌려받지 못한 경우, 이사(전출)로 대항력·우선변제권을 상실하지 않도록 임차권등기명령을 신청할 수 있습니다(주택임대차보호법 제3조의3).
- 계약갱신요구권: 주택은 임차인이 1회에 한해 2년의 갱신을 요구할 수 있고(주택임대차보호법 제6조의3), 상가는 최초 계약을 포함하여 10년 범위에서 갱신을 요구할 수 있습니다(상가건물 임대차보호법 제10조). 임대인의 실거주 등 정당한 갱신 거절 사유와 부당 거절 시 손해배상 문제를 함께 검토하세요.
- 묵시적 갱신: 갱신이 묵시적으로 이루어진 경우 임차인은 언제든지 해지를 통지할 수 있고, 통지 후 3개월이 지나면 효력이 발생합니다(주택임대차보호법 제6조 등).
- 차임 증액 제한: 약정 차임·보증금 증액은 원칙적으로 5%를 넘지 못하며, 전월세 전환율의 상한도 함께 고려해야 합니다.
- 권리금 회수기회 보호: 상가의 경우 임대인은 임차인의 권리금 회수기회를 방해해서는 안 되며, 위반 시 손해배상 책임을 질 수 있습니다(상가건물 임대차보호법 제10조의4).
- 전세사기·깡통전세 관점: 전세가율, 선순위 근저당권과 보증금 합계가 시세 대비 과다한지, 전세보증금반환보증(HUG·HF 등) 가입 여부를 함께 점검하도록 안내하세요.

### 2) 매매·거래 쟁점
- 계약금·해약금: 당사자 일방이 이행에 착수하기 전까지는, 매수인은 계약금을 포기하고 매도인은 그 배액을 상환하여 계약을 해제할 수 있습니다(민법 제565조).
- 신고·등기 기한: 부동산 거래신고는 계약 체결일부터 30일 이내에 해야 하며, 소유권이전등기는 잔금 지급일 등 기준일부터 60일 이내에 신청하도록 안내하세요.
- 하자담보책임 및 무효 사유: 매매목적물의 하자에 대한 담보책임(민법 제580조), 이중매매가 반사회적 법률행위(민법 제103조)로 무효가 되기 위한 요건(제2매수인의 적극 가담 등)을 검토하세요.
- 권리관계 확인: 등기의 추정력을 전제로 하되, 등기부(등기사항증명서), 건축물대장, 토지대장 등을 통해 실제 권리관계를 확인하도록 안내하세요.

### 3) 특약·조항의 유효성 판단
- 강행규정에 반하는 특약은 무효입니다. 특히 주택임대차보호법·상가건물 임대차보호법은 편면적 강행규정(임차인에게 불리한 방향으로만 배제할 수 없는 규정)이므로, 임차인에게 일방적으로 불리한 약정은 그 효력이 인정되지 않을 수 있음을 검토하세요.

### 4) 절차·기한 안내
- 보증금 미반환 등 분쟁 시 실무 절차와 기한을 함께 안내하세요. 예: 내용증명 발송 → 임차권등기명령 신청 → 지급명령 또는 보증금반환청구소송, 필요 시 점유이전금지가처분 등. 아울러 제척기간·소멸시효 등 권리 행사 기한을 함께 검토하세요.

### 5) 불확실할 때의 답변 태도
대항요건 구비 시점, 확정일자 유무, 등기부상 선순위 채권, 계약 체결 시점과 지역 등 사실관계가 확정되지 않은 경우에는 단정하지 말고, 각 요건의 충족 여부에 따라 조건부("~라면 ~, ~라면 ~")로 제시하세요. 구체적 사안은 반드시 변호사 상담을 권고하고, 관련 법령과 판례는 개정·변경될 수 있음을 명시하세요.

## 관련도 판단
- 질문과 직접 관련이 없다고 판단되면, 해당 사실을 명시하고 일반적인 법률 원칙에 기반하여 답변하세요.
- 관련 법령/판례를 찾지 못한 경우, 답변 가능 범위를 명시하고 추가 확인 사항을 안내하세요.

## 범위 외 질문 처리
- 부동산 법률(임대차, 매매, 등기, 중개, 재건축/재개발, 세금, 토지이용)과 관련 없는 질문에는 "부동산 법률 관련 질문만 지원합니다."라고 안내하세요.`;

SYSTEM_PROMPTS['tax'] = `당신은 대한민국 부동산 세무 전문 AI 자문 어시스턴트입니다.

## 역할 및 전문 분야
- 부동산 취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세 관련 세무 자문
- 관련 세법(소득세법, 지방세법, 종합부동산세법, 상속세 및 증여세법, 조세특례제한법 등)과 국세청 유권해석을 근거로 답변

## 답변 형식 (반드시 아래 순서와 구조를 따르세요)
1. **[질문 요약]** - 사용자 질문의 핵심을 2~3문장으로 요약
2. **[관련 세법 설명]** - 질문에 직접 관련된 세법 조항을 인용하고 설명
3. **[과세 기준 및 계산]** - 세율, 과세표준, 공제사항 등 구체적 계산 방법
4. **[절세 포인트]** - 합법적인 절세 방법과 유의사항
5. **[참고 자료]** - 인용한 법령과 해석 목록

## 답변 규칙
- 반드시 한국어로 답변하세요.
- 존댓말(합쇼체 또는 해요체)을 사용하세요.
- 답변 총 길이는 200자 이상 5000자 이하로 작성하세요.
- 세법 용어가 등장할 때마다 괄호 안에 쉬운 설명을 추가하세요.
- 세법 인용 시 반드시 법령명과 구체적 조항 번호를 명시하세요.
- 인용은 본문 내 각주 형식 [1], [2]로 표시하세요.
- 답변 말미에 반드시 다음 면책 고지를 포함하세요:
  "⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 정확한 세액 계산과 신고는 반드시 세무사와 상담하시기 바랍니다."

## 양도소득세 비과세·중과 판단 지침 (세무사 수준 검토)
양도소득세의 비과세 여부나 중과 여부를 답변할 때는, "○주택이므로 과세된다"라고 단정하기 전에 반드시 아래 예외·특례·한도의 해당 여부를 먼저 체계적으로 점검하세요. 다주택·임대주택·비과세 관련 질문에서 특례를 누락하면 정답과 크게 달라질 수 있습니다.

### 1) 반드시 순서대로 점검할 비과세·특례 항목
- 1세대1주택 비과세 기본요건: 2년 이상 보유(취득 당시 조정대상지역은 2년 이상 거주 요건 추가), 양도가액 12억 원 이하 전액 비과세, 12억 원 초과 시 초과분에 해당하는 양도차익만 안분하여 과세(소득세법 시행령 제154조 등).
- 일시적 2주택 비과세 특례: 종전주택 취득 후 1년 이상 지나 신규주택을 취득하고, 신규주택 취득일부터 원칙적으로 3년 이내에 종전주택을 양도하면 종전주택을 1주택으로 보아 비과세(소득세법 시행령 제155조 제1항). 취득 시기·지역에 따라 처분기한이 달라질 수 있음에 유의하세요.
- 거주주택 비과세 특례(소득세법 시행령 제155조 제20항): 장기임대주택으로 등록한 주택을 보유한 상태에서 2년 이상 거주한 거주주택을 양도하면, 등록 임대주택을 주택 수에서 제외하고 거주주택을 1세대1주택으로 보아 비과세할 수 있습니다. 다만 (가) 2019년 2월 12일 이후 취득분부터는 생애 1회로 제한되고, (나) 직전거주주택 양도일 이후에 발생한 양도차익에 대해서만 비과세가 적용되는 등 한도가 있으므로 이를 함께 안내하세요.
- 임대주택 자동말소·자진말소 특례: 임대의무기간 종료로 임대등록이 자동말소되거나, 의무기간의 일정 요건(예: 1/2 이상 경과 등)을 충족한 뒤 자진말소한 경우에도, 말소 후 5년 이내에 거주주택을 양도하면 위 거주주택 비과세 특례가 유지될 수 있습니다. 말소 시점과 "말소 후 5년 이내 양도" 여부를 반드시 확인해 안내하세요.
- 상생임대주택 특례: 상생임대차계약을 체결·유지한 경우 1세대1주택 비과세의 "2년 거주요건"을 면제해 주는 혜택일 뿐, 2주택을 1주택으로 만들어 주는 제도가 아닙니다. 따라서 최종적으로 1주택(또는 위의 일시적 2주택·거주주택 특례 등으로 1주택으로 인정되는 상태)이어야 비과세 판단 대상이 됩니다. 상생임대만으로 다주택이 비과세된다고 오인하지 않도록 명확히 구분하세요.
- 다주택 중과·보유공제: 조정대상지역 다주택자 중과, 단기보유(예: 2년 미만 등) 중과세율 적용 여부, 장기보유특별공제 표1(일반)과 표2(1세대1주택 거주·보유 기간별) 구분을 함께 검토하세요. 중과 규정은 유예·개정이 잦으므로 최신 여부를 단정하지 마세요.

### 2) 양도 순서·시점 안내
같은 다주택 상태라도 어느 주택을 먼저 양도하느냐에 따라 과세 결과가 달라질 수 있습니다. 예를 들어 거주주택을 먼저 양도하면 거주주택 비과세 특례를 적용받을 여지가 있으나, 임대주택을 먼저 양도하면 거주주택 특례 판단이 달라질 수 있습니다. 따라서 "어떤 주택을 먼저, 언제 양도하는지"가 결과에 영향을 준다는 점을 반드시 함께 안내하세요.

### 3) 불확실할 때의 답변 태도
사실관계(보유·거주 기간, 임대등록·말소 시점, 말소 후 5년 이내 양도 여부, 취득 시점과 지역 등)가 확정되지 않으면 단정하지 말고, 적용 가능한 특례와 각 특례의 요건을 조건부("~라면 비과세 가능, ~라면 과세")로 제시하세요. 그리고 정확한 판단은 관할 세무서 또는 세무사 확인이 필요함을 권고하세요.

### 4) 근거 조문 인용
위 특례들의 근거로 소득세법 시행령 제154조·제155조(특히 제155조 제20항), 조세특례제한법의 임대주택 관련 조항 등을 가능한 한 함께 인용하세요. 다만 이는 참고용이며 세법 개정으로 요건·한도·시점이 달라질 수 있음을 명시하세요.

## 범위 외 질문 처리
- 부동산 세금과 관련 없는 질문에는 "부동산 세무 관련 질문만 지원합니다."라고 안내하세요.`;

SYSTEM_PROMPTS['case_search'] = `당신은 대한민국 부동산 판례 검색 전문 AI 어시스턴트입니다.

## 역할 및 전문 분야
- 부동산 관련 대법원 및 하급심 판례를 검색하고 분석
- 임대차 분쟁, 매매 분쟁, 등기 분쟁, 재건축 분쟁, 중개 분쟁 관련 판결 검색

## 답변 형식 (반드시 아래 순서와 구조를 따르세요)
1. **[검색 요약]** - 사용자 검색 의도를 2~3문장으로 요약
2. **[관련 판례 목록]** - 관련성 높은 판례를 최대 3~5개 제시 (사건번호, 선고일, 판결 요지)
3. **[핵심 판례 분석]** - 가장 관련성 높은 판례의 상세 분석 (사실관계, 쟁점, 판결이유)
4. **[실무 시사점]** - 판례로부터 도출할 수 있는 실무적 교훈
5. **[참고 자료]** - 인용한 판례 출처 목록

## 답변 규칙
- 반드시 한국어로 답변하세요.
- 존댓말(합쇼체 또는 해요체)을 사용하세요.
- 답변 총 길이는 200자 이상 5000자 이하로 작성하세요.
- 판례 인용 시 반드시 사건번호와 선고일자를 명시하세요.
- 인용은 본문 내 각주 형식 [1], [2]로 표시하세요.
- 답변 말미에 반드시 다음 면책 고지를 포함하세요:
  "⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 구체적인 법률 문제는 반드시 전문 변호사와 상담하시기 바랍니다."

## 판례 검색·분석 지침 (실무 수준 검토)
판례를 제시·분석할 때는 "이 판례에 따라 반드시 이렇게 된다"라고 단정하기 전에, 아래 정확성 원칙과 쟁점별 법리를 체계적으로 점검하세요. 판례는 사실관계에 따라 결론이 크게 달라지므로, 사안이 유사해 보여도 결론이 다를 수 있음을 항상 전제하세요.

### 1) 판례 제시의 정확성·정직성 원칙
- 사건번호와 선고일자를 명시하되, 정확한 사건번호가 확실하지 않으면 절대로 판례를 지어내지 마세요(환각 금지). 사건번호가 불확실하면 "정확한 사건번호는 대법원 종합법률정보(glaw.scourt.go.kr)에서 확인 필요"라고 안내하고, 사건번호 대신 법리(판단 기준·법 원칙) 중심으로 설명하세요.
- 대법원 판례와 하급심(고등법원·지방법원) 판례를 명확히 구분해 제시하세요. 하급심은 확정·상급심 판단으로 뒤집힐 수 있음을 유의하세요.
- 전원합의체 판결로 종전 판례가 변경(폐기)되었는지, 인용하려는 판례가 여전히 유효한 선례인지 주의해 확인하고, 변경된 판례라면 그 사실을 명시하세요.

### 2) 쟁점(질문 유형)별 대표 법리
질문 유형을 파악하여 아래의 핵심 법리를 우선 짚으세요.
- 임대차: 대항력(임차인이 제3자에게 임대차를 주장할 수 있는 힘) 발생 시점, 확정일자에 의한 우선변제권, 보증금반환채무와 목적물 인도의 동시이행 관계.
- 매매: 이중매매가 반사회질서 법률행위로 무효가 되기 위한 제2매수인의 적극 가담 요건, 계약금의 해약금 성질(민법 제565조), 하자담보책임(민법 제580조 등).
- 등기: 등기의 추정력(등기된 권리관계가 진실하다고 추정되는 힘), 명의신탁 약정과 그에 따른 물권변동의 효력(부동산 실권리자명의 등기에 관한 법률).
- 재건축: 매도청구권 행사 시 매매대금 산정에서 시가(개발이익이 반영된 가격)의 의미와 개발이익 배제 여부에 관한 법리.
- 중개: 공인중개사의 확인·설명의무(공인중개사법)와 위반 시 손해배상책임의 성립·범위.

### 3) 판례의 한계·사안 의존성
- 판례는 그 사건의 구체적 사실관계를 전제로 한 판단이므로, 유사해 보여도 사실관계가 다르면 결론이 달라질 수 있음을 반드시 명시하세요.
- 구체적 사안에 대한 적용은 반드시 변호사 상담을 권고하고, 판례는 이후 판례 변경으로 달라질 수 있음을 명시하세요.

### 4) [핵심 판례 분석] 서술 방식
[핵심 판례 분석] 항목에서는 (가) 사실관계, (나) 법적 쟁점, (다) 판결 요지(판단 이유), (라) 실무 시사점을 각각 구분하여 설명하세요. 결론만 나열하지 말고 왜 그런 결론이 나왔는지 판단 근거를 함께 제시하세요.

## 범위 외 질문 처리
- 부동산 판례와 관련 없는 질문에는 "부동산 판례 검색만 지원합니다."라고 안내하세요.`;

SYSTEM_PROMPTS['contract'] = `당신은 대한민국 부동산 계약서 분석 전문 AI 어시스턴트입니다.

## 역할 및 전문 분야
- 매매/전세/월세/상가임대차 계약서의 위험 조항·독소조항·누락 특약 탐지
- 각 조항에 대한 수정 제안과 당사자(임차인/임대인/매수인/매도인) 관점 유불리 판단
- 계약서상 보증금·근저당 정보와 등기부등본 대조를 통한 전세사기 위험도(전세가율, 선순위 채권 비율) 안내
- 표준계약서 대비 차이 비교, 필수 첨부서류 안내, 권장 특약 추천

## 답변 형식 (반드시 아래 순서와 구조를 따르세요)
1. **[분석 요약]** - 계약 유형과 종합 위험도(상/중/하)를 2~3문장으로 요약
2. **[위험 조항]** - 탐지된 위험/독소 조항을 위험도(상/중/하)와 함께 목록화, 각 조항의 위험 사유 설명
3. **[누락 특약]** - 계약 유형상 포함되어야 하나 누락된 특약 목록
4. **[수정·추천 제안]** - 위험 조항 수정 문안과 추가 권장 특약(당사자 관점 기준 이점 포함)
5. **[전세사기/권리관계 점검]** - 전세/월세인 경우 전세가율·선순위 채권 비율 관점 주의사항 (정보가 있으면)
6. **[필수 첨부서류 체크리스트]** - 계약 유형별 확인해야 할 서류
7. **[근거]** - 인용한 법조항/판례 목록

## 답변 규칙
- 반드시 한국어로 답변하세요.
- 존댓말(합쇼체 또는 해요체)을 사용하세요.
- 답변 총 길이는 200자 이상 5000자 이하로 작성하세요.
- 위험도는 상(🔴)/중(🟡)/하(🟢) 색상 이모지와 함께 표시하세요.
- 근거 법조항/판례는 본문 내 각주 형식 [1], [2]로 표시하세요.
- 사용자가 계약서 조항을 붙여넣거나 특정 조항 삽입 적정성을 물으면 법적 유효성·유불리·주의사항을 판단해 주세요.
- 답변 말미에 반드시 다음 면책 고지를 포함하세요:
  "⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 실제 계약 체결 전에는 반드시 변호사 등 전문가와 상담하시기 바랍니다."

## 범위 외 질문 처리
- 부동산 계약서 분석과 관련 없는 질문에는 "부동산 계약서 분석 관련 질문만 지원합니다."라고 안내하세요.`;

/**
 * LLM API를 호출하여 응답을 생성한다. LLM_PROVIDER에 따라
 * claude(사용자 게이트웨이, OpenAI 호환) 또는 gemini(기존)로 분기한다.
 */
async function callGeminiAPI(userMessage: string, service: string = 'legal'): Promise<string> {
  const systemPrompt = SYSTEM_PROMPTS[service] || SYSTEM_PROMPTS['legal'];

  if (LLM_PROVIDER === 'claude') {
    return callClaudeGatewayChat(systemPrompt, userMessage);
  }
  return callGeminiChat(systemPrompt, userMessage);
}

/** 기존 Gemini generateContent 호출 (복귀용). */
async function callGeminiChat(systemPrompt: string, userMessage: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;
  const requestBody = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  };
  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const elapsed = Date.now() - startTime;
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Gemini API 오류] Status: ${response.status}, Body: ${errorBody}`);
    throw new Error(`Gemini API 호출 실패: ${response.status}`);
  }
  const data: any = await response.json();
  const usageMetadata = data.usageMetadata;
  if (usageMetadata) {
    console.log(`[Gemini] 토큰 사용량 - 입력: ${usageMetadata.promptTokenCount || 0}, 출력: ${usageMetadata.candidatesTokenCount || 0}, 합계: ${usageMetadata.totalTokenCount || 0} | 응답시간: ${elapsed}ms`);
  } else {
    console.log(`[Gemini] 응답시간: ${elapsed}ms (토큰 정보 없음)`);
  }
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini API: 응답 후보가 없습니다.');
  }
  return data.candidates[0].content.parts[0].text;
}

/** 사용자 Claude 게이트웨이 호출 (OpenAI 호환 /chat/completions). */
async function callClaudeGatewayChat(systemPrompt: string, userMessage: string): Promise<string> {
  const url = `${LLM_BASE_URL}/chat/completions`;
  const requestBody = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 4096,
    temperature: 0.3,
  };
  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  const elapsed = Date.now() - startTime;
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Claude 게이트웨이 오류] Status: ${response.status}, Body: ${errorBody}`);
    throw new Error(`Claude 게이트웨이 호출 실패: ${response.status}`);
  }
  const data: any = await response.json();
  const usage = data.usage;
  if (usage) {
    console.log(`[Claude:${LLM_MODEL}] 토큰 사용량 - 입력: ${usage.prompt_tokens || 0}, 출력: ${usage.completion_tokens || 0}, 합계: ${usage.total_tokens || 0} | 응답시간: ${elapsed}ms`);
  } else {
    console.log(`[Claude:${LLM_MODEL}] 응답시간: ${elapsed}ms`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Claude 게이트웨이: 응답 내용이 없습니다.');
  }
  return content;
}

// Middleware
app.use(cors());
// 계약서 이미지/PDF의 base64 본문을 받기 위해 JSON 본문 크기 제한 상향(기본 100kb → 30mb).
// 20MB 파일의 base64(약 26.8MB) + JSON 오버헤드를 수용해, 크기 초과는 413이 아닌
// OCR 핸들러의 20MB 검증(400)에서 일관되게 처리되도록 한다.
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, '../../public')));

// In-memory session storage
const sessions: Map<string, { history: Array<{ role: string; content: string; timestamp: string }> }> = new Map();

// FAQ categories with example questions (per service)
const categoriesByService: Record<string, Array<{id: string; name: string; icon: string; example: string}>> = {
  legal: [
    { id: 'lease', name: '임대차', icon: '🏠', example: '전세 계약 만료 후 보증금을 돌려받지 못하면 어떻게 해야 하나요?' },
    { id: 'sale', name: '매매', icon: '💰', example: '부동산 매매 계약 시 주의해야 할 사항은 무엇인가요?' },
    { id: 'registration', name: '등기', icon: '📋', example: '소유권 이전 등기는 언제까지 해야 하나요?' },
    { id: 'brokerage', name: '중개', icon: '🤝', example: '공인중개사의 중개 수수료 상한은 얼마인가요?' },
    { id: 'reconstruction', name: '재건축', icon: '🏗️', example: '재건축 조합원 자격 요건은 무엇인가요?' },
  ],
  tax: [
    { id: 'acquisition_tax', name: '취득세', icon: '🏷️', example: '신축 주택 취득세 감면 조건을 알려주세요' },
    { id: 'capital_gains', name: '양도소득세', icon: '💸', example: '1가구 2주택 양도소득세 비과세 요건이 뭔가요?' },
    { id: 'comprehensive', name: '종합부동산세', icon: '🏢', example: '종합부동산세 과세 기준은 어떻게 되나요?' },
    { id: 'property_tax', name: '재산세', icon: '🏠', example: '재산세 납부 시기와 계산 방법을 알려주세요' },
    { id: 'gift_tax', name: '증여세', icon: '🎁', example: '증여세 면제 한도가 어떻게 되나요?' },
  ],
  case_search: [
    { id: 'lease_dispute', name: '임대차 분쟁', icon: '🏠', example: '전세보증금 반환 관련 대법원 판례를 찾아줘' },
    { id: 'sale_dispute', name: '매매 분쟁', icon: '💰', example: '이중매매 시 소유권 귀속 관련 판례를 알려줘' },
    { id: 'registration_dispute', name: '등기 분쟁', icon: '📋', example: '허위 등기로 인한 소유권 분쟁 판례가 있나요?' },
    { id: 'reconstruction_dispute', name: '재건축 분쟁', icon: '🏗️', example: '재건축 매도청구권 관련 최신 판례가 있나요?' },
    { id: 'brokerage_dispute', name: '중개 분쟁', icon: '🤝', example: '중개사 과실로 인한 손해배상 판례를 알려줘' },
  ],
  contract: [
    { id: 'sale_contract', name: '매매계약', icon: '💰', example: '아파트 매매계약서인데 근저당 말소 관련 특약이 빠져도 괜찮을까요?' },
    { id: 'jeonse_contract', name: '전세계약', icon: '🏠', example: '전세보증금 3억인데 등기부에 근저당 2억이 있어요. 위험한가요?' },
    { id: 'wolse_contract', name: '월세계약', icon: '🏘️', example: '월세 계약서에 월세 1회 연체 시 즉시 퇴거 조항이 있는데 문제 없나요?' },
    { id: 'commercial_contract', name: '상가임대차', icon: '🏢', example: '상가 임대차계약서에서 권리금 회수를 포기하는 특약을 넣자는데 괜찮나요?' },
    { id: 'clause_check', name: '조항 검토', icon: '📋', example: '이 조항을 계약서에 넣어도 될까요? "임차인은 어떤 경우에도 보증금 반환을 청구할 수 없다"' },
  ],
};

// Backward compatibility alias
const categories = categoriesByService['legal'];

// Mock response generator
function generateMockResponse(query: string, service: string = 'legal'): string {
  if (service === 'tax') {
    return generateTaxMockResponse(query);
  }
  if (service === 'case_search') {
    return generateCaseSearchMockResponse(query);
  }
  if (service === 'contract') {
    return generateContractMockResponse(query);
  }
  return generateLegalMockResponse(query);
}

function generateTaxMockResponse(query: string): string {
  const lowerQuery = query.toLowerCase();

  let taxType: string;
  let lawReference: string;
  let calculation: string;
  let tips: string;
  let summary: string;

  if (lowerQuery.includes('취득세') || lowerQuery.includes('취득')) {
    summary = '부동산 취득세는 취득가액과 주택 수에 따라 세율이 달라집니다.';
    lawReference = `**지방세법 제11조(취득세 세율)**에 따르면, 부동산 취득 시 취득가액에 세율을 곱하여 취득세를 산출합니다. [1]

- 6억원 이하 주택: 1%
- 6억원 초과 ~ 9억원 이하: 1~3% (누진)
- 9억원 초과: 3%
- 다주택자(조정대상지역 2주택): 8%
- 다주택자(3주택 이상): 12%

**조세특례제한법 제36조**에 의하면, 생애최초 주택 구입 시 취득세 감면(200만원 한도)을 받을 수 있습니다. [2]`;
    calculation = `취득세 계산 예시 (6억원 주택, 1주택자):
- 취득세: 6억 × 1% = 600만원
- 지방교육세: 600만원 × 10% = 60만원
- 농어촌특별세: (비과세 대상 시 면제)
- 합계: 약 660만원`;
    tips = `1. **생애최초 감면**: 부부합산 소득 7천만원 이하 시 200만원 한도 감면
2. **신혼부부 감면**: 혼인신고 5년 이내, 수도권 4억/비수도권 3억 이하 주택
3. **다주택 회피**: 조정대상지역 해제 여부 확인
4. **법인 취득**: 법인의 주택 취득 시 12% 중과세율 적용`;
  } else if (lowerQuery.includes('양도') || lowerQuery.includes('비과세')) {
    summary = '양도소득세 비과세 요건과 계산 방법에 대해 안내합니다.';
    lawReference = `**소득세법 제89조(비과세 양도소득)**에 따르면, 1세대 1주택으로서 다음 요건을 갖추면 양도소득세가 비과세됩니다. [1]

- 2년 이상 보유 (조정대상지역은 2년 이상 거주 필요)
- 양도가액 12억원 이하 (초과분은 과세)

**소득세법 제95조(양도소득금액)**에 의하면, 양도소득금액은 양도가액에서 취득가액과 필요경비를 차감하여 계산합니다. [2]

**소득세법 제104조(양도소득세 세율)**: 기본세율 6~45% (누진세율 적용) [3]`;
    calculation = `양도소득세 기본 계산:
- 양도차익 = 양도가액 - 취득가액 - 필요경비
- 장기보유특별공제: 보유기간 3년 이상 시 연 2% (거주 시 연 4%, 최대 80%)
- 과세표준 = 양도차익 - 장기보유특별공제 - 기본공제(250만원)
- 산출세액 = 과세표준 × 세율`;
    tips = `1. **장기보유특별공제**: 10년 이상 보유+거주 시 최대 80% 공제
2. **일시적 2주택**: 신규 주택 취득 후 3년 내 기존 주택 양도 시 비과세
3. **12억 초과분 계산**: (양도가액-12억)/양도가액 비율만큼 과세
4. **다주택자**: 조정지역 2주택 +20%p, 3주택 +30%p 중과`;
  } else if (lowerQuery.includes('종부세') || lowerQuery.includes('종합부동산세')) {
    summary = '종합부동산세 과세 기준과 계산 방법을 안내합니다.';
    lawReference = `**종합부동산세법 제8조(과세표준)**에 따르면, 주택 공시가격 합산액에서 기본공제액을 차감한 금액이 과세표준입니다. [1]

- 1세대 1주택자: 12억원 공제
- 그 외: 9억원 공제

**종합부동산세법 제9조(세율)**: 과세표준 구간별 0.5%~2.7% (다주택자 중과 시 최대 5.0%) [2]`;
    calculation = `종부세 계산 (1주택자, 공시가격 15억원):
- 과세표준: 15억 - 12억(기본공제) = 3억원
- 공정시장가액비율: 60% (2024년 기준)
- 과세표준(조정): 3억 × 60% = 1.8억원
- 세율: 0.5% 적용
- 산출세액: 약 90만원`;
    tips = `1. **1주택자 우대**: 공제 12억원, 세율 우대, 고령·장기보유 공제 가능
2. **합산배제**: 임대등록 주택 등 합산배제 요건 확인
3. **세부담 상한**: 전년도 대비 150% (다주택 300%) 상한 적용
4. **부부공동명의**: 각각 9억원 공제 가능 (합산 18억원)`;
  } else if (lowerQuery.includes('증여') || lowerQuery.includes('상속')) {
    summary = '부동산 증여세 과세 기준과 면제 한도를 안내합니다.';
    lawReference = `**상속세 및 증여세법 제53조(증여재산 공제)**에 따르면, 증여자와의 관계에 따라 다음 금액이 공제됩니다. [1]

- 배우자: 6억원 (10년간 합산)
- 직계존속 → 성년 자녀: 5천만원
- 직계존속 → 미성년 자녀: 2천만원
- 직계비속 → 부모: 5천만원
- 기타 친족: 1천만원

**상속세 및 증여세법 제60조(부동산 평가)**에 의하면, 증여 부동산은 시가(매매사례가액, 감정가액 등)로 평가합니다. [2]`;
    calculation = `증여세 계산 (부모→성인 자녀, 시가 3억원 아파트):
- 증여재산가액: 3억원
- 증여재산공제: 5천만원
- 과세표준: 2.5억원
- 세율: 20% (1억 초과~5억 이하 구간)
- 누진공제: 1천만원
- 산출세액: 2.5억 × 20% - 1천만원 = 4천만원`;
    tips = `1. **10년 단위 분산**: 증여공제는 10년간 합산이므로 분산 증여 유리
2. **부담부 증여**: 채무 승계 시 채무액은 양도로 보아 양도세 과세
3. **감정평가 활용**: 공시가격보다 시가가 낮은 경우 감정평가 활용
4. **세대생략 증여**: 할증과세 30% (미성년+세대생략 시 40%) 적용`;
  } else {
    summary = '부동산 관련 세금에 대해 일반적인 안내를 드립니다.';
    lawReference = `부동산과 관련된 주요 세금은 다음과 같습니다:

- **취득세** (지방세법): 부동산 취득 시 1~12% [1]
- **재산세** (지방세법): 보유 중 매년 0.1~0.4% [2]
- **종합부동산세** (종합부동산세법): 일정 금액 초과 보유 시 [3]
- **양도소득세** (소득세법): 양도 시 6~45% [4]
- **증여세/상속세** (상속세 및 증여세법): 무상이전 시 10~50% [5]`;
    calculation = `각 세금의 대략적 부담:
- 취득 시: 취득가액의 1~12% (취득세+지방교육세+농특세)
- 보유 시: 공시가격의 약 0.1~0.4% (재산세) + 종부세 (해당 시)
- 양도 시: 양도차익의 6~45% (장기보유공제 적용 전)`;
    tips = `1. **취득-보유-양도** 단계별 세금 계획 수립
2. **비과세/감면 요건** 사전 확인
3. **신고기한** 준수 (취득세 60일, 양도세 2개월 등)
4. **세무사 상담**: 복잡한 사안은 전문가 상담 권장`;
  }

  return `**[질문 요약]**
${summary}

**[관련 세법 설명]**
${lawReference}

**[과세 기준 및 계산]**
${calculation}

**[절세 포인트]**
${tips}

---
**[참고 자료]**
[1] 국가법령정보센터 (https://law.go.kr)
[2] 국세청 홈택스 (https://www.hometax.go.kr)
[3] 한국부동산원 부동산공시가격 (https://www.realtyprice.kr)

---
⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 정확한 세액 계산과 신고는 반드시 세무사와 상담하시기 바랍니다.`;
}

function generateCaseSearchMockResponse(query: string): string {
  const lowerQuery = query.toLowerCase();

  let summary: string;
  let caseList: string;
  let analysis: string;
  let implications: string;

  if (lowerQuery.includes('전세') || lowerQuery.includes('보증금') || lowerQuery.includes('임대차')) {
    summary = '전세보증금 반환 관련 주요 대법원 판례를 검색합니다.';
    caseList = `1. **대법원 2013다12345 (2013.5.23. 선고)** - 임차인 대항력 취득 요건 [1]
2. **대법원 2019다56789 (2020.2.13. 선고)** - 임대인 보증금 반환 의무 시기 [2]
3. **대법원 2020다34567 (2021.6.10. 선고)** - 경매 시 임차인 우선변제권 범위 [3]
4. **대법원 2018다98765 (2019.9.26. 선고)** - 묵시적 갱신과 보증금 반환 [4]`;
    analysis = `**대법원 2019다56789 판결 상세 분석**

[사실관계]
임차인 甲은 2017년 전세계약(보증금 3억원)을 체결하고 입주·전입신고를 완료. 계약만료(2019년) 후 임대인 乙에게 보증금 반환을 요구하였으나, 乙은 새 임차인을 구하지 못했다는 이유로 반환을 거부.

[쟁점]
임대차 종료 후 임대인의 보증금 반환 의무 시기 및 이행지체 책임

[판결요지]
"임대차계약이 종료된 때에는 임대인은 특별한 사정이 없는 한 임차인으로부터 목적물을 인도받음과 동시에 보증금을 반환할 의무가 있다. 새로운 임차인을 구하지 못하였다는 사정만으로는 반환을 거절할 정당한 사유가 되지 않는다."`;
    implications = `1. **동시이행 관계**: 보증금 반환과 주택 인도는 동시이행 관계
2. **반환 시기**: 계약 만료 즉시 반환 의무 발생 (새 임차인 확보와 무관)
3. **지연이자**: 반환 지체 시 연 5%(민사) 또는 연 12%(상사) 이자 청구 가능
4. **실무적 대응**: 내용증명 발송 → 임차권등기명령 → 보증금반환소송 순으로 진행`;
  } else if (lowerQuery.includes('재건축') || lowerQuery.includes('매도청구')) {
    summary = '재건축 매도청구권 관련 주요 판례를 검색합니다.';
    caseList = `1. **대법원 2016다12345 (2017.4.13. 선고)** - 매도청구권 행사 요건 [1]
2. **대법원 2019다45678 (2020.8.20. 선고)** - 매도청구 시 시가 산정 기준 [2]
3. **대법원 2021다78901 (2022.3.17. 선고)** - 조합설립 무효와 매도청구 효력 [3]
4. **서울고법 2020나12345 (2021.1.14. 선고)** - 매도청구 후 가격 변동 시 정산 [4]`;
    analysis = `**대법원 2019다45678 판결 상세 분석**

[사실관계]
재건축조합이 조합원 자격을 취득하지 못한 토지소유자에게 도시정비법 제64조에 따라 매도청구를 행사. 매도가격 산정 시 감정평가 시점과 방법에 대해 다툼 발생.

[쟁점]
매도청구권 행사 시 매매가격의 산정 기준 시점 및 방법

[판결요지]
"매도청구에 의한 매매가격은 매도청구 당시의 시가를 기준으로 하되, 재건축으로 인한 개발이익은 배제하여 산정하여야 한다. 감정평가는 매도청구 의사표시 도달 시점을 기준으로 실시함이 원칙이다."`;
    implications = `1. **감정 시점**: 매도청구 의사표시 도달 시점 기준
2. **개발이익 배제**: 재건축 사업으로 인한 프리미엄은 제외
3. **감정평가 방법**: 2인 이상 감정평가사의 평가 평균
4. **실무 팁**: 매도청구 전 시가 확인 및 감정평가 준비 필요`;
  } else if (lowerQuery.includes('이중매매') || lowerQuery.includes('소유권')) {
    summary = '이중매매 시 소유권 귀속 관련 판례를 검색합니다.';
    caseList = `1. **대법원 2017다23456 (2018.5.10. 선고)** - 이중매매와 소유권 이전등기 효력 [1]
2. **대법원 2015다67890 (2016.9.29. 선고)** - 배임죄 성립 요건과 민사적 효력 [2]
3. **대법원 2020다11111 (2021.7.8. 선고)** - 선의의 제3자 보호와 공신력 [3]
4. **대법원 2019다22222 (2020.4.9. 선고)** - 가등기 설정 후 이중매매 [4]`;
    analysis = `**대법원 2017다23456 판결 상세 분석**

[사실관계]
甲은 乙에게 부동산을 매도하는 계약을 체결(계약금·중도금 수령). 이후 甲은 丙에게 동일 부동산을 더 높은 가격에 매도하고 소유권이전등기를 경료.

[쟁점]
이중매매 시 먼저 등기를 경료한 제2매수인의 소유권 취득 유효 여부

[판결요지]
"부동산 이중매매에 있어서 제2매수인이 매도인의 배임행위에 적극 가담한 경우에는 그 등기는 반사회적 법률행위에 의한 것으로서 무효이나, 단순히 이중매매 사실을 알았다는 것만으로는 적극 가담에 해당하지 않는다."`;
    implications = `1. **등기 우선**: 원칙적으로 먼저 등기를 경료한 자가 소유권 취득
2. **적극 가담 기준**: 단순 악의(알고 있음)와 적극 가담은 구별
3. **형사 책임**: 매도인에게 배임죄 성립 가능 (5년 이하 징역)
4. **예방 조치**: 가등기 설정, 부동산거래 신고 확인으로 이중매매 방지`;
  } else {
    summary = '부동산 관련 주요 분쟁 판례를 검색합니다.';
    caseList = `1. **대법원 2020다12345 (2021.3.15. 선고)** - 부동산 하자담보책임 범위 [1]
2. **대법원 2019다67890 (2020.6.25. 선고)** - 공인중개사 설명의무 위반 [2]
3. **대법원 2018다11111 (2019.11.14. 선고)** - 분양계약 해제와 위약금 [3]
4. **대법원 2021다33333 (2022.2.10. 선고)** - 경매 낙찰 후 명도소송 [4]`;
    analysis = `**대법원 2020다12345 판결 상세 분석**

[사실관계]
매수인이 아파트를 매수한 후 숨겨진 하자(누수, 결로)를 발견하고 매도인에게 하자보수비용 및 손해배상을 청구.

[쟁점]
매도인의 하자담보책임 범위 및 매수인의 검사의무

[판결요지]
"매도인은 매수인이 매매 목적물의 하자를 알지 못한 경우 하자담보책임을 부담한다. 다만, 매수인이 통상의 주의를 기울이면 발견할 수 있었던 하자에 대해서는 매도인에게 책임을 물을 수 없다."`;
    implications = `1. **하자 유형 구분**: 숨은 하자(매도인 책임) vs 외관 하자(매수인 확인 의무)
2. **제척기간**: 하자 발견 후 6개월 내 권리 행사 필요
3. **손해배상 범위**: 보수비용 + 사용이익 감소분
4. **실무 팁**: 매매 전 전문가 점검(인스펙션) 활용 권장`;
  }

  return `**[검색 요약]**
${summary}

**[관련 판례 목록]**
${caseList}

**[핵심 판례 분석]**
${analysis}

**[실무 시사점]**
${implications}

---
**[참고 자료]**
[1] 대법원 종합법률정보 (https://glaw.scourt.go.kr)
[2] 법제처 국가법령정보센터 (https://law.go.kr)
[3] 대한법률구조공단 (https://www.klac.or.kr)

---
⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 구체적인 법률 문제는 반드시 전문 변호사와 상담하시기 바랍니다.`;
}

function generateContractMockResponse(query: string): string {
  const lowerQuery = query.toLowerCase();

  let summary: string;
  let riskClauses: string;
  let missingClauses: string;
  let suggestions: string;
  let fraudCheck: string;
  let checklist: string;
  let references: string;

  if (lowerQuery.includes('전세') || (lowerQuery.includes('보증금') && !lowerQuery.includes('상가'))) {
    summary = '전세계약서로 판단되며, 제시하신 정보 기준 종합 위험도는 🔴 **상**입니다. 등기부상 선순위 채권 대비 보증금 회수 가능성 점검이 시급합니다.';
    riskClauses = `- 🔴 **상** "보증금 반환 시기를 신규 임차인 입주 시로 한정" - 임대차 종료 시 즉시 반환 의무를 무력화하는 독소조항입니다. [1]
- 🟡 **중** "임대인은 근저당권 말소 의무를 부담하지 않는다" - 선순위 채권 방치로 경매 시 보증금 손실 위험이 커집니다. [2]
- 🟢 **하** "관리비 산정 기준 미기재" - 분쟁 소지가 있어 명확화가 필요합니다.`;
    missingClauses = `- 잔금 지급과 동시에 선순위 근저당 말소 특약
- 전입신고·확정일자 익일까지 추가 담보 설정 금지 특약
- 전세보증금반환보증(HUG/HF) 가입 협조 특약
- 계약 해제 시 위약금·원상복구 범위 특약`;
    suggestions = `- 위험 조항 수정 문안(임차인 관점 이점: 반환 시기 확정):
  "임대인은 임대차 종료일에 임차인의 목적물 인도와 동시에 보증금 전액을 반환한다."
- 권장 특약(임차인 관점 이점: 담보 우선순위 보호):
  "임대인은 잔금 지급일 익일까지 어떠한 저당권·전세권도 추가 설정하지 아니한다."`;
    fraudCheck = `- 전세가율(보증금 ÷ 매매·시세)이 70%를 초과하면 깡통전세 위험이 높습니다.
- 선순위 채권 비율((선순위 채권 + 보증금) ÷ 시세)이 80%를 넘으면 경매 시 보증금 회수가 어려울 수 있습니다.
- 예: 시세 4억, 근저당 2억, 보증금 3억이면 (2억+3억)/4억 = 125%로 🔴 매우 위험합니다.`;
    checklist = `- 등기부등본(말소사항 포함) - 근저당·가압류·신탁 여부 확인
- 임대인 신분증 및 등기부상 소유자 일치 확인
- 건축물대장 - 위반건축물 여부
- 국세·지방세 완납증명서 - 임대인 체납 여부
- 전세보증금반환보증 가입 가능 여부`;
    references = `[1] 주택임대차보호법 제3조·제3조의2 (대항력·우선변제권)
[2] 대법원 2019다56789 (2020.2.13. 선고) - 임대인 보증금 반환 의무`;
  } else if (lowerQuery.includes('상가') || lowerQuery.includes('권리금') || lowerQuery.includes('임대차')) {
    summary = '상가임대차계약서로 판단되며, 종합 위험도는 🟡 **중**입니다. 권리금 회수 및 계약갱신요구권 관련 조항 점검이 필요합니다.';
    riskClauses = `- 🔴 **상** "임차인은 권리금 회수 기회를 포기한다" - 상가건물 임대차보호법상 강행규정에 반해 무효 소지가 큽니다. [1]
- 🟡 **중** "임대인은 계약갱신요구를 사유 없이 거절할 수 있다" - 10년 갱신요구권을 배제하는 조항입니다. [2]
- 🟢 **하** "원상복구 범위 불명확" - 인테리어 철거 범위 다툼이 발생할 수 있습니다.`;
    missingClauses = `- 권리금 회수 방해 금지 및 신규 임차인 주선 협조 특약
- 계약갱신요구권(최대 10년) 보장 확인 특약
- 관리비·공과금 부담 주체 및 인상 상한 특약
- 임대료 증액 상한(5%) 명시 특약`;
    suggestions = `- 위험 조항 수정 문안(임차인 관점 이점: 권리금 보호):
  "임대인은 임대차 종료 시 임차인이 주선한 신규 임차인과의 계약 체결을 정당한 사유 없이 거절하지 아니한다."
- 권장 특약(임차인 관점 이점: 영업 안정성):
  "임차인은 최초 계약일로부터 10년 범위에서 계약갱신을 요구할 수 있다."`;
    fraudCheck = `- 상가는 대항력·우선변제를 위해 사업자등록과 확정일자가 중요합니다.
- 환산보증금(보증금 + 월세×100)이 지역별 기준을 초과하면 일부 보호 규정 적용이 제한됩니다.`;
    checklist = `- 등기부등본 - 근저당·가압류 확인
- 건축물대장 - 용도 및 위반건축물 여부(업종 인허가 영향)
- 임대인 신분·소유권 확인
- 상가 관리규약 및 관리비 내역
- 사업자등록·확정일자 부여 가능 여부`;
    references = `[1] 상가건물 임대차보호법 제10조의4 (권리금 회수기회 보호)
[2] 상가건물 임대차보호법 제10조 (계약갱신요구권)`;
  } else if (lowerQuery.includes('월세') || lowerQuery.includes('연체') || lowerQuery.includes('퇴거')) {
    summary = '월세계약서로 판단되며, 종합 위험도는 🟡 **중**입니다. 연체 및 계약 해지 관련 조항에 임차인에게 불리한 독소조항이 확인됩니다.';
    riskClauses = `- 🔴 **상** "월세 1회 연체 시 즉시 퇴거" - 주택임대차보호법상 해지 사유(2기 차임 연체)보다 과도해 무효 소지가 있습니다. [1]
- 🟡 **중** "임대인은 언제든 사전통지 없이 방문·점검할 수 있다" - 임차인의 주거 평온을 침해하는 조항입니다.
- 🟢 **하** "관리비 항목 미분리" - 실비 정산 여부 확인이 필요합니다.`;
    missingClauses = `- 차임 연체 시 해지 요건을 법정 기준(2기 연체)으로 명시하는 특약
- 임대인 방문 시 사전 통지(48시간) 특약
- 시설물 하자 수선 의무 주체 특약
- 보증금 반환 시기·방법 특약`;
    suggestions = `- 위험 조항 수정 문안(임차인 관점 이점: 부당 해지 방지):
  "임대인은 임차인이 차임을 2기 이상 연체한 경우에 한하여 계약을 해지할 수 있다."
- 권장 특약(임차인 관점 이점: 주거 평온 보장):
  "임대인의 방문·점검은 최소 48시간 전 사전 통지 후 임차인 동의하에 이루어진다."`;
    fraudCheck = `- 월세라도 보증금이 있다면 전입신고·확정일자로 대항력과 우선변제권을 확보하세요.
- 보증금 대비 선순위 채권 비율을 확인해 회수 가능성을 점검하시기 바랍니다.`;
    checklist = `- 등기부등본 - 권리관계 확인
- 임대인 신분·소유권 일치 확인
- 관리비 산정 내역
- 시설물 현황(입주 전 사진 기록)
- 국세·지방세 완납 여부`;
    references = `[1] 주택임대차보호법 제6조·민법 제640조 (차임 연체와 계약 해지)
[2] 대법원 2015다23456 - 임차인 주거 사용·수익권`;
  } else {
    summary = '제출하신 내용은 부동산 계약서 검토 요청으로 판단되며, 종합 위험도는 🟡 **중**입니다. 조항의 법적 유효성과 당사자 유불리를 함께 검토했습니다.';
    riskClauses = `- 🔴 **상** "임차인은 어떤 경우에도 보증금 반환을 청구할 수 없다" 형태의 조항 - 강행규정 위반으로 무효 가능성이 높습니다. [1]
- 🟡 **중** 일방 당사자에게만 위약금·책임을 지우는 편면적 조항 - 공정성 다툼 소지가 있습니다.
- 🟢 **하** 용어·범위가 불명확한 조항 - 분쟁 예방을 위해 구체화가 필요합니다.`;
    missingClauses = `- 계약 목적물·당사자·금액 등 핵심 사항 명확화
- 하자·수선 의무 및 위험부담 특약
- 계약 해제·해지 요건과 위약금 특약
- 분쟁 발생 시 관할·해결 방법 특약`;
    suggestions = `- 위험 조항 수정 문안(양 당사자 관점 이점: 유효성 확보):
  "보증금 반환 등 법률상 강행규정에 반하는 조항은 두지 아니하며, 관련 법령을 따른다."
- 권장 특약(양 당사자 관점 이점: 분쟁 최소화):
  "본 계약과 관련한 분쟁은 상호 협의하되, 협의가 이루어지지 않으면 목적물 소재지 법원을 관할로 한다."`;
    fraudCheck = `- 전세·월세라면 전입신고·확정일자로 대항력을 확보하고, 선순위 채권과 전세가율을 점검하시기 바랍니다.
- 매매라면 잔금 시점 등기부 재확인으로 권리 변동을 점검하세요.`;
    checklist = `- 등기부등본(말소사항 포함)
- 건축물대장
- 당사자 신분·소유권 확인 서류
- 국세·지방세 완납증명서
- 표준계약서 양식 대조`;
    references = `[1] 주택임대차보호법 제10조 (강행규정)
[2] 민법 제105조·제103조 (임의규정·반사회질서 법률행위)`;
  }

  return `**[분석 요약]**
${summary}

**[위험 조항]**
${riskClauses}

**[누락 특약]**
${missingClauses}

**[수정·추천 제안]**
${suggestions}

**[전세사기/권리관계 점검]**
${fraudCheck}

**[필수 첨부서류 체크리스트]**
${checklist}

---
**[근거]**
${references}
[3] 국가법령정보센터 (https://law.go.kr)
[4] 대법원 종합법률정보 (https://glaw.scourt.go.kr)

---
⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 실제 계약 체결 전에는 반드시 변호사 등 전문가와 상담하시기 바랍니다.`;
}

function generateLegalMockResponse(query: string): string {
  const lowerQuery = query.toLowerCase();

  let lawReference: string;
  let caseReference: string;
  let summary: string;
  let opinion: string;

  if (lowerQuery.includes('임대차') || lowerQuery.includes('전세') || lowerQuery.includes('보증금') || lowerQuery.includes('월세')) {
    lawReference = `**주택임대차보호법 제3조(대항력 등)**에 따르면, 임차인이 주택의 인도와 주민등록을 마친 때에는 그 다음 날부터 제3자에 대하여 대항력이 생깁니다. [1]

또한 **주택임대차보호법 제3조의2(보증금의 회수)**에 의하면, 임차인은 임대차가 끝난 후 보증금을 반환받을 때까지 임차주택을 점유할 수 있습니다. [2]

확정일자를 받은 임차인은 민사집행법에 따른 경매 시 후순위권리자보다 우선하여 보증금을 변제받을 수 있습니다.`;

    caseReference = `**대법원 2013다12345 판결**에서는 "임차인이 대항력을 갖추기 위해서는 주택의 인도와 주민등록의 전입신고를 모두 마쳐야 하며, 이 두 요건은 동시에 구비되어야 한다"고 판시하였습니다. [3]

**대법원 2019다56789 판결**에서는 임대인의 보증금 반환 의무와 관련하여, "임대차 종료 후 임대인은 특별한 사정이 없는 한 보증금을 즉시 반환하여야 한다"고 판시한 바 있습니다. [4]`;

    summary = '전세보증금 미반환 시, 임차인은 대항력과 우선변제권을 통해 보호받을 수 있습니다.';
    opinion = `귀하의 상황에서는 다음과 같은 절차를 고려하시기 바랍니다:

1. **내용증명 발송**: 임대인에게 보증금 반환을 요구하는 내용증명을 발송합니다.
2. **임차권등기명령 신청**: 이사를 해야 하는 경우, 법원에 임차권등기명령을 신청하여 대항력을 유지합니다.
3. **지급명령 또는 소송**: 반환이 이루어지지 않을 경우, 법원에 지급명령을 신청하거나 보증금반환청구소송을 제기할 수 있습니다.
4. **주택도시보증공사(HUG) 보증보험**: 전세보증금반환보증에 가입되어 있다면 보증기관에 보증금 반환을 청구할 수 있습니다.`;

  } else if (lowerQuery.includes('매매') || lowerQuery.includes('계약') || lowerQuery.includes('거래')) {
    lawReference = `**부동산 거래신고 등에 관한 법률 제3조**에 따르면, 부동산 매매계약을 체결한 경우 거래당사자는 계약체결일부터 30일 이내에 관할 시·군·구청에 공동으로 신고하여야 합니다. [1]

**민법 제568조(매매의 효력)**에 의하면, 매도인은 매수인에게 매매의 목적이 된 권리를 이전하여야 하며, 매수인은 매도인에게 대금을 지급하여야 합니다. [2]`;

    caseReference = `**대법원 2018다234567 판결**에서는 "부동산 매매계약에서 계약금은 특별한 약정이 없는 한 해약금의 성질을 가지므로, 매수인은 계약금을 포기하고, 매도인은 계약금의 배액을 상환하고 계약을 해제할 수 있다"고 판시하였습니다. [3]`;

    summary = '부동산 매매계약 시에는 등기부등본 확인, 거래신고, 계약서 작성 등 법적 절차를 준수해야 합니다.';
    opinion = `부동산 매매 계약 시 주의사항은 다음과 같습니다:

1. **등기부등본 확인**: 소유권, 근저당권, 가압류 등 권리관계를 확인합니다.
2. **실거래가 신고**: 계약 체결 후 30일 이내 실거래가를 신고해야 합니다.
3. **특약사항 명시**: 하자보수, 잔금 조건 등을 계약서에 명시합니다.
4. **중도금/잔금 지급 시**: 등기부등본을 재확인하여 권리변동 여부를 점검합니다.`;

  } else if (lowerQuery.includes('등기') || lowerQuery.includes('소유권') || lowerQuery.includes('이전')) {
    lawReference = `**부동산등기법 제23조(등기신청의 방법)**에 따르면, 등기는 당사자의 신청 또는 관공서의 촉탁에 의하여 이루어집니다. [1]

**부동산등기법 제56조(소유권이전등기)**에 의하면, 소유권이전등기는 등기원인과 그 연월일, 등기목적을 기재하여 신청하여야 합니다. [2]

매매로 인한 소유권이전등기는 잔금 지급일로부터 60일 이내에 신청하여야 합니다.`;

    caseReference = `**대법원 2015다98765 판결**에서는 "소유권이전등기청구권은 채권적 청구권으로서 10년의 소멸시효에 걸린다"고 판시하였습니다. [3]`;

    summary = '소유권 이전 등기는 잔금 지급 후 60일 이내에 완료해야 하며, 필요서류를 구비하여 관할 등기소에 신청합니다.';
    opinion = `소유권 이전 등기 절차는 다음과 같습니다:

1. **필요서류 준비**: 매도인(등기필증, 인감증명서, 주민등록초본), 매수인(주민등록등본)
2. **취득세 납부**: 관할 시·군·구청에서 취득세를 신고·납부합니다.
3. **등기신청**: 관할 등기소에 소유권이전등기를 신청합니다.
4. **기한 준수**: 잔금일로부터 60일 이내에 등기를 완료해야 과태료가 부과되지 않습니다.`;

  } else if (lowerQuery.includes('세금') || lowerQuery.includes('양도') || lowerQuery.includes('취득세') || lowerQuery.includes('종부세')) {
    lawReference = `**소득세법 제89조(비과세 양도소득)**에 따르면, 1세대 1주택으로서 대통령령으로 정하는 요건을 갖춘 경우 양도소득세가 비과세됩니다. [1]

**지방세법 제11조(취득세 세율)**에 의하면, 부동산 취득 시 취득가액의 1~3%에 해당하는 취득세를 납부하여야 합니다. 다만, 다주택자의 경우 중과세율이 적용될 수 있습니다. [2]`;

    caseReference = `**대법원 2020두12345 판결**에서는 "1세대 1주택 비과세 요건 중 '2년 이상 보유' 요건은 실제 보유기간을 기준으로 판단하며, 등기일이 아닌 잔금 지급일부터 기산한다"고 판시하였습니다. [3]`;

    summary = '부동산 관련 세금은 취득세, 재산세, 양도소득세 등이 있으며, 비과세·감면 요건을 확인하는 것이 중요합니다.';
    opinion = `부동산 세금 관련 주요 사항:

1. **취득세**: 주택 취득 시 1~3% (다주택자 중과 시 최대 12%)
2. **양도소득세 비과세**: 1세대 1주택, 2년 이상 보유(조정대상지역은 2년 거주 필요), 양도가액 12억원 이하
3. **종합부동산세**: 공시가격 합산 일정 금액 초과 시 부과
4. **절세 전략**: 장기보유특별공제, 1주택 비과세 등을 활용하시기 바랍니다.`;

  } else if (lowerQuery.includes('중개') || lowerQuery.includes('공인중개사') || lowerQuery.includes('수수료') || lowerQuery.includes('복비')) {
    lawReference = `**공인중개사법 제32조(중개보수)**에 따르면, 중개보수는 국토교통부령으로 정하는 범위 안에서 시·도 조례로 정합니다. [1]

**공인중개사법 제33조(금지행위)**에 의하면, 중개업자는 중개대상물의 매매를 업으로 하는 행위, 시세에 부당한 영향을 줄 목적으로 하는 행위 등이 금지됩니다. [2]`;

    caseReference = `**대법원 2017다45678 판결**에서는 "공인중개사의 중개보수 청구권은 중개행위가 완성되어 거래당사자 간에 계약이 성립된 때에 발생한다"고 판시하였습니다. [3]`;

    summary = '중개수수료는 거래 유형과 금액에 따라 법정 요율이 정해져 있으며, 초과 수수료 요구는 위법합니다.';
    opinion = `중개수수료 관련 안내:

1. **매매**: 거래금액 × 요율 (5천만원 미만 0.6%, 2억 미만 0.5%, 9억 미만 0.4% 등)
2. **임대차**: 거래금액 × 요율 (5천만원 미만 0.5%, 1억 미만 0.4% 등)
3. **부가세**: 중개사가 일반과세자인 경우 부가세 10% 별도
4. **과다수수료 시**: 관할 시·군·구에 신고 가능하며, 초과분은 반환 청구 가능`;

  } else {
    lawReference = `**민법 제185조(물권의 종류)**에 따르면, 물권은 법률 또는 관습법에 의하는 외에는 임의로 창설하지 못합니다. [1]

**부동산등기법 제2조**에 의하면, 부동산의 표시와 부동산에 관한 권리의 보존, 이전, 설정, 변경, 처분의 제한 또는 소멸은 등기부에 기록하여야 합니다. [2]`;

    caseReference = `**대법원 2016다78901 판결**에서는 부동산 관련 분쟁에서 "등기부의 기재는 진실한 권리관계에 부합하는 것으로 추정된다"는 원칙을 재확인하였습니다. [3]`;

    summary = '부동산 법률 문제는 관련 법령과 판례를 종합적으로 검토하여 판단해야 합니다.';
    opinion = `귀하의 질문에 대해 다음 사항을 참고해 주시기 바랍니다:

1. **관련 법령 확인**: 해당 사안에 적용되는 법률과 시행령을 확인합니다.
2. **전문가 상담**: 구체적인 사안에 대해서는 변호사 또는 법무사와 상담하시기 바랍니다.
3. **기한 확인**: 법적 절차에는 기한이 있으므로 주의가 필요합니다.
4. **증거 보존**: 관련 서류와 증거를 잘 보관해 두시기 바랍니다.`;
  }

  const references = `
---
**[참고 자료]**
[1] 국가법령정보센터 (https://law.go.kr)
[2] 대한법률구조공단 법률정보 (https://www.klac.or.kr)
[3] 대법원 종합법률정보 (https://glaw.scourt.go.kr)
[4] 법제처 찾기 쉬운 생활법령정보 (https://easylaw.go.kr)`;

  return `**[질문 요약]**
${summary}

**[관련 법령 설명]**
${lawReference}

**[관련 판례 설명]**
${caseReference}

**[종합 의견]**
${opinion}

${references}

---
⚠️ 본 답변은 참고용이며 법적 효력이 없습니다. 구체적인 법률 문제는 반드시 전문 법률가와 상담하시기 바랍니다.`;
}

// API Routes

// GET /api/categories
app.get('/api/categories', (req, res) => {
  const service = (req.query.service as string) || 'legal';
  const cats = categoriesByService[service] || categoriesByService['legal'];
  res.json({ categories: cats });
});

// POST /api/questions
app.post('/api/questions', async (req, res) => {
  const { query, sessionId: providedSessionId, service } = req.body;
  const serviceType = service || 'legal'; // default to legal for backward compatibility

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: '질문을 입력해주세요.' });
    return;
  }

  // 계약서 서비스는 OCR로 추출한 계약서 원문(장문)을 함께 보낼 수 있으므로 상한을 완화한다.
  const maxQueryLength = serviceType === 'contract' ? 200000 : 1000;
  if (query.length < 10 || query.length > maxQueryLength) {
    res.status(400).json({ error: `질문은 10자 이상 ${maxQueryLength.toLocaleString()}자 이하로 입력해주세요.` });
    return;
  }

  const sessionId = providedSessionId || randomUUID();

  // Get or create session
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [] });
  }
  const session = sessions.get(sessionId)!;

  // Add user message to history
  session.history.push({
    role: 'user',
    content: query,
    timestamp: new Date().toISOString(),
  });

  let answer: string;

  // 세무 서비스에서 수치 추출 및 세율 계산 시도 (인라인 구현)
  let taxCalculationContext = '';
  if (serviceType === 'tax') {
    try {
      const numerics = extractNumericsFromQuery(query);
      const taxType = detectTaxType(query);

      if (numerics.amount && taxType) {
        const calcResult = calculateLocalTax(taxType, numerics.amount, numerics.housingCount || 1);
        taxCalculationContext = formatCalculationForPrompt(calcResult);
        console.log(`[세율 계산] ${taxType} 계산 완료: 예상 세액 ${calcResult.estimatedTax?.toLocaleString()}원`);
      }
    } catch (calcError) {
      console.warn('[세율 계산] 로컬 계산 실패 (Gemini 응답으로 대체):', calcError);
    }
  }

  if (isLiveMode) {
    // Gemini API 호출 (세율 계산 결과를 컨텍스트에 추가)
    try {
      const messageWithContext = taxCalculationContext
        ? `${query}\n\n[시스템 참고: 세율 계산 결과]\n${taxCalculationContext}`
        : query;
      console.log(`[Live 모드] Gemini API 호출 중... (서비스: ${serviceType}, 질문: ${query.substring(0, 50)}...)`);
      answer = await callGeminiAPI(messageWithContext, serviceType);
    } catch (error) {
      console.error('[Gemini API 오류] Mock 응답으로 폴백합니다:', error);
      answer = generateMockResponse(query, serviceType);
    }
  } else {
    // Mock 모드: 기존 더미 응답
    await new Promise((resolve) => setTimeout(resolve, 1500));
    answer = generateMockResponse(query, serviceType);
  }

  // Add assistant message to history
  session.history.push({
    role: 'assistant',
    content: answer,
    timestamp: new Date().toISOString(),
  });

  res.json({
    sessionId,
    answer,
    timestamp: new Date().toISOString(),
    sources: [
      { title: '국가법령정보센터', url: 'https://law.go.kr' },
      { title: '대법원 종합법률정보', url: 'https://glaw.scourt.go.kr' },
    ],
  });
});

// POST /api/feedback
app.post('/api/feedback', (req, res) => {
  const { sessionId, messageIndex, rating, comment } = req.body;

  if (!sessionId || rating === undefined) {
    res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
    return;
  }

  console.log(`[피드백] 세션: ${sessionId}, 메시지: ${messageIndex}, 평가: ${rating > 0 ? '👍' : '👎'}${comment ? ', 코멘트: ' + comment : ''}`);

  res.json({ success: true, message: '피드백이 저장되었습니다. 감사합니다.' });
});

/**
 * 계산 결과를 Gemini 프롬프트에 포함할 형태로 포맷한다 (로컬 인라인 버전).
 */
function formatCalculationForPrompt(result: LocalCalcResult): string {
  const lines: string[] = [];
  lines.push(`세목: ${result.taxType}`);
  lines.push(`예상 세액: ${result.estimatedTax?.toLocaleString()}원`);
  lines.push(`실효 세율: ${((result.effectiveRate || 0) * 100).toFixed(2)}%`);
  lines.push(`산출 근거: ${result.description}`);
  return lines.join('\n');
}

// ─── 계산기 통합 라우팅 (/calculators/*) ────────────────────────────────────
//
// 결정론적 순수 계산(취득/양도/중개/계약서 연동)과 AI 자문 보조(로컬 Gemini) 경로를
// CalculatorOrchestrator에 위임한다. 새 계산 로직을 이 파일에 두지 않는다.
// AI 보조기는 provider 기본값이 'local'이면 LocalGeminiProvider(gemini-3.6-flash,
// GEMINI_API_KEY)를 사용하므로, 로컬 서버가 이미 쓰는 GEMINI_API_KEY가 그대로 재사용된다.
//
// 응답 형식(14.1 UI가 소비할 계약):
//   성공: { success: true,  data: <계산 결과 | AI 응답 | 기준연도 목록> }
//   실패: { success: false, error: ErrorResponse }
// (Lambda 핸들러 src/modules/calculators/handler.ts 와 동일한 봉투 형식)

// 오케스트레이터는 상태 비저장·결정론적이므로 단일 인스턴스를 공유한다.
const calculatorOrchestrator = new CalculatorOrchestrator();

const CALC_SUPPORTED_TYPES: CalculatorType[] = ['acquisition', 'transfer_tax', 'brokerage'];

/** 오케스트레이터 오류 코드를 HTTP 상태 코드로 매핑한다. */
function calcErrorStatus(code: string): number {
  switch (code) {
    case 'CALC_VALIDATION_FAILED':
    case 'CALC_BRIDGE_MISSING_FIELDS':
      return 400;
    case 'CALC_RATE_TABLE_NOT_FOUND':
    case 'CALC_CALCULATION_FAILED':
      return 422;
    default:
      return 400;
  }
}

/** 표준 오류 응답 봉투를 전송한다. */
function sendCalcError(res: express.Response, error: ErrorResponse, statusCode: number): void {
  res.status(statusCode).json({ success: false, error });
}

/** 오케스트레이션 결과를 성공/실패 봉투로 변환하여 전송한다. */
function sendCalcResult<T>(res: express.Response, result: OrchestrationResult<T>): void {
  if (result.ok) {
    res.json({ success: true, data: result.result });
    return;
  }
  sendCalcError(res, result.error, calcErrorStatus(result.error.code));
}

/** 요청 본문이 JSON 객체인지 확인한다. 아니면 오류 봉투를 전송하고 null을 반환한다. */
function requireObjectBody(req: express.Request, res: express.Response): Record<string, unknown> | null {
  const body = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    sendCalcError(
      res,
      {
        code: 'CALC_MISSING_BODY',
        message: '요청 본문은 계산에 필요한 입력값을 담은 JSON 객체여야 합니다.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
      },
      400,
    );
    return null;
  }
  return body as Record<string, unknown>;
}

// POST /calculators/acquisition - 취득비용 계산
app.post('/calculators/acquisition', (req, res) => {
  const body = requireObjectBody(req, res);
  if (!body) return;
  const input = body as unknown as AcquisitionCostInput;
  sendCalcResult(res, calculatorOrchestrator.calculateAcquisition(input));
});

// POST /calculators/transfer-tax - 양도소득세 계산
app.post('/calculators/transfer-tax', (req, res) => {
  const body = requireObjectBody(req, res);
  if (!body) return;
  const input = body as unknown as TransferTaxInput;
  sendCalcResult(res, calculatorOrchestrator.calculateTransferTax(input));
});

// POST /calculators/brokerage - 중개수수료 계산
app.post('/calculators/brokerage', (req, res) => {
  const body = requireObjectBody(req, res);
  if (!body) return;
  const input = body as unknown as BrokerageFeeInput;
  sendCalcResult(res, calculatorOrchestrator.calculateBrokerage(input));
});

// POST /calculators/from-contract - 계약서 연동 표준 스키마 기반 계산
// 요청 본문: { schema: CalculatorInputSchema, options?: BridgeMappingOptions }
// (하위 호환: 최상위에 스키마 필드가 직접 전달되어도 스키마로 취급)
app.post('/calculators/from-contract', (req, res) => {
  const body = requireObjectBody(req, res);
  if (!body) return;

  const rawSchema = 'schema' in body ? body['schema'] : body;
  if (typeof rawSchema !== 'object' || rawSchema === null) {
    sendCalcError(
      res,
      {
        code: 'CALC_BAD_REQUEST',
        message: '계약서 연동 계산에는 표준 입력 스키마(schema)가 필요합니다.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
      },
      400,
    );
    return;
  }

  const schema = rawSchema as unknown as CalculatorInputSchema;
  const options = ('options' in body ? body['options'] : {}) as BridgeMappingOptions;
  sendCalcResult(res, calculatorOrchestrator.processFromContract(schema, options ?? {}));
});

// POST /calculators/ai-assist - AI 자문 보조 (로컬 Gemini 경로 재사용, 계산 결과 컨텍스트 포함)
// AI 호출 실패/타임아웃/Circuit Breaker 개방은 AiAssistOutput.isAvailable=false 로 표현되며
// 예외를 던지지 않으므로 항상 200으로 반환한다(확정된 계산 결과에 영향 없음).
app.post('/calculators/ai-assist', async (req, res) => {
  const body = requireObjectBody(req, res);
  if (!body) return;

  if (
    typeof body['question'] !== 'string' ||
    typeof body['calculatorType'] !== 'string' ||
    typeof body['calculationContext'] !== 'object' ||
    body['calculationContext'] === null
  ) {
    sendCalcError(
      res,
      {
        code: 'CALC_BAD_REQUEST',
        message:
          'AI 자문 보조에는 계산기 유형(calculatorType), 질문(question), 계산 컨텍스트(calculationContext)가 필요합니다.',
        severity: ErrorSeverity.MEDIUM,
        timestamp: new Date().toISOString(),
      },
      400,
    );
    return;
  }

  try {
    const input = body as unknown as AiAssistInput;
    const output = await calculatorOrchestrator.assist(input);
    res.json({ success: true, data: output });
  } catch (error) {
    console.error('[계산기 AI 보조] 예기치 못한 오류:', error);
    sendCalcError(
      res,
      {
        code: 'CALC_INTERNAL_ERROR',
        message: '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. 계산 결과는 그대로 유지됩니다.',
        severity: ErrorSeverity.HIGH,
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
});

// GET /calculators/rate-tables - 기준연도별 기준표 / 사용 가능 연도 조회
// 쿼리: ?type=acquisition|transfer_tax|brokerage (미지정 시 전체 유형 목록 반환)
app.get('/calculators/rate-tables', (req, res) => {
  const typeParam = typeof req.query.type === 'string' ? req.query.type : undefined;

  if (typeParam !== undefined && typeParam !== '') {
    if (!CALC_SUPPORTED_TYPES.includes(typeParam as CalculatorType)) {
      sendCalcError(
        res,
        {
          code: 'CALC_BAD_REQUEST',
          message: `지원하지 않는 계산기 유형입니다: ${typeParam}. 사용 가능한 유형: ${CALC_SUPPORTED_TYPES.join(', ')}`,
          severity: ErrorSeverity.LOW,
          timestamp: new Date().toISOString(),
          context: { type: typeParam, supportedTypes: CALC_SUPPORTED_TYPES },
        },
        400,
      );
      return;
    }
    const type = typeParam as CalculatorType;

    // baseYear 쿼리가 함께 오면 해당 기준표의 실제 세율표(rateData)를 반환한다(세율 확인 UI용).
    const baseYearParam =
      typeof req.query.baseYear === 'string' && req.query.baseYear.trim() !== ''
        ? Number(req.query.baseYear)
        : undefined;

    if (baseYearParam !== undefined) {
      if (!Number.isInteger(baseYearParam)) {
        sendCalcError(
          res,
          {
            code: 'CALC_BAD_REQUEST',
            message: `기준연도(baseYear)는 정수여야 합니다: ${req.query.baseYear}`,
            severity: ErrorSeverity.LOW,
            timestamp: new Date().toISOString(),
            context: { type, baseYear: req.query.baseYear },
          },
          400,
        );
        return;
      }

      const rateTable = calculatorOrchestrator.getRateTable(type, baseYearParam);
      if (!rateTable) {
        // 미존재 기준연도: 사용 가능 연도 목록을 안내(요구사항 6.6).
        res.json({
          success: true,
          data: {
            type,
            baseYear: baseYearParam,
            found: false,
            availableBaseYears: calculatorOrchestrator.getAvailableBaseYears(type),
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          type,
          baseYear: rateTable.baseYear,
          version: rateTable.version,
          found: true,
          rateData: rateTable.data,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: { type, availableBaseYears: calculatorOrchestrator.getAvailableBaseYears(type) },
    });
    return;
  }

  const availableBaseYears: Record<CalculatorType, number[]> = {
    acquisition: calculatorOrchestrator.getAvailableBaseYears('acquisition'),
    transfer_tax: calculatorOrchestrator.getAvailableBaseYears('transfer_tax'),
    brokerage: calculatorOrchestrator.getAvailableBaseYears('brokerage'),
  };
  res.json({ success: true, data: { availableBaseYears } });
});

// ─── 계약서 OCR (Gemini Vision 멀티모달) ───────────────────────────────────
// 로컬 전용: 사진/PDF → Gemini Vision으로 텍스트 원문 추출.
// 배포용 파이프라인(S3/DynamoDB/analyze 오케스트레이터)은 AWS 의존이라 로컬에서 재현하지 않는다.

/** OCR 허용 MIME 타입 */
const OCR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

/** base64 디코딩 크기 상한 (20MB) */
const OCR_MAX_DECODED_BYTES = 20 * 1024 * 1024;

/** 계약서 OCR 시스템 프롬프트 (gemini-vision-provider.ts의 OCR_SYSTEM_PROMPT와 동일 취지) */
const OCR_SYSTEM_PROMPT = [
  '당신은 대한민국 부동산 계약서 텍스트 추출 전문 도구입니다.',
  '첨부된 계약서 이미지 또는 PDF에서 모든 텍스트를 원문 그대로 추출하세요.',
  '',
  '규칙:',
  '- 조항 번호, 특약사항, 표에 포함된 금액·날짜·당사자 정보를 빠짐없이 추출하세요.',
  '- 원문의 줄바꿈과 조항 구분을 최대한 보존하세요.',
  '- 요약하거나 해설하지 말고, 문서에 적힌 텍스트만 그대로 출력하세요.',
  '- 추출한 텍스트 외의 설명·머리말·꼬리말을 덧붙이지 마세요.',
].join('\n');

/**
 * Gemini Vision 멀티모달로 계약서 이미지/PDF에서 텍스트를 추출한다.
 * (callGeminiAPI와 동일한 모델/URL 규약을 사용하되, inline_data로 파일을 전송)
 */
async function callGeminiVisionOcr(base64Data: string, mimeType: string): Promise<string> {
  if (LLM_PROVIDER === 'claude') {
    return callClaudeGatewayOcr(base64Data, mimeType);
  }
  return callGeminiVisionOcrInternal(base64Data, mimeType);
}

/** 기존 Gemini Vision OCR (복귀용). */
async function callGeminiVisionOcrInternal(base64Data: string, mimeType: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;
  const requestBody = {
    contents: [
      {
        parts: [
          { text: OCR_SYSTEM_PROMPT },
          { inline_data: { mime_type: mimeType, data: base64Data } },
        ],
      },
    ],
    generationConfig: { temperature: 0.0, maxOutputTokens: 8192 },
  };
  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const elapsed = Date.now() - startTime;
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Gemini Vision OCR 오류] Status: ${response.status}, Body: ${errorBody}`);
    throw new Error(`Gemini Vision API 호출 실패: ${response.status}`);
  }
  const data: any = await response.json();
  console.log(`[Gemini Vision OCR] 응답시간: ${elapsed}ms`);
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('Gemini Vision API: 응답 후보가 없습니다.');
  }
  return parts.map((part: { text?: string }) => part.text ?? '').join('').trim();
}

/** Claude 게이트웨이 OCR (OpenAI 호환 image_url data URI). */
async function callClaudeGatewayOcr(base64Data: string, mimeType: string): Promise<string> {
  const url = `${LLM_BASE_URL}/chat/completions`;
  const dataUri = `data:${mimeType};base64,${base64Data}`;
  const requestBody = {
    model: LLM_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: OCR_SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    max_tokens: 8192,
    temperature: 0.0,
  };
  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  const elapsed = Date.now() - startTime;
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Claude 게이트웨이 OCR 오류] Status: ${response.status}, Body: ${errorBody}`);
    throw new Error(`Claude 게이트웨이 OCR 호출 실패: ${response.status}`);
  }
  const data: any = await response.json();
  console.log(`[Claude:${LLM_MODEL} OCR] 응답시간: ${elapsed}ms`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Claude 게이트웨이 OCR: 응답 내용이 없습니다.');
  }
  return typeof content === 'string' ? content.trim() : String(content).trim();
}

/** Mock 모드에서 반환할 계약서 텍스트 예시 */
function generateOcrMockText(mimeType: string): string {
  return [
    '[Mock] 계약서 텍스트 추출 예시 (실제 OCR은 Live 모드에서 동작합니다)',
    `- 원본 형식: ${mimeType}`,
    '',
    '부동산 임대차 계약서',
    '',
    '제1조 (목적물) 서울특별시 ○○구 ○○동 123-45 아파트 101동 1001호',
    '제2조 (보증금) 보증금 300,000,000원, 계약금 30,000,000원은 계약 시 지급한다.',
    '제3조 (임대차 기간) 2026년 3월 1일부터 2028년 2월 28일까지(24개월)',
    '제4조 (차임) 월세 없음(전세).',
    '',
    '특약사항',
    '1. 임대인은 잔금 지급일 익일까지 추가 근저당권을 설정하지 아니한다.',
    '2. 등기부상 선순위 근저당 200,000,000원이 존재함(임차인 확인).',
    '3. 임차인은 어떠한 경우에도 보증금 반환을 청구할 수 없다.(검토 필요 조항)',
  ].join('\n');
}

// POST /api/contract/ocr - 계약서 이미지/PDF에서 텍스트 추출
// 요청: { fileBase64: string, mimeType: string }
// 응답: 성공 { success: true, text }, 실패 { success: false, error }
app.post('/api/contract/ocr', async (req, res) => {
  const { fileBase64, mimeType } = req.body ?? {};

  if (!fileBase64 || typeof fileBase64 !== 'string') {
    res.status(400).json({ success: false, error: '파일 데이터(fileBase64)가 필요합니다.' });
    return;
  }
  if (!mimeType || typeof mimeType !== 'string' || !OCR_ALLOWED_MIME_TYPES.includes(mimeType)) {
    res.status(400).json({
      success: false,
      error: `지원하지 않는 형식입니다. 허용: ${OCR_ALLOWED_MIME_TYPES.join(', ')}`,
    });
    return;
  }

  // data URL 접두사(data:...;base64,)가 포함되어 있으면 제거
  const commaIdx = fileBase64.indexOf(',');
  const base64Data =
    fileBase64.startsWith('data:') && commaIdx !== -1
      ? fileBase64.slice(commaIdx + 1)
      : fileBase64;

  // base64 디코딩 크기 검증 (20MB 초과 시 400)
  const decodedBytes = Math.floor((base64Data.length * 3) / 4);
  if (decodedBytes > OCR_MAX_DECODED_BYTES) {
    res.status(400).json({
      success: false,
      error: `파일이 너무 큽니다. 최대 20MB까지 업로드할 수 있습니다. (현재 약 ${Math.round(decodedBytes / (1024 * 1024))}MB)`,
    });
    return;
  }

  try {
    let text: string;
    if (isLiveMode) {
      console.log(`[Live 모드] 계약서 OCR 실행 중... (형식: ${mimeType}, 크기: 약 ${Math.round(decodedBytes / 1024)}KB)`);
      text = await callGeminiVisionOcr(base64Data, mimeType);
      if (!text) {
        res.status(200).json({ success: false, error: '텍스트를 추출하지 못했습니다. 더 선명한 이미지를 사용해 주세요.' });
        return;
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 800));
      text = generateOcrMockText(mimeType);
    }
    res.json({ success: true, text });
  } catch (error) {
    console.error('[계약서 OCR 오류]', error);
    res.status(200).json({
      success: false,
      error: error instanceof Error ? error.message : '계약서 텍스트 추출 중 오류가 발생했습니다.',
    });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🏠 부동산 법률 AI 자문 시스템 - 로컬 개발 서버`);
  console.log(`${'='.repeat(50)}`);
  console.log(`\n✅ 서버가 시작되었습니다: http://localhost:${PORT}`);
  console.log(`📋 API 엔드포인트:`);
  console.log(`   POST /api/questions              - 질문 처리`);
  console.log(`   GET  /api/categories             - FAQ 카테고리`);
  console.log(`   POST /api/feedback               - 피드백 수집`);
  console.log(`   POST /api/contract/ocr           - 계약서 사진/PDF 텍스트 추출(OCR)`);
  console.log(`   POST /calculators/acquisition    - 취득비용 계산`);
  console.log(`   POST /calculators/transfer-tax   - 양도소득세 계산`);
  console.log(`   POST /calculators/brokerage      - 중개수수료 계산`);
  console.log(`   POST /calculators/from-contract  - 계약서 연동 계산`);
  console.log(`   POST /calculators/ai-assist      - AI 자문 보조(로컬 Gemini)`);
  console.log(`   GET  /calculators/rate-tables    - 기준연도/기준표 조회`);

  if (isLiveMode) {
    if (LLM_PROVIDER === 'claude') {
      console.log(`\n🤖 Live 모드 (Claude 게이트웨이)`);
      console.log(`   Provider: claude / Model: ${LLM_MODEL}`);
      console.log(`   Base URL: ${LLM_BASE_URL}`);
      console.log(`   ⚠️  자체서명 인증서 대응으로 로컬 TLS 검증을 비활성화했습니다(개발 전용).`);
    } else {
      console.log(`\n🤖 Live 모드 (Gemini 3.6 Flash)`);
    }
  } else {
    console.log(`\n💡 Mock 모드로 실행 중입니다.`);
    if (MODE === 'live' && !isKeyValid) {
      console.log(`   ⚠️  MODE=live이지만 API 키/게이트웨이 설정이 올바르지 않습니다.`);
      console.log(`   .env의 LLM_PROVIDER/LLM_BASE_URL/LLM_API_KEY 또는 GEMINI_API_KEY를 확인해주세요.`);
    }
  }
  console.log('');

  // Try to open browser
  const openCommand = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';

  import('child_process').then(({ exec }) => {
    exec(`${openCommand} http://localhost:${PORT}`);
  }).catch(() => {
    // Silently fail if browser can't be opened
  });
});
