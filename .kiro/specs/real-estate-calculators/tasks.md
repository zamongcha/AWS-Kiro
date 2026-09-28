# Implementation Plan: 부동산 계산기 통합 시스템

## Overview

부동산 취득비용·양도소득세·중개수수료를 법정 요율·세율 기준표에 근거하여 산출하는 결정론적(deterministic) 순수 계산 서비스를 구현한다. 기존 AI 자문 서비스(법률/세무/판례/계약서 분석)와 달리 LLM/RAG/벡터 검색을 계산 경로에 포함하지 않으며, 동일 입력에 대해 항상 동일 출력을 보장하는 순수 함수로 동작한다. 세율·요율 기준표는 계산 로직과 분리된 상수 테이블(기준연도·버전 메타데이터 포함)로 관리하여 세법 개정 시 로직 변경 없이 기준표만 교체한다.

TypeScript/Node.js 기반으로 `src/modules/calculators/` 하위에 독립 배포 가능한 모듈 구조를 구축한다. 각 모듈은 기존 공통 인터페이스(`src/common/interfaces/service-module.ts`)의 표준 `ServiceModule` 인터페이스와 공통 `ModuleInput`/`ModuleOutput`/`ErrorResponse` 타입을 준수하고, 기존 유틸리티(`src/common/utils/circuit-breaker.ts` 등)를 재활용한다.

요구사항 10의 "AI에게 물어보기"는 계산과 완전히 분리된 별도의 설명 보조 채널로 동작하며, Circuit Breaker와 30초 타임아웃으로 장애를 격리한다. AI 채널 장애 시에도 결정론적 계산 결과는 변경 없이 유지된다. 로컬 개발은 외부 의존 없는 순수 함수 직접 실행과 로컬 서버의 Gemini 경로(AI 보조)를 우선하며, 배포 시 AWS Lambda + 세무 자문 서비스 위임으로 교체 가능하도록 `AI_ADVISOR_PROVIDER` 환경 변수 뒤에 제공자를 둔다.

## Tasks

