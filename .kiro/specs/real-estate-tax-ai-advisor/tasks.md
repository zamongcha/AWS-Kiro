# Implementation Plan: 부동산 세무 AI 자문 시스템

## Overview

기존 부동산 법률 AI 자문 시스템(real-estate-legal-ai-advisor)의 공유 인프라를 활용하여 부동산 세무 전문 RAG 기반 AI 자문 시스템을 구현한다. TypeScript/Node.js Lambda 함수를 중심으로 세무 전용 모듈을 `src/modules/tax-advisor/` 하위에 독립 배포 가능한 구조로 구축한다.

기존 법률 자문 시스템의 공통 인터페이스(`src/common/interfaces/`), 유틸리티(`src/common/utils/`), 플러그인 레지스트리(`src/common/plugin-registry.ts`)를 재활용하며, 세무 도메인 특화 기능(세율 계산기, 절세 포인트 엔진, 세무 동의어 사전, 수치 추출기)을 추가한다.

## Tasks

- [x] 1. 세무 자문 모듈 기본 구조 및 인터페이스 설정
  - [x] 1.1 세무 전용 디렉토리 구조 생성 및 타입 정의
    - `src/modules/tax-advisor/` 하위 디렉토리 생성:
      ```
      src/modules/tax-advisor/
      ├── tax-law-collector/
      ├── ruling-collector/
      ├── tax-search/
      ├── tax-response-generator/
      ├── tax-calculator/
      ├── tax-citation/
      └── tax-nlp/
      ```
    - `src/modules/tax-advisor/interfaces/tax-types.ts` 생성: `TaxType`, `TaxBracket`, `SpecialRate`, `Deduction`, `RateTableData` 타입 정의
    - `src/modules/tax-advisor/interfaces/tax-law.ts` 생성: `TaxLawArticle`, `RevisionEntry`, `TaxLawCollectorInput`, `TaxLawCollectorOutput` 인터페이스 정의
    - `src/modules/tax-advisor/interfaces/tax-ruling.ts` 생성: `TaxRuling`, `RulingType`, `RulingCollectorInput`, `RulingCollectorOutput` 인터페이스 정의
    - `src/modules/tax-advisor/interfaces/tax-search.ts` 생성: `TaxSearchInput`, `TaxSearchOutput`, `TaxSearchResult`, `ExtractedNumericInfo` 인터페이스 정의
    - `src/modules/tax-advisor/interfaces/tax-response.ts` 생성: `TaxResponseGeneratorInput`, `TaxResponseGeneratorOutput`, `TaxFormattedAnswer`, `TaxSavingTip`, `TaxCitation` 인터페이스 정의
    - `src/modules/tax-advisor/interfaces/tax-calculator.ts` 생성: `TaxCalculatorInput`, `TaxCalculationParams` (각 세목별), `TaxCalculationResult`, `CalculationStep`, `Exemption` 인터페이스 정의
    - `src/modules/tax-advisor/interfaces/index.ts` 생성: 전체 re-export
    - _Requirements: 10.6_

  - [x] 1.2 세무 전용 DynamoDB 데이터 모델 정의
    - `src/modules/tax-advisor/interfaces/dynamo-models.ts` 생성:
      - `TaxSessionRecord` (PK: TAX#SESSION#{sessionId})
      - `TaxDataManagementRecord` (PK: TAX#DATA#{dataType})
      - `TaxRateRecord` (PK: TAX#RATE#{taxType})
      - `TaxConversationEntry`
    - 파티션 키 접두사 규칙: 모든 세무 데이터는 "TAX#" 접두사 사용
    - _Requirements: 10.2_

- [x] 2. 세무 NLP 모듈 구현 (동의어 사전 + 일상 용어 매핑)
  - [x] 2.1 세무 동의어 사전 및 일상 용어 매핑 구현
    - `src/modules/tax-advisor/tax-nlp/index.ts` 생성: `TaxNLPModule` 클래스 (기존 `KoreanNLPModule` 확장)
    - `src/modules/tax-advisor/tax-nlp/tax-synonym-dictionary.ts` 생성: `TaxSynonymDictionary` 클래스
      - DynamoDB `SynonymDictionary` 테이블에서 세무 동의어 로드 (TAX# 접두사 활용)
      - `expandQuery()`: 세무 용어 동의어 확장
    - `src/modules/tax-advisor/tax-nlp/colloquial-mapper.ts` 생성: `ColloquialMapper` 클래스
      - 일상 용어→세무 전문 용어 매핑 (예: "집 팔 때 세금"→"양도소득세")
      - `mapColloquialToFormal()`: 일상 표현을 세무 용어로 변환
    - `src/modules/tax-advisor/tax-nlp/tax-type-classifier.ts` 생성: `TaxTypeClassifier` 클래스
      - 질문 텍스트에서 세목 분류 (취득세, 양도소득세, 종부세, 재산세, 증여세, 상속세)
      - 복합 세목 포함 질문 감지 및 분해
    - `src/modules/tax-advisor/tax-nlp/numeric-extractor.ts` 생성: `NumericExtractor` 클래스
      - 금액 패턴 추출 (원, 만원, 억원)
      - 면적 패턴 추출 (㎡, 평)
      - 기간 패턴 추출 (년, 개월)
      - 주택 수, 공시가격 등 세무 관련 수치 추출
    - `src/data/tax-synonyms.json` 생성: 초기 세무 동의어 데이터 (30개 이상)
    - `src/data/colloquial-mappings.json` 생성: 일상 용어→세무 용어 매핑 데이터 (20개 이상)
    - _Requirements: 11.2, 11.3, 11.6, 11.7, 3.5, 3.7_

  - [ ]* 2.2 세무 NLP 속성 기반 테스트 작성
    - **Property 21: 한국어 키워드 추출 범위** — `src/tests/property/tax-nlp-keywords.property.test.ts` 생성
    - 다양한 한국어 세무 질문에 대해 키워드 수가 1~10개 범위인지 검증
    - **Property 22: 동의어 및 일상 용어 검색 확장** — `src/tests/property/tax-synonym-expansion.property.test.ts` 생성
    - 동의어 사전/일상 용어 매핑에 등록된 용어가 질문에 포함 시 대응 용어가 검색 쿼리에 포함되는지 검증
    - **Property 23: NLP 실패 시 원본 보존** — `src/tests/property/tax-nlp-fallback.property.test.ts` 생성
    - 형태소 분석 실패/언어 인식 불가 입력 시 원본 텍스트 그대로 검색 쿼리 사용 검증
    - **Property 9: 수치 정보 추출 정확성** — `src/tests/property/numeric-extractor.property.test.ts` 생성
    - 금액/면적/기간 패턴 포함 문장에서 해당 수치를 올바른 필드에 추출하는지 검증
    - **Validates: Requirements 11.2, 11.3, 11.6, 11.7, 3.7**

- [x] 3. 세법 수집 모듈 구현
  - [x] 3.1 세법 수집기 핵심 로직 구현
    - `src/modules/tax-advisor/tax-law-collector/index.ts` 생성: `TaxLawCollectorModule` 클래스 (`ServiceModule` 인터페이스 구현, servicePrefix: 'TAX')
    - `src/modules/tax-advisor/tax-law-collector/tax-law-api-client.ts` 생성: 국가법령정보센터 Open API + 국세법령정보시스템 클라이언트
    - 수집 대상 세법 목록 관리: 소득세법, 지방세법, 종합부동산세법, 상속세 및 증여세법, 조세특례제한법
    - 구조화된 데이터 파싱: 법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력, 적용 세목, 세율 테이블 포함 여부
    - 재시도 로직: 5초 초기 간격 지수 백오프(배수 2), 최대 3회
    - 최대 재시도 실패 시 SNS 알림 발행
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 3.2 세율 테이블 추출 및 저장
    - `src/modules/tax-advisor/tax-law-collector/rate-table-extractor.ts` 생성: `RateTableExtractor` 클래스
      - 세법 조항에서 세율 테이블/계산식 감지 및 추출
      - `RateTableData` 구조로 변환 (brackets, specialRates, deductions)
      - 세율 구간(bracket)별 rate가 0~1 범위인지 검증
      - effectiveDate, sourceArticle 설정
    - `src/modules/tax-advisor/tax-law-collector/rate-table-storage.ts` 생성: DynamoDB 세율 테이블 저장 (PK: TAX#RATE#{taxType})
      - 버전 관리: 신규 버전 생성 시 이전 버전 expiryDate 설정
      - S3 `tax-data/rate-tables/{taxType}/{effectiveDate}.json` 백업 저장
    - _Requirements: 1.9, 9.8_

  - [x] 3.3 세법 데이터 저장 및 벡터 적재
    - `src/modules/tax-advisor/tax-law-collector/tax-law-storage.ts` 생성: S3 원본 저장 + DynamoDB 메타데이터 기록
      - S3 경로: `tax-data/raw/tax-laws/{law_id}/{version}/full.json`
      - DynamoDB: PK=TAX#DATA#law, SK=documentId
    - `src/modules/tax-advisor/tax-law-collector/tax-law-embedder.ts` 생성: Titan Embeddings V2 임베딩 변환 + OpenSearch `tax-laws` 인덱스 적재
      - 기존 `src/modules/search/embedding-client.ts` 재활용
      - 기존 `src/modules/search/opensearch-client.ts` 재활용 (인덱스명만 `tax-laws`로 변경)
      - 임베딩 실패 시 해당 조항 기록 후 나머지 계속 진행
    - _Requirements: 1.3, 1.4, 1.7, 1.8_

  - [x] 3.4 세법 수집 Lambda 핸들러
    - `src/modules/tax-advisor/tax-law-collector/handler.ts` 생성: Lambda 핸들러 (EventBridge 트리거, 매일 1회)
    - 개정 여부 감지 시 데이터 갱신 + 세율 테이블 재추출
    - SNS 실패 알림 통합
    - CloudWatch 로그 구성
    - _Requirements: 1.4, 1.6_

  - [ ]* 3.5 세법 수집기 속성 기반 테스트 작성
    - **Property 1: 데이터 구조 완전성** — `src/tests/property/tax-law-data-structure.property.test.ts` 생성
    - 랜덤 세법 원본 데이터 생성 후 필수 필드(법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력, 적용 세목) 포함 여부 검증
    - **Property 6: 세율 테이블 추출 정확성** — `src/tests/property/rate-table-extraction.property.test.ts` 생성
    - 세율표 포함 세법 조항 랜덤 생성 후 추출 결과가 최소 1개 bracket, rate 0~1, effectiveDate/sourceArticle 설정 검증
    - **Property 5: 부분 실패 시 계속 처리** — `src/tests/property/partial-failure.property.test.ts` 생성
    - 1~20개 조항 목록 + 랜덤 실패 위치에서 비실패 조항 정상 처리 검증
    - **Validates: Requirements 1.3, 1.8, 1.9**

- [x] 4. 예규/심판례 수집 모듈 구현
  - [x] 4.1 예규 수집기 핵심 로직 구현
    - `src/modules/tax-advisor/ruling-collector/index.ts` 생성: `RulingCollectorModule` 클래스 (`ServiceModule` 인터페이스 구현, servicePrefix: 'TAX')
    - `src/modules/tax-advisor/ruling-collector/ruling-api-client.ts` 생성: 국세법령정보시스템 API 클라이언트
    - 수집 대상 세목 카테고리: 취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세
    - 구조화된 데이터 파싱: 문서번호, 회신일자, 문서 유형(유권해석/예규/심판례), 세목 분류, 질의 요지, 회신 내용, 참조 세법 조항
    - 중복 판별: 동일 문서번호 존재 시 신규 저장 생략
    - 재시도 로직: 30초 고정 간격, 최대 3회
    - 최대 재시도 실패 시 SNS 알림 발행
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.8_

  - [x] 4.2 예규 청크 분할 및 벡터 적재
    - `src/modules/tax-advisor/ruling-collector/ruling-chunk-splitter.ts` 생성: 질의 요지/회신 내용을 500~1000 토큰 단위 청크 분할
      - 기존 `src/modules/case-collector/chunk-splitter.ts` 참조하여 동일 로직 적용
    - `src/modules/tax-advisor/ruling-collector/ruling-storage.ts` 생성: S3 원본 저장 + DynamoDB 메타데이터 기록
      - S3 경로: `tax-data/raw/rulings/{ruling_id}/full.json`, `tax-data/raw/rulings/{ruling_id}/chunks/`
      - DynamoDB: PK=TAX#DATA#ruling, SK=documentId
    - `src/modules/tax-advisor/ruling-collector/ruling-embedder.ts` 생성: 청크별 임베딩 변환 + OpenSearch `tax-rulings` 인덱스 적재
    - _Requirements: 2.3, 2.7_

  - [x] 4.3 예규 수집 Lambda 핸들러
    - `src/modules/tax-advisor/ruling-collector/handler.ts` 생성: Lambda 핸들러 (EventBridge 트리거, 24시간 간격)
    - SNS 실패 알림 통합
    - _Requirements: 2.4, 2.6_

  - [ ]* 4.4 예규 수집기 속성 기반 테스트 작성
    - **Property 1: 데이터 구조 완전성 (예규)** — `src/tests/property/ruling-data-structure.property.test.ts` 생성
    - 랜덤 예규 데이터 생성 후 필수 필드(문서번호, 회신일자, 문서 유형, 세목 분류, 질의 요지, 회신 내용, 참조 세법 조항) 포함 여부 검증
    - **Property 2: 청크 분할 라운드트립** — `src/tests/property/ruling-chunk-roundtrip.property.test.ts` 생성
    - 500~10000 토큰 랜덤 한국어 텍스트 청크 분할 후 결합 시 원본 동일 + 각 청크 500~1000 토큰 검증
    - **Property 3: 중복 제거 멱등성** — `src/tests/property/ruling-deduplication.property.test.ts` 생성
    - 동일 문서번호 N회(1~10) 삽입 시도 시 저장소에 1건만 존재 검증
    - **Property 4: 재시도 정책 준수** — `src/tests/property/ruling-retry-policy.property.test.ts` 생성
    - 랜덤 실패 패턴에서 최대 3회, 30초 고정 간격 준수 검증
    - **Validates: Requirements 2.3, 2.5, 2.7, 2.8**

- [x] 5. 체크포인트 - 데이터 수집 파이프라인 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 6. 세율 계산기 모듈 구현
  - [x] 6.1 세율 계산기 핵심 엔진 구현
    - `src/modules/tax-advisor/tax-calculator/index.ts` 생성: `TaxCalculatorModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/tax-advisor/tax-calculator/rate-table-loader.ts` 생성: DynamoDB에서 세율 테이블 로드 (TAX#RATE#{taxType})
      - effectiveDate 기준 유효한 세율 테이블 선택
    - `src/modules/tax-advisor/tax-calculator/param-validator.ts` 생성: 세목별 필수 파라미터 검증
      - 누락 필드 감지 시 isComplete=false, missingInfo 반환
    - `src/modules/tax-advisor/tax-calculator/bracket-matcher.ts` 생성: 금액에 해당하는 세율 구간 매칭
    - _Requirements: 5.1, 5.2, 5.3, 5.6_

  - [x] 6.2 세목별 계산 로직 구현
    - `src/modules/tax-advisor/tax-calculator/calculators/acquisition-tax.ts` 생성: 취득세 계산 (매매가격, 부동산 유형, 주택 수, 생애 최초 여부)
    - `src/modules/tax-advisor/tax-calculator/calculators/capital-gains-tax.ts` 생성: 양도소득세 계산 (취득가액, 양도가액, 보유기간, 주택 수, 거주기간)
    - `src/modules/tax-advisor/tax-calculator/calculators/comprehensive-property-tax.ts` 생성: 종합부동산세 계산 (공시가격, 주택 수)
    - `src/modules/tax-advisor/tax-calculator/calculators/property-tax.ts` 생성: 재산세 계산 (공시가격, 부동산 유형)
    - `src/modules/tax-advisor/tax-calculator/calculators/gift-tax.ts` 생성: 증여세 계산 (증여금액, 관계, 이전 증여액)
    - `src/modules/tax-advisor/tax-calculator/calculators/inheritance-tax.ts` 생성: 상속세 계산 (상속재산 총액, 채무액, 상속인 수)
    - 각 계산기는 calculationSteps 단계별 산식 기록, appliedArticle/appliedDate 설정
    - 감면/비과세 가능성(Exemption) 체크 포함
    - disclaimer 자동 포함
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8_

  - [ ]* 6.3 세율 계산기 속성 기반 테스트 작성
    - **Property 12: 세율 계산 구간 적용 정확성** — `src/tests/property/tax-bracket-matching.property.test.ts` 생성
    - 랜덤 금액 + 세율 테이블 조합에서 올바른 bracket의 rate 적용 검증
    - **Property 13: 계산 결과 출력 완전성** — `src/tests/property/tax-calculation-output.property.test.ts` 생성
    - 랜덤 유효 파라미터에서 calculationSteps 비어있지 않음, 마지막 step.amount == estimatedTax, appliedArticle/appliedDate 비어있지 않음, disclaimer 포함 검증
    - **Property 14: 불완전 파라미터 감지** — `src/tests/property/tax-param-validation.property.test.ts` 생성
    - 필수 필드 랜덤 제거 시 isComplete=false, missingInfo에 누락 필드 1개 이상 포함 검증
    - **Property 19: 세율 테이블 버전 관리** — `src/tests/property/rate-table-versioning.property.test.ts` 생성
    - 연속 갱신 시뮬레이션에서 version 증가, expiryDate 설정, effectiveDate > 이전 expiryDate 검증
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 9.8**

- [x] 7. 세무 검색 모듈 구현
  - [x] 7.1 세무 검색 엔진 구현
    - `src/modules/tax-advisor/tax-search/index.ts` 생성: `TaxSearchModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - 기존 `src/modules/search/embedding-client.ts` 재활용하여 질문 임베딩 변환 (3초 이내)
    - 기존 `src/modules/search/opensearch-client.ts` 재활용하여 `tax-laws`, `tax-rulings` 인덱스 검색
    - 유사도 점수 내림차순 정렬, 세법/예규 각 최대 5건 반환
    - 관련도 기준 미달 문서에 `isLowRelevance: true` 표시
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 7.2 세목 분해 및 수치 추출 연동
    - `src/modules/tax-advisor/tax-search/tax-query-processor.ts` 생성: 세무 질문 전처리 파이프라인
      - TaxNLPModule 호출: 형태소 분석 + 동의어 확장 + 일상 용어 매핑
      - TaxTypeClassifier 호출: 세목 분류 및 복합 세목 분해
      - NumericExtractor 호출: 수치 정보 추출 → 세율 계산기 전달용
      - 세목별 독립 검색 결과 집합 반환
    - 검색 실패 시 오류 메시지 반환 + 질문 텍스트 보존
    - _Requirements: 3.5, 3.6, 3.7, 11.6_

  - [ ]* 7.3 세무 검색 속성 기반 테스트 작성
    - **Property 7: 검색 결과 정렬 및 제한** — `src/tests/property/tax-search-results.property.test.ts` 생성
    - 랜덤 유사도 점수 1~20개 결과에서 내림차순 정렬, 각 유형 최대 5건, isLowRelevance 플래그 검증
    - **Property 8: 세목별 질문 분해 독립성** — `src/tests/property/tax-query-decomposition.property.test.ts` 생성
    - 2~6개 세목 포함 복합 질문에서 식별된 모든 세목에 대한 독립 결과 집합 반환 검증
    - **Validates: Requirements 3.3, 3.4, 3.5**

- [x] 8. 세무 응답 생성 모듈 구현
  - [x] 8.1 세무 전문가 응답 생성기 구현
    - `src/modules/tax-advisor/tax-response-generator/index.ts` 생성: `TaxResponseGeneratorModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/tax-advisor/tax-response-generator/tax-prompt-builder.ts` 생성: 세무 전문가 페르소나 프롬프트 템플릿
      - 검색 결과 + 질문 + 계산 결과 + 세션 컨텍스트 조합
      - 답변 구조 지시: 질문 요약 → 관련 세법 설명 → 관련 예규/심판례 설명 → 세율 계산 결과(해당 시) → 절세 포인트 → 종합 의견 → 참고 자료 목록
      - 답변 길이: 200자 이상 5000자 이하
      - 존댓말(해요체) 형식 지시
      - 세법 용어 부연 설명 지시
    - `src/modules/tax-advisor/tax-response-generator/bedrock-client.ts` 생성: Claude 3.5 Sonnet 호출 (60초 타임아웃)
      - 기존 `src/modules/response-generator/bedrock-client.ts` 참조하여 동일 패턴 적용
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 11.1, 11.5_

  - [x] 8.2 범위 판별, 절세 포인트 및 면책 고지 구현
    - `src/modules/tax-advisor/tax-response-generator/tax-scope-checker.ts` 생성: 부동산 세무 범위 판별
      - 지원 범위: 취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세
      - 범위 외 질문 시 isOutOfScope=true + 안내 메시지
    - `src/modules/tax-advisor/tax-response-generator/tax-saving-engine.ts` 생성: `TaxSavingEngine` 클래스
      - 거래 유형별 절세 포인트 생성 (title, description, legalBasis, conditions, cautions)
      - isLegal=true 항상 보장
      - 절세/탈세 구분 명시
      - 세무사 상담 권장 안내 포함
    - 면책 고지 자동 삽입: "본 답변은 참고용이며 법적 효력이 없고 실제 세무 신고 시 세무사 상담을 권장합니다"
    - 관련 세법/예규 미발견 시 답변 가능 범위 명시 + 추가 확인 사항 안내
    - _Requirements: 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 8.3 응답 생성 Lambda 핸들러
    - `src/modules/tax-advisor/tax-response-generator/handler.ts` 생성: Lambda 핸들러
    - LLM 호출 실패/60초 타임아웃 시 사용자 오류 안내 메시지 반환
    - _Requirements: 4.8_

  - [ ]* 8.4 응답 생성기 속성 기반 테스트 작성
    - **Property 10: 응답 구조 및 면책 고지 완전성** — `src/tests/property/tax-response-structure.property.test.ts` 생성
    - 다양한 검색 결과 + 계산 결과 조합에서 7개 섹션 순서 + 200~5000자 + 면책 고지 포함 검증
    - **Property 11: 범위 외 질문 거부** — `src/tests/property/tax-scope-rejection.property.test.ts` 생성
    - 비부동산세무 질문 랜덤 생성 시 isOutOfScope=true 반환 검증
    - **Property 15: 절세 포인트 구조 완전성** — `src/tests/property/tax-saving-tips.property.test.ts` 생성
    - 랜덤 거래 유형별 절세 팁에서 legalBasis/conditions/cautions 비어있지 않음 + isLegal=true 검증
    - **Validates: Requirements 4.4, 4.6, 4.7, 6.1, 6.2, 6.3, 6.5**

- [x] 9. 세무 인용 표시 모듈 구현
  - [x] 9.1 세무 인용 포맷터 구현
    - `src/modules/tax-advisor/tax-citation/index.ts` 생성: `TaxCitationModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/tax-advisor/tax-citation/tax-citation-formatter.ts` 생성:
      - 세법 인용: 법령명 + 조항 번호 + 100자 이내 요약
      - 예규/심판례 인용: 문서번호 + 회신일자 + 200자 이내 요지
      - 본문 내 [1], [2] 형식 각주 번호 삽입
      - 답변 하단 각주 번호 순 인용 목록 생성
    - `src/modules/tax-advisor/tax-citation/tax-url-resolver.ts` 생성: 세법/예규 원문 URL 생성 (국가법령정보센터, 국세법령정보시스템)
    - 개정된 세법 표시: isAmended=true일 때 currentInfo 포함
    - 인용 대상 없을 경우 안내 메시지
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 9.2 세무 인용 속성 기반 테스트 작성
    - **Property 16: 인용 각주 일관성** — `src/tests/property/tax-citation-consistency.property.test.ts` 생성
    - 1~10개 랜덤 인용 데이터에서 본문 [N]↔하단 N번째 1:1 대응, 세법 100자 이내, 예규 200자 이내, isAmended=true 시 currentInfo 비어있지 않음 검증
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5**

- [x] 10. 체크포인트 - 핵심 세무 모듈 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 11. 질문 처리 인터페이스 및 세션 관리
  - [x] 11.1 세무 질문 처리 오케스트레이터 구현
    - `src/modules/tax-advisor/query-handler/index.ts` 생성: `TaxQueryHandlerModule` 클래스
    - `src/modules/tax-advisor/query-handler/tax-input-validator.ts` 생성: 입력 길이 검증 (10~1000자), 빈 입력 거부
    - `src/modules/tax-advisor/query-handler/tax-session-manager.ts` 생성: DynamoDB 세션 CRUD
      - PK: TAX#SESSION#{sessionId}
      - 대화 이력 최대 50개 유지 (FIFO 삭제)
      - TTL 24시간
    - `src/modules/tax-advisor/query-handler/tax-orchestrator.ts` 생성: 전체 세무 질문-응답 파이프라인 조율
      - 입력 검증 → 세션 컨텍스트 조회 → NLP 전처리 → 세목 분류 → 검색 → 세율 계산(해당 시) → 응답 생성 → 인용 처리 → 세션 저장
    - 30초 전체 응답 타임아웃
    - 2초 이내 처리 상태 표시 시작
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 11.2 세무 질문 처리 Lambda 핸들러
    - `src/modules/tax-advisor/query-handler/handler.ts` 생성: Lambda 핸들러
      - `POST /tax-advisor/questions`: 질문 처리
      - `GET /tax-advisor/categories`: 세무 카테고리 목록 (취득세, 양도소득세, 종합부동산세, 재산세, 증여세, 상속세)
      - `POST /tax-advisor/feedback`: 피드백 수집
    - 30초 타임아웃 초과 시 안내 + 재시도 옵션
    - 구조화된 수치 입력 보조 필드 지원
    - _Requirements: 8.3, 8.4, 8.5, 8.9, 3.8_

  - [ ]* 11.3 세무 세션 관리 속성 기반 테스트 작성
    - **Property 17: 입력 길이 검증** — `src/tests/property/tax-input-validation.property.test.ts` 생성
    - 0~2000자 랜덤 유니코드 문자열에서 10자 미만 거부, 1000자 초과 거부, 10~1000자 허용 검증
    - **Property 18: 세션 크기 제한** — `src/tests/property/tax-session-limit.property.test.ts` 생성
    - 1~100개 대화 항목 삽입 시 50개 제한 + FIFO 삭제 검증
    - **Property 20: 파티션 키 서비스 격리** — `src/tests/property/tax-partition-key.property.test.ts` 생성
    - 랜덤 CRUD 작업에서 생성된 모든 PK가 "TAX#" 접두사로 시작 검증
    - **Validates: Requirements 8.1, 8.6, 8.8, 10.2**

- [ ] 12. CDK 인프라 추가 (세무 전용)
  - [x] 12.1 세무 전용 인프라 스택 구현
    - `src/infrastructure/lib/tax-advisor-stack.ts` 생성:
      - OpenSearch `tax-laws`, `tax-rulings` 인덱스 생성 (nori 분석기 + knn_vector 1024차원)
      - DynamoDB TaxRates 테이블 (또는 기존 테이블에 TAX#RATE# 파티션 키 활용)
      - S3 `tax-data/` 경로 정책
      - Lambda 함수 (세법 수집, 예규 수집, 세무 검색, 세무 응답 생성, 세율 계산, 세무 인용, 질문 처리) — 각 IAM 최소 권한
      - API Gateway `/tax-advisor/*` 리소스 및 메서드 추가 (기존 API Gateway 공유)
      - EventBridge Scheduler 규칙 (세법 수집 매일 1회, 예규 수집 24시간 간격)
      - SNS 토픽 (세무 수집 실패 알림)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 1.4, 1.6, 2.4, 2.6_

  - [x] 12.2 기존 CDK 스택에 세무 모듈 통합
    - `src/infrastructure/bin/app.ts` 업데이트: TaxAdvisorStack 추가
    - 기존 storage-stack에서 세무 모듈 접근 권한 부여 (OpenSearch, DynamoDB, S3 공유)
    - 법률 자문 시스템과의 장애 격리 확인 (별도 Lambda, 별도 인덱스)
    - _Requirements: 10.4, 10.5_

- [x] 13. 로컬 서버 Gemini 연동 업데이트
  - [x] 13.1 로컬 서버에 세율 계산기 연동 추가
    - `src/local-server/` 내 Gemini 기반 세무 프롬프트에 세율 계산기 호출 연동
    - 세율 계산 결과를 프롬프트 컨텍스트에 포함하는 로직 추가
    - 로컬 개발 환경에서 전체 세무 자문 파이프라인 테스트 가능하도록 구성
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 14. 통합 연결 및 전체 파이프라인 연동
  - [x] 14.1 모듈 간 연동 및 전체 파이프라인 통합
    - `src/modules/tax-advisor/query-handler/tax-orchestrator.ts` 업데이트: 실제 모듈 호출 연동
      - TaxNLPModule → TaxSearchModule → TaxCalculatorModule → TaxResponseGeneratorModule → TaxCitationModule
    - 플러그인 레지스트리에 모든 세무 모듈 등록 로직 추가
    - 모듈 간 오류 격리 확인 (Circuit Breaker 적용)
    - 법률 자문 시스템 장애 시 세무 시스템 정상 동작 확인
    - _Requirements: 10.4, 10.5, 10.6, 10.7_

  - [ ]* 14.2 통합 테스트 작성
    - `src/tests/integration/tax-question-flow.test.ts` 생성: 세무 질문-응답 전체 파이프라인 통합 테스트
      - 취득세 질문(금액 포함) → 세율 계산 + 법령/예규 기반 답변 수신
      - 양도소득세 질문 → 계산 단계별 설명 + 절세 포인트 포함 답변
      - 일상 용어 질문 → 세무 용어 매핑 정상 동작
    - `src/tests/integration/tax-data-collection.test.ts` 생성: 세법/예규 수집 파이프라인 통합 테스트
    - `src/tests/integration/tax-session-context.test.ts` 생성: 세무 세션 기반 후속 질문 컨텍스트 유지 테스트
    - `src/tests/integration/tax-legal-isolation.test.ts` 생성: 법률/세무 서비스 장애 격리 테스트
    - AWS 서비스 모킹 (aws-sdk-client-mock 활용)
    - _Requirements: 8.7, 10.5_

- [x] 15. 최종 체크포인트 - 전체 시스템 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

## Notes

- `*` 표시된 작업은 선택 사항으로 빠른 MVP를 위해 건너뛸 수 있습니다
- 각 작업은 구체적인 요구사항을 참조하여 추적 가능합니다
- 체크포인트에서 점진적 검증을 수행합니다
- 속성 기반 테스트(fast-check)는 설계 문서의 23개 Correctness Properties를 검증합니다
- 단위 테스트(Jest)는 구체적 예시와 엣지 케이스를 검증합니다
- 기존 법률 자문 시스템의 공통 모듈(`src/common/`, `src/modules/search/embedding-client.ts`, `src/modules/search/opensearch-client.ts`)을 최대한 재활용합니다
- 세무 전용 모듈은 `src/modules/tax-advisor/` 하위에 배치하여 법률 자문 시스템과 물리적으로 분리합니다
- 외부 API(국가법령정보센터, 국세법령정보시스템) 연동 시 실제 API 키 발급이 필요합니다
- OpenSearch Serverless 인덱스 매핑은 설계 문서의 `tax-laws`, `tax-rulings` 스키마를 적용합니다
- 모든 DynamoDB 파티션 키는 "TAX#" 접두사를 사용하여 법률 자문 데이터와 격리합니다

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2", "4.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "4.4"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3"] },
    { "id": 7, "tasks": ["7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3"] },
    { "id": 10, "tasks": ["8.4", "9.1"] },
    { "id": 11, "tasks": ["9.2", "11.1"] },
    { "id": 12, "tasks": ["11.2", "11.3"] },
    { "id": 13, "tasks": ["12.1"] },
    { "id": 14, "tasks": ["12.2", "13.1"] },
    { "id": 15, "tasks": ["14.1"] },
    { "id": 16, "tasks": ["14.2"] }
  ]
}
```