- [x] 1. 계산기 모듈 기본 구조 및 공통 타입 정의
  - [x] 1.1 계산기 전용 디렉토리 구조 생성 및 공통 타입 정의
    - `src/modules/calculators/` 하위 디렉토리 생성:
      ```
      src/modules/calculators/
      ├── interfaces/
      ├── rate-tables/
      │   └── data/
      │       ├── acquisition/
      │       ├── transfer-tax/
      │       └── brokerage/
      ├── input-validator/
      ├── acquisition-cost/
      ├── transfer-tax/
      ├── brokerage-fee/
      ├── calculator-bridge-adapter/
      ├── ai-advisor-assist/
      ├── orchestrator/
      └── index.ts
      ```
    - `src/modules/calculators/interfaces/types.ts` 생성: `CalculatorType`(acquisition/transfer_tax/brokerage), `PropertyType`(house/non_house), `BrokeragePropertyType`(house/officetel/other), `HousingCount`(one/two/three_or_more), `TransactionType`(sale_exchange/lease), `AcquisitionReductionType`(first_time_buyer/newlywed/long_term_rental_business/none), `CurrencyUnit` 타입 정의
    - `src/modules/calculators/interfaces/result.ts` 생성: `CalculationBasis`(formula/rateTableItem/appliedRate/taxBase/baseYear/rateTableVersion), `LineItem`(name/amount/basis), `CalculationResult<TDetail>`(calculatorType/total/lineItems/detail/baseYear/rateTableVersion/disclaimer) 정의
    - `src/modules/calculators/interfaces/index.ts` 생성: 전체 re-export
    - _Requirements: 9.3_

  - [x] 1.2 모듈별 입출력 인터페이스 정의
    - `src/modules/calculators/interfaces/input-validator.ts`: `ValidationInput`, `RateTableConstraints`, `ValidationResult`, `ValidationError`(type: missing/negative/exceeds_max/type_mismatch) 정의
    - `src/modules/calculators/interfaces/acquisition-cost.ts`: `AcquisitionCostInput`, `RentalReductionCondition`, `AcquisitionCostDetail`, `ReductionDetail`, `AcquisitionCostResult` 정의
    - `src/modules/calculators/interfaces/transfer-tax.ts`: `TransferTaxInput`, `TransferTaxDetail`, `TransferTaxResult` 정의
    - `src/modules/calculators/interfaces/brokerage-fee.ts`: `BrokerageFeeInput`, `BrokerageFeeDetail`, `BrokerageFeeResult` 정의
    - `src/modules/calculators/interfaces/rate-tables.ts`: `RateTableRequest`, `RateTableResponse`, `RateTable`, `RateTableMetadata`, `RateTableRegistry`, `AcquisitionRateData`/`TransferRateData`/`BrokerageRateData` 및 하위 구간 타입(`AcquisitionTaxBracket`, `HousingBondBracket`, `ScrivenerFeeBracket`, `StampTaxBracket`, `AcquisitionReduction`, `RentalDifferentialRate`, `ProgressiveBracket`, `LongTermDeductionRow`, `BrokerageRateBracket`) 정의
    - `src/modules/calculators/interfaces/calculator-bridge.ts`: `CalculatorInputSchema`, `CalculatorOutputSchema`, `BridgeAdapterResult` 정의
    - `src/modules/calculators/interfaces/ai-advisor.ts`: `AiAssistInput`, `AiCalculationContext`, `AiAssistOutput` 정의
    - _Requirements: 9.5_

  - [ ]* 1.3 모듈 입력 스키마 검증 속성 기반 테스트 작성
    - `src/tests/property/calculators/schema-validation.property.test.ts` 생성
    - 스키마 위반 랜덤 입력에 대해 각 모듈이 입력을 거부하고 스키마 불일치를 나타내는 표준 `ErrorResponse`를 반환하는지 검증 (**Property 34**)
    - _Requirements: 9.5_
    - _Properties: 34_

- [x] 2. 기준표 관리기 및 시드 데이터 구축
  - [x] 2.1 기준표 시드 데이터(2024/2025) 구축
    - `src/modules/calculators/rate-tables/data/acquisition/2024.json`, `2025.json` 생성: 취득세율 구간(주택수/조정지역/면적별), 지방교육세율, 농특세율·면적기준(85㎡), 국민주택채권 요율 구간, 법무사 수수료 구간, 인지세 구간, 감면 유형별 요건·감면율(장기임대 차등 감면율 포함), `baseYear`·`version` 메타데이터
    - `src/modules/calculators/rate-tables/data/transfer-tax/2024.json`, `2025.json` 생성: 기본세율 누진 구간(6~45%), 다주택 중과 가산(+20%p/+30%p), 단기보유 세율(1년미만 70%/1~2년 60%), 기본공제(250만원), 장기보유특별공제 표1·표2, 1세대1주택 비과세 상한(12억), 지방소득세율(10%), 메타데이터
    - `src/modules/calculators/rate-tables/data/brokerage/2024.json`, `2025.json` 생성: 임대차 환산 배수(100/70)·재산정 기준(5천만원), 거래유형/물건유형/금액 구간별 상한 요율·한도액, 메타데이터
    - 모든 세율·요율 값은 참고용 추정치 상수로 명시
    - _Requirements: 6.1, 6.2, 6.4_

  - [x] 2.2 기준표 관리기 구현
    - `src/modules/calculators/rate-tables/rate-table-registry.ts` 생성: `RateTableRegistryImpl` 클래스
      - `getRateTable(type, baseYear)`: 기준연도별 기준표 버전 조회, 미존재 시 null
      - `getAvailableBaseYears(type)`: 사용 가능 기준연도 목록 반환
      - 시드 JSON 로드 및 `RateTableConstraints`(maxAmount/maxArea/maxHoldingPeriod) 노출
    - `src/modules/calculators/rate-tables/index.ts` 생성: `RateTableModule` 클래스 (`ServiceModule` 구현)
      - 요청 기준연도 기준표 제공, 미존재 시 사용 가능 기준연도 목록 안내 응답
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_

  - [ ]* 2.3 기준표 관리기 속성 기반 테스트 작성
    - `src/tests/property/calculators/rate-tables.property.test.ts` 생성
    - 랜덤 기준표·결과에 대해 baseYear·version 메타데이터 존재 및 결과 반영 검증 (**Property 26**)
    - 랜덤 기준연도 요청에 대해 존재 시 해당 기준표 제공, 미존재 시 사용 가능 기준연도 목록 안내 검증 (**Property 27**)
    - _Requirements: 6.2, 6.3, 6.5, 6.6_
    - _Properties: 26, 27_

- [x] 3. 입력 검증기 구현
  - [x] 3.1 입력 검증기 구현
    - `src/modules/calculators/input-validator/input-validator.ts` 생성: `InputValidator` 클래스
      - 검증 순서: 필수 항목 존재 → 타입 일치(수치/열거형) → 음수 아님(0 이상) → 기준표 유효 상한 이하
      - 위반 시 `ValidationError`(type/field/message/expected) 반환, 계산 미수행, 원본 입력 보존(`preservedInput`)
      - 통과 시 `validatedPayload` 전달
    - `src/modules/calculators/input-validator/index.ts` 생성: `InputValidatorModule` 클래스 (`ServiceModule` 구현)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 3.2 입력 검증 속성 기반 테스트 작성
    - `src/tests/property/calculators/input-validation.property.test.ts` 생성
    - 위반(필수누락/음수/상한초과/타입불일치)·유효 랜덤 입력에 대해 판정(isValid)·오류유형·대상 항목명·계산 미수행·입력 보존, 유효 시 검증된 입력 전달 검증 (**Property 24**)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
    - _Properties: 24_

- [x] 4. 취득비용 계산기 구현
  - [x] 4.1 취득비용 계산기 구현
    - `src/modules/calculators/acquisition-cost/acquisition-calculator.ts` 생성: 순수 계산 함수
      - 취득세율 조회(주택수/조정지역/면적/취득가액 구간별), 취득세 = 취득가액 × 세율
      - 지방교육세 = 취득세 × 지방교육세율
      - 농어촌특별세: 전용면적 > 85㎡ 시에만 농특세율 적용(그 외 0)
      - 국민주택채권 매입액(공시가격 구간 요율), 인지세(취득가액 구간 정액)
      - 법무사 수수료: `useJudicialScrivener=true` 시에만 산출(그 외 0)
      - 감면: 감면 후 취득세 = 감면 전 × (1 − 감면율), 감면세액 = 감면 전 × 감면율, 감면 내역 별도 표시
      - 장기임대사업자: 면적 구간·취득 요건별 차등 감면율 + 사후관리 요건 안내(postManagementNotice)
      - 총 취득비용 = 항목별 내역 합산, 각 항목에 근거(basis)·기준연도·버전·면책 고지 포함
      - 조건 세율 미존재 시 산출 불가 오류 반환 + 입력 보존
    - `src/modules/calculators/acquisition-cost/index.ts` 생성: `AcquisitionCostModule` 클래스 (`ServiceModule` 구현)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12_

  - [ ]* 4.2 취득비용 계산 속성 기반 테스트 작성
    - `src/tests/property/calculators/acquisition-cost.property.test.ts` 생성
    - 랜덤 조건 조합에 대해 취득세율 구간 조회·취득세 산출(취득가액×세율) 검증 (**Property 2**)
    - 랜덤 취득세에 대해 지방교육세 = 취득세×교육세율 검증 (**Property 3**)
    - 0~200㎡ 랜덤 면적에 대해 85㎡ 초과 시에만 농특세>0 검증 (**Property 4**)
    - 랜덤 공시가격·취득가액에 대해 채권 매입액·인지세 구간 조회 검증 (**Property 5**)
    - `useJudicialScrivener` 랜덤에 대해 선택 시에만 수수료>0 검증 (**Property 6**)
    - 랜덤 감면율·취득세에 대해 감면 후/감면세액 산출 및 별도 표시 검증 (**Property 7**)
    - 장기임대 면적구간·취득요건 조합에 대해 차등 감면율·사후관리 안내 비어있지 않음 검증 (**Property 8**)
    - 랜덤 계산 결과에 대해 total == sum(lineItems) 검증 (**Property 9**)
    - 기준표 미포함 조건에 대해 산출 불가 오류·입력 보존 검증 (**Property 10**)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.12_
    - _Properties: 2, 3, 4, 5, 6, 7, 8, 9, 10_

- [x] 5. 체크포인트 - 기준표·검증·취득비용 파이프라인 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 6. 양도소득세 계산기 구현
  - [x] 6.1 양도세 계산기 구현
    - `src/modules/calculators/transfer-tax/transfer-tax-calculator.ts` 생성: 순수 계산 함수
      - 양도차익 = 양도가액 − 취득가액 − 필요경비
      - 1세대1주택 비과세 판정: 2년 이상 보유 + (조정지역 시) 2년 이상 거주 + 양도가액 ≤ 12억, 충족 시 비과세 판정·근거 표시
      - 1세대1주택 & 양도가액 > 12억 시 안분: 과세 양도차익 = 양도차익 × (양도가액 − 12억) ÷ 양도가액
      - 장기보유특별공제: 1세대1주택 표1 / 일반 표2, 공제액 = 과세 양도차익 × 공제율
      - 과세표준 = 과세 양도차익 − 장특공제 − 기본공제(250만원), 음수 시 0
      - 세율 적용: 기본세율(누진, 산출세액 = 과세표준×세율 − 누진공제), 단기(1년미만 70%/1~2년 60%), 다주택 조정지역 중과(+20%p/+30%p)
      - 지방소득세 = 양도소득세 × 10%
      - 결과 구조 완전성(양도차익/장특공제/기본공제/과세표준/적용세율/양도세/지방세/총액/기준연도·버전)
      - 조건 세율 미존재 시 산출 불가 오류 + 입력 보존
    - `src/modules/calculators/transfer-tax/index.ts` 생성: `TransferTaxModule` 클래스 (`ServiceModule` 구현)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [ ]* 6.2 양도세 계산 속성 기반 테스트 작성
    - `src/tests/property/calculators/transfer-tax.property.test.ts` 생성
    - 랜덤 금액에 대해 양도차익 = 양도가액−취득가액−필요경비 검증 (**Property 11**)
    - 랜덤 1세대1주택여부·보유거주기간에 대해 표1/표2 선택·공제율·공제액 검증 (**Property 12**)
    - 랜덤 양도차익·공제에 대해 과세표준 산출식(음수→0) 검증 (**Property 13**)
    - 랜덤 과세표준에 대해 기본세율·누진공제·산출세액 검증 (**Property 14**)
    - 랜덤 주택수·조정지역·보유기간에 대해 단기 70/60%·다주택 중과 +20/30%p 검증 (**Property 15**)
    - 랜덤 보유/거주/양도가액에 대해 1세대1주택 비과세 판정 정확성 검증 (**Property 16**)
    - 12억 전후 랜덤 양도가액에 대해 안분 계산식 검증 (**Property 17**)
    - 랜덤 양도세에 대해 지방소득세 = 양도세×10% 검증 (**Property 18**)
    - 랜덤 입력에 대해 결과 구조 완전성 + 미존재 조건 오류·입력 보존 검증 (**Property 19**)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_
    - _Properties: 11, 12, 13, 14, 15, 16, 17, 18, 19_

- [x] 7. 중개수수료 계산기 구현
  - [x] 7.1 중개수수료 계산기 구현
    - `src/modules/calculators/brokerage-fee/brokerage-calculator.ts` 생성: 순수 계산 함수
      - 임대차 거래금액 산정: 보증금 + 월세×100, 1차 환산액 < 5천만원이면 보증금 + 월세×70 재산정
      - 오피스텔: 요건 충족 시 오피스텔 전용 상한 요율 적용(usedOfficetelRate=true), 그 외 주택/주택외 요율
      - 상한 요율 구간 조회, 중개보수 = min(거래금액 × 상한요율, 한도액)(한도액 존재 시)
      - 결과에 산정 거래금액·적용 구간·상한 요율·한도액·상한액과 협의 가능·VAT 별도·지역 조례 안내 포함
      - 조건 요율 미존재 시 산출 불가 오류 + 입력 보존
    - `src/modules/calculators/brokerage-fee/index.ts` 생성: `BrokerageFeeModule` 클래스 (`ServiceModule` 구현)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 7.2 중개수수료 계산 속성 기반 테스트 작성
    - `src/tests/property/calculators/brokerage-fee.property.test.ts` 생성
    - 랜덤 보증금·월세에 대해 5천만원 경계 100/70배 전환 검증 (**Property 20**)
    - 랜덤 거래조건·금액·한도에 대해 상한 요율 조회·min 적용 검증 (**Property 21**)
    - 랜덤 물건유형·오피스텔 요건에 대해 전용 요율 적용(usedOfficetelRate) 검증 (**Property 22**)
    - 랜덤 입력에 대해 결과 완전성(안내 포함) + 미존재 조건 오류·입력 보존 검증 (**Property 23**)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8_
    - _Properties: 20, 21, 22, 23_

- [x] 8. 계산 결정성·근거·면책 고지 검증
  - [ ]* 8.1 결정성 및 결과 완전성 속성 기반 테스트 작성
    - `src/tests/property/calculators/determinism.property.test.ts` 생성
    - 랜덤 유효 입력에 대해 2~10회 반복 실행 시 계산 결과(총액/내역/적용세율·요율/근거) 동일 검증 (**Property 1**)
    - `src/tests/property/calculators/basis-disclaimer.property.test.ts` 생성
    - 랜덤 계산 결과에 대해 총액·항목별 내역·적용 세율/요율·과세표준·공제 구조화, 각 basis의 formula·rateTableItem 비어있지 않음, disclaimer 비어있지 않음 검증 (**Property 25**)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 1.11_
    - _Properties: 1, 25_

- [x] 9. 체크포인트 - 3개 계산기 및 결정성 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 10. 계약서 연동 어댑터 구현
  - [x] 10.1 계산기 연동 어댑터 구현
    - `src/modules/calculators/calculator-bridge-adapter/bridge-adapter.ts` 생성: `CalculatorBridgeAdapter` 클래스
      - 계약서 분석 서비스 `CalculatorInputSchema`(거래유형·보증금·월세·매매가·관리비·계약기간·면적, 각 단위) 소비
      - 단위 매핑: 금액=원, 면적=제곱미터, 계약 기간=개월 → 계산기 내부 입력(`AcquisitionCostInput`/`BrokerageFeeInput`)
      - 취득세·중개수수료 결과를 `CalculatorOutputSchema`(acquisitionTax/brokerageFee)로 반환
      - 필수 항목 누락 시 누락 항목명(`missingFields`) 반환, 계산 미수행
      - 계약서 서비스 장애가 직접 입력 계산에 영향 주지 않도록 격리
    - `src/modules/calculators/calculator-bridge-adapter/index.ts` 생성: `CalculatorBridgeModule` 클래스 (`ServiceModule` 구현)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 10.2 계약서 연동 속성 기반 테스트 작성
    - `src/tests/property/calculators/bridge-adapter.property.test.ts` 생성
    - 랜덤 표준 입력 스키마에 대해 단위 매핑(원/제곱미터/개월)·출력 스키마(acquisitionTax/brokerageFee) 반환 검증 (**Property 28**)
    - 필수 누락 랜덤에 대해 누락 항목명 반환·계산 미수행 검증 (**Property 29**)
    - _Requirements: 7.2, 7.3, 7.4_
    - _Properties: 28, 29_

- [x] 11. AI 자문 보조 채널 구현 (계산과 격리)
  - [x] 11.1 AI 자문 보조기 구현
    - `src/modules/calculators/ai-advisor-assist/ai-advisor.ts` 생성: `AiAdvisorAssist` 클래스
      - 질문 + 계산 컨텍스트(입력 조건·적용 세율/요율·과세표준·항목별 내역·총액)로 프롬프트 구성
      - 세율·세액 재계산 없이 설명·보완만 수행, 계산 결과 불변 보장(응답에 계산 결과 미포함/미변경)
      - 범위 판정: 부동산 취득·양도·중개보수·관련 세무 범위 외 질문은 `isOutOfScope=true` 자문 범위 안내
      - 면책 고지(참고용·법적 효력 없음·전문가 상담) 포함
      - 제공자 어댑터: 로컬 Gemini 경로 / 배포 세무 자문 서비스(real-estate-tax-ai-advisor) 위임, `AI_ADVISOR_PROVIDER` 교체
      - Circuit Breaker(`src/common/utils/circuit-breaker.ts` 재활용) + 30초 타임아웃, 실패/타임아웃 시 `isAvailable=false` 안내·계산 결과 유지
    - `src/modules/calculators/ai-advisor-assist/index.ts` 생성: `AiAdvisorAssistModule` 클래스 (`ServiceModule` 구현)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_

  - [ ]* 11.2 AI 자문 보조 속성 기반 테스트 작성
    - `src/tests/property/calculators/ai-advisor.property.test.ts` 생성
    - 랜덤 질문·결과에 대해 프롬프트 컨텍스트에 입력 조건·계산 결과 포함 검증 (**Property 30**)
    - 랜덤 결과 + 임의 AI 결과(성공/범위외/실패)에 대해 AI 실행 전후 계산 결과 불변 검증 (**Property 31**)
    - 범위 내/외 질문 랜덤에 대해 disclaimer 비어있지 않음·isOutOfScope 판정 검증 (**Property 32**)
    - AI 실패/타임아웃 모의에 대해 isAvailable=false·계산 결과 불변 검증 (**Property 33**)
    - _Requirements: 10.2, 10.4, 10.5, 10.6, 10.7, 10.8, 10.10_
    - _Properties: 30, 31, 32, 33_

- [x] 12. 오케스트레이터 및 Lambda 핸들러 구현
  - [x] 12.1 계산기 오케스트레이터 구현
    - `src/modules/calculators/orchestrator/calculator-orchestrator.ts` 생성: `CalculatorOrchestrator` 클래스
      - 계산 흐름 조율: 입력 검증 → 기준표 로드 → 계산기(취득/양도/중개) 실행 → 결과 구조화
      - 계약서 연동 경로: 어댑터 → 계산기 → 출력 스키마
      - AI 보조 경로는 계산 경로와 분리(별도 호출), AI 장애 격리
      - 검증 실패/조건 미존재/기준연도 미존재 시 표준 오류·입력 보존
    - _Requirements: 5.1, 5.2, 5.3, 7.1, 10.5_

  - [x] 12.2 Lambda 핸들러 및 API 라우팅 구현
    - `src/modules/calculators/handler.ts` 생성: Lambda 핸들러
      - `POST /calculators/acquisition`: 취득비용 계산
      - `POST /calculators/transfer-tax`: 양도세 계산
      - `POST /calculators/brokerage`: 중개수수료 계산
      - `POST /calculators/from-contract`: 계약서 연동 표준 스키마 기반 계산
      - `POST /calculators/ai-assist`: AI 자문 보조(계산 결과 컨텍스트 포함)
      - `GET /calculators/rate-tables`: 기준연도별 기준표/사용 가능 연도 조회
      - 오류 응답: 표준 `ErrorResponse` 형식, 한국어 사용자 대면 메시지
    - _Requirements: 9.1, 9.2, 9.4_

- [x] 13. 모듈 통합 팩토리 및 서비스 등록
  - [x] 13.1 모듈 팩토리 및 통합 구현
    - `src/modules/calculators/index.ts` 생성: `CalculatorsModuleFactory` 클래스
      - 전체 서브모듈 초기화 및 의존성 주입(기준표 관리기·검증기·3개 계산기·어댑터·AI 보조)
      - 서비스 등록/발견 메커니즘에 계산기 모듈 등록(servicePrefix: 'CALC')
      - 헬스체크: 각 서브모듈 상태 확인
      - AI 채널 장애가 계산 기능/기존 AI 자문 서비스에 전파되지 않도록 Circuit Breaker 적용
    - `src/modules/index.ts` 업데이트: `CalculatorsModuleFactory` import 및 등록 추가
    - _Requirements: 9.3, 9.5, 9.6, 9.7_

- [x] 14. 플랫폼 UI 통합 및 로컬 서버 연결
  - [x] 14.1 계산기 UI 카드 및 입력 폼·결과 표시 구현
    - `public/app.js` 업데이트: 3개 계산기 카드(🏠 취득비용/💸 양도세/📑 중개수수료) active 전환 로직 추가
      - 계산기별 구조화 입력 폼 렌더링(금액·조건·기준연도)
      - 계산 요청 후 총액·항목별 세부 내역·적용 근거·기준연도·버전·면책 고지 결과 표시
      - "AI에게 물어보기" 자연어 입력란 및 AI 응답 표시(계산 결과는 그대로 유지)
      - 입력 유효성 오류 시 항목별 오류 메시지 표시 및 입력값 보존
    - `public/index.html` 필요 시 계산기 카드/컨테이너 마크업 추가
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 10.1_

  - [x] 14.2 로컬 서버 계산기 라우팅 연결
    - `src/local-server/server.ts` 업데이트: `/calculators/*` 경로를 계산기 모듈 계산 함수/오케스트레이터에 연결
      - acquisition/transfer-tax/brokerage/from-contract/ai-assist/rate-tables 라우팅
      - AI 보조는 로컬 Gemini 경로 재사용
    - _Requirements: 8.1, 9.4, 10.1_

- [x] 15. 인프라 설정 (CDK 스택 - 독립 경량 스택)
  - [x] 15.1 계산기 Lambda·API 리소스 추가
    - 신규 `src/infrastructure/lib/calculators-stack.ts` 생성(기존 AI 자문 서비스와 독립 스택)
      - 순수 함수 계산 Lambda(경량, 벡터/OpenSearch 의존 없음): calculators-acquisition, calculators-transfer, calculators-brokerage, calculators-bridge, calculators-ai-assist
      - AI 보조 Lambda IAM 역할: 세무 자문 서비스 호출/Bedrock 호출 권한(계산 Lambda는 외부 의존 없음)
      - 선택적 DynamoDB `CALC#` 파티션 키 계산 이력 테이블(선택)
    - `src/infrastructure/lib/api-stack.ts` 업데이트: `/calculators/*` 경로 추가(Rate Limiting, CORS)
    - `src/infrastructure/bin`의 앱 엔트리에 `CalculatorsStack` 등록(독립 배포/롤백 가능)
    - _Requirements: 9.1, 9.2, 9.4, 9.6_

- [ ] 16. 통합 테스트 작성
  - [ ]* 16.1 통합 테스트 작성
    - `src/tests/integration/calculators/acquisition-flow.test.ts` 생성: 검증 → 기준표 로드 → 취득비용 계산 → 결과 구조 전체 파이프라인 테스트
    - `src/tests/integration/calculators/transfer-flow.test.ts` 생성: 12억 안분·비과세 판정·중과/단기 세율 흐름 테스트
    - `src/tests/integration/calculators/brokerage-flow.test.ts` 생성: 임대차 환산 경계·한도액 min·오피스텔 요율 흐름 테스트
    - `src/tests/integration/calculators/bridge-flow.test.ts` 생성: 계약서 표준 스키마 소비·출력 스키마 반환·필수 누락·계약서 장애 격리 테스트
    - `src/tests/integration/calculators/ai-assist-isolation.test.ts` 생성: AI 위임 호출·30초 타임아웃·실패 폴백·계산 결과 불변 테스트
    - `src/tests/integration/calculators/rate-table-year.test.ts` 생성: 기준연도별 버전 조회·미존재 목록 안내 테스트
    - AWS 서비스 모킹(aws-sdk-client-mock 활용)
    - _Requirements: 6.6, 7.3, 7.5, 9.4, 10.3, 10.8_

- [x] 17. 최종 체크포인트 - 전체 시스템 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

## Notes

- `*` 표시된 작업은 선택 사항으로 빠른 MVP를 위해 건너뛸 수 있습니다
- 각 작업은 구체적인 요구사항을 참조하여 추적 가능합니다
- 체크포인트에서 점진적 검증을 수행합니다
- 속성 기반 테스트는 설계 문서의 Correctness Properties(Property 1~34)를 모두 커버합니다
- 단위 테스트는 구체적 예시와 엣지 케이스를 검증합니다
- 모든 계산은 외부 의존 없는 결정론적 순수 함수로 수행합니다(참조 투명성)
- 세율·요율 기준표는 계산 로직과 분리된 상수 테이블(기준연도·버전 메타데이터)로 관리하며, 세율/요율 값은 참고용 추정치 상수입니다
- 기존 공통 모듈(`src/common/interfaces/service-module.ts`, `src/common/utils/circuit-breaker.ts`)을 최대한 재활용합니다
- 로컬 개발은 순수 함수 직접 실행과 로컬 서버 Gemini 경로(AI 보조)를 우선하며, 배포 시 AWS Lambda + 세무 자문 서비스 위임으로 교체합니다(`AI_ADVISOR_PROVIDER` 환경 변수)
- AI 자문 보조 채널은 계산 경로와 완전히 분리되어 있으며, Circuit Breaker와 30초 타임아웃으로 장애를 격리합니다. AI 채널 장애 시에도 계산 결과는 불변입니다
- 계약서 분석 서비스(real-estate-contract-analysis)의 calculator-bridge 표준 스키마를 어댑터를 통해 소비하며, 계약서 서비스 장애 시에도 직접 입력 계산이 정상 동작합니다
- 계산기 서비스는 기존 AI 자문 서비스와 독립 스택으로 배포/업데이트/롤백 가능합니다
- fast-check 라이브러리를 사용하여 속성 기반 테스트를 수행하며, 각 테스트는 최소 100회 반복 실행합니다

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1"] },
    { "id": 4, "tasks": ["2.3", "3.2", "4.1"] },
    { "id": 5, "tasks": ["4.2", "6.1", "7.1"] },
    { "id": 6, "tasks": ["6.2", "7.2", "8.1"] },
    { "id": 7, "tasks": ["10.1", "11.1"] },
    { "id": 8, "tasks": ["10.2", "11.2", "12.1"] },
    { "id": 9, "tasks": ["12.2", "13.1"] },
    { "id": 10, "tasks": ["14.1", "14.2"] },
    { "id": 11, "tasks": ["15.1"] },
    { "id": 12, "tasks": ["16.1"] }
  ]
}
```
