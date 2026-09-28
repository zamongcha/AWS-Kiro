# Implementation Plan: 부동산 계약서 AI 분석 시스템

## Overview

기존 부동산 법률/세무 AI 자문 및 판례 검색 서비스의 공유 인프라(OpenSearch, DynamoDB, S3, API Gateway)를 활용하여 계약서 AI 분석 전용 RAG 기반 서비스를 구현한다. TypeScript/Node.js Lambda 함수를 중심으로 계약서 분석 전용 모듈을 `src/modules/` 하위에 독립 배포 가능한 구조로 구축하며, 데이터는 OpenSearch `contract-` 인덱스 접두사, DynamoDB `CONTRACT#` 파티션 키 접두사, S3 `contract-data/` 객체 접두사로 격리한다.

기존 시스템의 공통 인터페이스(`src/common/interfaces/`), 유틸리티(`src/common/utils/`), 플러그인 레지스트리(`src/common/plugin-registry.ts`), 임베딩/OpenSearch 클라이언트(`src/modules/search/`)를 재활용한다. 로컬 개발은 Gemini Vision 멀티모달 문서 인식(무료 API)과 Mock 모드를 우선하며, 배포 시 Amazon Bedrock(Claude 3.5 Sonnet, Titan Embeddings) + AWS Textract 정밀 OCR로 교체 가능하도록 공통 어댑터 인터페이스 뒤에 제공자를 둔다.

각 모듈은 표준 `ServiceModule` 인터페이스(`src/common/interfaces/service-module.ts`)와 공통 `ModuleInput`/`ModuleOutput`/`ErrorResponse` 타입을 준수한다.

## Tasks

- [x] 1. 계약서 분석 모듈 기본 구조 및 공통 타입 정의
  - [x] 1.1 계약서 분석 전용 디렉토리 구조 생성 및 공통 타입 정의
    - `src/modules/contract-analysis/` 하위 디렉토리 생성:
      ```
      src/modules/contract-analysis/
      ├── interfaces/
      ├── document-recognizer/
      ├── risk-detector/
      ├── risk-evaluator/
      ├── registry-matcher/
      ├── revision-advisor/
      ├── clause-recommender/
      ├── info-extractor/
      ├── comparator/
      ├── case-linker/
      ├── version-manager/
      ├── simulation-engine/
      ├── citation/
      ├── calculator-bridge/
      ├── upload/
      ├── checklist/
      ├── admin/
      ├── orchestrator/
      └── index.ts
      ```
    - `src/modules/contract-analysis/interfaces/types.ts` 생성: `ContractType`(sale/jeonse/wolse/commercial_lease), `PartyPerspective`(buyer/seller/landlord/tenant), `RiskGrade`(high/medium/low), `PartyImpact`(disadvantageous/neutral/advantageous), `ClauseSpan`, `BoundingBox` 타입 정의
    - `src/modules/contract-analysis/interfaces/index.ts` 생성: 전체 re-export
    - _Requirements: 16.7_

  - [x] 1.2 모듈별 입출력 인터페이스 정의
    - `src/modules/contract-analysis/interfaces/document-recognizer.ts`: `DocumentRecognizerInput`, `DocumentRecognizerOutput`, `RecognizedClause`, `OcrProvider`, `OcrRequest`, `OcrResult`, `OcrBlock` 정의
    - `src/modules/contract-analysis/interfaces/risk-detector.ts`: `RiskDetectorInput`, `RiskDetectorOutput`, `RiskClause`, `MissingClause` 정의
    - `src/modules/contract-analysis/interfaces/risk-evaluator.ts`: `RiskEvaluatorInput`, `RiskEvaluatorOutput`, `GradedRiskClause`, `FraudRiskScore`, `ExceededCriterion` 정의
    - `src/modules/contract-analysis/interfaces/registry-matcher.ts`: `RegistryMatcherInput`, `RegistryMatchResult`, `RegistryInfo` 정의
    - `src/modules/contract-analysis/interfaces/revision-advisor.ts`: `RevisionAdvisorInput`, `RevisionAdvisorOutput`, `RevisionSuggestion`, `ClauseJudgment`, `LegalReference` 정의
    - `src/modules/contract-analysis/interfaces/clause-recommender.ts`: `ClauseRecommenderInput`, `ClauseRecommenderOutput`, `RecommendedClause` 정의
    - `src/modules/contract-analysis/interfaces/info-extractor.ts`: `InfoExtractorInput`, `InfoExtractorOutput`, `ExtractedField` 정의
    - `src/modules/contract-analysis/interfaces/comparator.ts`: `ComparatorInput`, `ComparatorOutput`, `ClauseComparison` 정의
    - `src/modules/contract-analysis/interfaces/case-linker.ts`: `CaseLinkerInput`, `CaseLinkerOutput`, `ClauseLinkedCases`, `LinkedCase` 정의
    - `src/modules/contract-analysis/interfaces/version-manager.ts`: `VersionManagerInput`, `VersionManagerOutput`, `ContractVersion`, `VersionComparison`, `ClauseChange` 정의
    - `src/modules/contract-analysis/interfaces/simulation-engine.ts`: `SimulationEngineInput`, `ClauseChangeRequest`, `SimulationEngineOutput` 정의
    - `src/modules/contract-analysis/interfaces/citation.ts`: `CitationInput`, `CitationOutput`, `AnnotatedClause`, `Footnote` 정의
    - `src/modules/contract-analysis/interfaces/calculator-bridge.ts`: `CalculatorBridgeOutput`, `CalculatorInputSchema`, `CalculatorOutputSchema` 정의
    - `src/modules/contract-analysis/interfaces/checklist.ts`: `ChecklistItem`, `ContractChecklist` 정의
    - `src/modules/contract-analysis/interfaces/records.ts`: DynamoDB 레코드 타입(`ContractDocumentRecord`, `ContractVersionRecord`, `RuleSetMetadataRecord`) 정의
    - _Requirements: 16.7, 16.8_

  - [ ]* 1.3 모듈 입력 스키마 검증 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/schema-validation.property.test.ts` 생성
    - 스키마 위반 랜덤 입력에 대해 각 모듈이 입력을 거부하고 표준 `ErrorResponse`(스키마 불일치 코드)를 반환하는지 검증
    - **Property 40**
    - _Requirements: 16.7, 16.8_
    - _Properties: 40_

- [x] 2. 데이터 저장소 접근 계층 구현 (인프라 공유·데이터 격리)
  - [x] 2.1 DynamoDB 계약서 저장소 클라이언트 구현
    - `src/modules/contract-analysis/storage/dynamo-store.ts` 생성: `ContractDynamoStore` 클래스
      - 계약서 문서 레코드 CRUD (PK: `CONTRACT#DOC#{documentId}`, SK: `METADATA`)
      - 분석 결과 레코드 저장 (SK: `ANALYSIS#{timestamp}`)
      - 룰셋/표준계약서 메타데이터 레코드 (PK: `CONTRACT#RULESET#{type}` / `CONTRACT#STANDARD#{type}`)
      - 시스템 설정 레코드 (PK: `CONTRACT#CONFIG`, 전세사기 임계값 기본 70)
      - 모든 PK가 `CONTRACT#` 접두사로 시작하도록 강제하는 키 빌더 포함
      - 오류 발생 시 문서 식별자 24시간 TTL 보존
    - _Requirements: 12.2, 14.8, 16.2, 15.5_

  - [x] 2.2 OpenSearch 인덱스 클라이언트 및 인덱스 정의 구현
    - `src/modules/contract-analysis/storage/opensearch-store.ts` 생성: `ContractOpenSearchStore` 클래스
      - 기존 `src/modules/search/opensearch-client.ts` 재활용
      - 인덱스명 빌더: 반드시 `contract-` 접두사 강제 (`contract-toxic-rules`, `contract-standard-forms`)
      - 독소조항 룰셋 kNN 벡터 검색(1024차원), 표준계약서 조항 조회
    - `src/modules/contract-analysis/storage/index-mappings.ts` 생성: `contract-toxic-rules`, `contract-standard-forms` 인덱스 매핑 정의(nori analyzer, knn_vector)
    - _Requirements: 16.1_

  - [x] 2.3 S3 계약서 오브젝트 저장소 클라이언트 구현
    - `src/modules/contract-analysis/storage/s3-store.ts` 생성: `ContractS3Store` 클래스
      - `contract-data/` 접두사 강제 (uploads/recognized/config/processed)
      - 계약서·등기부등본 원본 저장/조회, 인식 텍스트 저장
    - _Requirements: 16.4_

  - [ ]* 2.4 데이터 격리 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/data-isolation.property.test.ts` 생성
    - 랜덤 인덱스 생성 요청에 대해 인덱스명이 항상 `contract-` 접두사로 시작하는지 검증 (**Property 38**)
    - 랜덤 DynamoDB 항목 생성에 대해 PK가 항상 `CONTRACT#` 접두사로 시작하는지 검증 (**Property 39**)
    - _Requirements: 16.1, 16.2_
    - _Properties: 38, 39_

- [ ] 3. 문서 인식 어댑터 및 파일 업로드 처리 구현
  - [x] 3.1 문서 인식 어댑터(Gemini Vision / Textract / Mock) 구현
    - `src/modules/contract-analysis/document-recognizer/providers/ocr-provider.ts` 생성: `OcrProvider` 인터페이스 재노출 및 팩토리
    - `src/modules/contract-analysis/document-recognizer/providers/gemini-vision-provider.ts` 생성: Gemini Vision 멀티모달 텍스트 추출(좌표 없음, 로컬 기본)
    - `src/modules/contract-analysis/document-recognizer/providers/textract-provider.ts` 생성: AWS Textract 정밀 OCR(좌표 포함 블록)
    - `src/modules/contract-analysis/document-recognizer/providers/mock-provider.ts` 생성: 결정적 Mock 추출(테스트/로컬용)
    - `OCR_PROVIDER` 환경 변수로 제공자 교체 (multimodal / textract_precise / mock)
    - _Requirements: 1.3, 1.11_

  - [ ] 3.2 업로드 검증 및 처리 구현
    - `src/modules/contract-analysis/upload/upload-validator.ts` 생성: `UploadValidator` 클래스
      - MIME 타입 검증: image/jpeg, image/png, application/pdf만 허용, 그 외 거부 및 지원 형식 안내
      - 파일 크기 검증: 1KB 이상 20MB 이하 허용, 벗어나면 거부 및 범위 안내
    - `src/modules/contract-analysis/upload/upload-handler.ts` 생성: `UploadHandler` 클래스
      - 검증 통과 시 S3 저장 및 중복되지 않는 고유 documentId 발급
      - DynamoDB 문서 레코드 저장, 처리 상태(uploaded) 반영
      - 검증 실패 시 파일 미저장 상태로 처리 중단
    - _Requirements: 1.1, 1.2, 1.6, 1.7_

  - [x] 3.3 문서 인식기 및 조항 분할 구현
    - `src/modules/contract-analysis/document-recognizer/index.ts` 생성: `DocumentRecognizerModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/document-recognizer/clause-splitter.ts` 생성: `ClauseSplitter` 클래스
      - 추출 텍스트를 최대 1000개 조항으로 분할, 각 조항에 문서 내 유일 clauseId와 위치 정보(startOffset/endOffset) 부여
      - startOffset/endOffset으로 원문을 잘라낸 결과가 조항 텍스트와 일치하도록 보장
    - `src/modules/contract-analysis/document-recognizer/recognition-validator.ts` 생성: 인식 결과 검증
      - 손상 파일 감지 시 오류 반환 및 재업로드 옵션
      - 120초 타임아웃 시 시간 초과 오류 반환 및 재시도 옵션(중간 결과 미저장)
      - 인식 텍스트 20자 미만이면 recognitionStatus=failed, 재업로드/직접입력 옵션
    - `src/modules/contract-analysis/upload/text-input-handler.ts` 생성: 사용자 직접 텍스트 입력 경로 처리
    - _Requirements: 1.3, 1.4, 1.5, 1.8, 1.9, 1.10, 1.12_

  - [ ]* 3.4 업로드 및 문서 인식 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/upload-recognition.property.test.ts` 생성
    - 랜덤 MIME 문자열(허용/비허용 혼합)에 대한 형식 판정 검증 (**Property 3**)
    - 0~30MB 랜덤 크기에 대한 1KB~20MB 경계 판정 검증 (**Property 4**)
    - 0~50000자 랜덤 한국어 텍스트 분할 시 조항 수 ≤1000, clauseId 유일성, 위치 정보 정합 검증 (**Property 2**)
    - 0~100자 랜덤 텍스트에 대해 20자 미만이면 failed 판정 검증 (**Property 5**)
    - 1~100회 업로드 시뮬레이션에서 documentId 집합 크기가 정확히 N인지(유일성) 검증 (**Property 1**)
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 1.10_
    - _Properties: 1, 2, 3, 4, 5_

- [x] 4. 계약 유형·당사자 관점 선택 및 룰셋 로딩 구현
  - [x] 4.1 계약 유형 추정 및 당사자 관점 제한 구현
    - `src/modules/contract-analysis/contract-context/type-estimator.ts` 생성: `ContractTypeEstimator` 클래스
      - 추출 텍스트로부터 계약 유형 추정 및 신뢰도 산출
      - 신뢰도 0.7 이상이면 사용자 확인 요청 상태, 미만이면 직접 선택 요청 상태
      - 확인 요청 30초 무응답 시 자동 확정 보류
    - `src/modules/contract-analysis/contract-context/perspective-restrictor.ts` 생성: `PerspectiveRestrictor` 클래스
      - 매매 → {매수인, 매도인}, 전세/월세/상가임대차 → {임차인, 임대인}으로 관점 제한
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 4.2 룰셋 로더 구현
    - `src/modules/contract-analysis/contract-context/ruleset-loader.ts` 생성: `RuleSetLoader` 클래스
      - 계약 유형별 독소조항 룰셋을 룰셋_저장소(OpenSearch/S3 config)에서 5초 이내 로드
      - 로드 실패 또는 5초 초과 시 오류 상태 반환 및 재시도 요청
    - _Requirements: 2.8, 2.9_

  - [ ]* 4.3 계약 유형·관점 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/contract-context.property.test.ts` 생성
    - 0.0~1.0 랜덤 신뢰도에 대해 0.7 임계값 기준 확인요청/직접선택 분기 검증 (**Property 6**)
    - 랜덤 ContractType에 대해 허용 관점 집합이 정확히 매핑되는지 검증 (**Property 7**)
    - _Requirements: 2.3, 2.4, 2.6, 2.7_
    - _Properties: 6, 7_

- [x] 5. 체크포인트 - 업로드·인식·컨텍스트 파이프라인 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 6. 위험조항 탐지기 구현
  - [x] 6.1 위험조항 탐지기 구현
    - `src/modules/contract-analysis/risk-detector/index.ts` 생성: `RiskDetectorModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/risk-detector/rule-matcher.ts` 생성: `RuleMatcher` 클래스
      - 조항을 계약 유형별 독소조항 룰셋과 대조(룰셋 매칭)
      - 기존 임베딩 클라이언트 재활용하여 조항 임베딩 후 벡터 유사도 검색
      - 룰셋 매칭 존재 또는 유사도 0.75 이상이면 위험 조항 판정
    - `src/modules/contract-analysis/risk-detector/missing-clause-checker.ts` 생성: `MissingClauseChecker` 클래스
      - 계약 유형별 필수 특약 목록과 대조하여 누락 특약 식별 (위험 조항 0건이어도 항상 별도 항목 제시)
    - `src/modules/contract-analysis/risk-detector/span-builder.ts` 생성: `ClauseSpanBuilder` 클래스
      - 원문 매칭 결과 생성: 매칭 길이 100자 미만이면 조항 전체, 5000자 초과 시 5000자까지 절단
    - 위험 조항 결과에 riskType, riskReason, partyImpact(불리/중립/유리), 선택 관점 기준 불리 여부(isDisadvantageous) 포함
    - 룰셋/벡터 저장소 접근 불가 시 탐지 중단·오류 반환·입력 데이터 보존, 조항당 30초 이내 완료
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 6.2 위험조항 탐지 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/risk-detection.property.test.ts` 생성
    - 랜덤 매칭여부 + 0.0~1.0 유사도에 대해 판정 규칙 검증 (**Property 8**)
    - 랜덤 위험 조항에 대해 필수 필드 비어있지 않음 + partyImpact 유효값 검증 (**Property 9**)
    - 위험 조항 0~N건 랜덤에 대해 missingClauses 항상 존재 검증 (**Property 10**)
    - 0~10000자 랜덤 조항에 대해 원문 매칭 길이 절단 규칙 검증 (**Property 11**)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
    - _Properties: 8, 9, 10, 11_

- [x] 7. 위험도 평가기 및 등기부 대조기 구현
  - [x] 7.1 위험도 평가기 구현
    - `src/modules/contract-analysis/risk-evaluator/index.ts` 생성: `RiskEvaluatorModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/risk-evaluator/grade-assigner.ts` 생성: `GradeAssigner` 클래스
      - 각 위험 조항에 위험도 등급(상/중/하) 정확히 하나 부여, 판정 기준(gradeCriteria) 함께 제공
      - 등급 미부여 또는 상/중/하 외 값이면 "상" 처리 + 등급 미확정 표시
      - 종합 등급 = 개별 등급 최고 등급, 위험 조항 0건이면 "하"
      - 등급-색상 매핑(상=red, 중=yellow, 하=green)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.10_

  - [x] 7.2 등기부 대조기 및 전세사기 스코어링 구현
    - `src/modules/contract-analysis/registry-matcher/index.ts` 생성: `RegistryMatcherModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/registry-matcher/registry-extractor.ts` 생성: `RegistryExtractor` 클래스
      - 등기부등본 파일(JPEG/PNG/PDF, ≤20MB) 검증 및 근저당 설정액·선순위 채권·소유자 정보 추출
      - 형식/크기 위반 거부 및 안내, 기존 입력 보존
      - 추출 실패 항목 명시 시 위험도 산출 미진행, 입력 보존
      - 외부 자동 조회 금지, 업로드 파일만 사용
    - `src/modules/contract-analysis/registry-matcher/fraud-scorer.ts` 생성: `FraudScorer` 클래스
      - 전세가율(보증금÷시세×100), 선순위 채권 비율(선순위÷시세×100) 계산
      - 전세사기 위험 점수 0~100 정수 산출
      - 전세가율≥80% or 선순위비율≥60% or 점수≥임계값(기본 70) 시 위험도 상 경고 + 초과 기준·수치 안내
      - 소유자 불일치 시 ownerMismatch 경고
    - 위험도 평가기에 등기부 대조 결과(fraudScore) 반영, 미업로드 시 산출 제한 안내
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 7.3 위험도 평가·전세사기 스코어링 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/risk-evaluation.property.test.ts` 생성
    - 랜덤 등급값(이상값 포함)에 대해 유효값/미확정 상 처리 검증 (**Property 12**)
    - 0~50개 랜덤 등급 목록에 대해 최고 등급/0건→하 검증 (**Property 13**)
    - 랜덤 등급에 대해 등급-색상 전단사 매핑 검증 (**Property 14**)
    - `src/tests/property/contract-analysis/fraud-scoring.property.test.ts` 생성
    - 랜덤 금액(시세>0)에 대해 전세가율·선순위 비율 계산식 검증 (**Property 15**)
    - 랜덤 등기부 입력에 대해 위험 점수 0~100 정수 검증 (**Property 16**)
    - 랜덤 수치에 대해 고위험 기준 초과 판정 + exceededCriteria 검증 (**Property 17**)
    - 랜덤 이름 쌍에 대해 소유자 불일치 감지 검증 (**Property 18**)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.5, 5.6, 5.7, 5.8_
    - _Properties: 12, 13, 14, 15, 16, 17, 18_

- [x] 8. 수정제안 생성기 및 특약 추천기 구현
  - [x] 8.1 수정제안 생성기 구현
    - `src/modules/contract-analysis/revision-advisor/index.ts` 생성: `RevisionAdvisorModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/revision-advisor/suggestion-generator.ts` 생성: `SuggestionGenerator` 클래스
      - mode=suggest: 위험 조항에 대해 당사자 관점 기준 수정 문안 1~5개를 30초 이내 생성
      - mode=judge: 조항 문구(1~2000자)의 법적 유효성·관점 유불리·주의사항 판단을 30초 이내 생성
      - 각 제안·판단에 근거 법조항/판례 최소 1건 명시, 없으면 hasExplicitBasis=false + 일반 주의사항만 제공
      - 존댓말(해요체/합쇼체) 형식, 면책 고지(disclaimer) 포함
      - 부동산 계약 범위 외 문의는 isOutOfScope=true, 판단 미생성
      - 생성 실패 시 오류 안내, 부분 결과 미저장
    - LLM 제공자는 Bedrock Claude / Gemini / Mock 어댑터로 교체 가능(`LLM_PROVIDER`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 8.2 특약 추천기 구현
    - `src/modules/contract-analysis/clause-recommender/index.ts` 생성: `ClauseRecommenderModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/clause-recommender/recommender.ts` 생성: `ClauseRecommender` 클래스
      - 계약 유형·당사자 관점 확정 시 3초 이내 권장 특약 1개 이상 추천
      - 권장 특약 없으면 hasRecommendations=false 안내(빈 목록 대신)
      - 각 추천에 특약 문안·추천 사유·관점 이점·근거 법조항/판례(1건 이상, 없으면 isBasisVerified=false) 제공
      - 누락 특약을 상단 우선순위(priority) 배치
      - 텍스트 편집 중단 2초 경과 시 추천 목록 갱신(디바운스)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 8.3 수정제안·특약 추천 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/revision-advice.property.test.ts` 생성
    - 랜덤 위험 조항에 대해 수정 제안 1~5개 검증 (**Property 19**)
    - 근거 0~N건에 대해 hasExplicitBasis 검증 (**Property 20**)
    - 랜덤 결과에 대해 disclaimer 비어있지 않음 검증 (**Property 21**)
    - 비부동산 문의 랜덤에 대해 isOutOfScope=true·판단 미생성 검증 (**Property 22**)
    - `src/tests/property/contract-analysis/clause-recommendation.property.test.ts` 생성
    - 누락+일반 특약 혼합에 대해 개수/누락 특약 우선 배치 검증 (**Property 28**)
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 11.1, 11.4_
    - _Properties: 19, 20, 21, 22, 28_

- [x] 9. 인용 표시기 및 판례 연동기 구현
  - [x] 9.1 인용 표시기 구현
    - `src/modules/contract-analysis/citation/index.ts` 생성: `CitationModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/citation/footnote-formatter.ts` 생성: `FootnoteFormatter` 클래스
      - 각 위험 조항에 근거 법조항(법령명·조항번호)·판례 각주 표시, 조항당 최대 5개
      - 본문 내 [1], [2] 각주 번호를 등장 순서대로 1부터 연속 부여, 하단 근거 목록과 1:1 대응
      - 근거 미발견 시 noBasisFound 표시(나머지 조항 각주는 계속 제공)
    - _Requirements: 7.1, 7.2, 7.6_

  - [x] 9.2 판례 연동기 구현
    - `src/modules/contract-analysis/case-linker/index.ts` 생성: `CaseLinkerModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/case-linker/case-search-client.ts` 생성: `CaseSearchClient` 클래스
      - 기존 판례 검색 서비스(real-estate-case-search) 내부 Lambda 호출 또는 `/case-search/analyze` API 호출
      - 위험 조항당 유사 분쟁 판례 최대 3건 검색
      - 각 판례의 사건번호·법원명·판결 요지·원문 링크 제공, URL 유효성 확인(urlVerified)
      - 10초 타임아웃/오류 시 판례 연동 생략 폴백(caseLinkAvailable=false) + 안내, 분석 결과 유지
    - _Requirements: 7.3, 7.4, 7.5, 7.7_

  - [ ]* 9.3 인용·판례 연동 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/citation.property.test.ts` 생성
    - 1~10개 랜덤 근거에 대해 각주 수 ≤5, 번호 연속성·목록 1:1 매핑 검증 (**Property 23**)
    - `src/tests/property/contract-analysis/case-linking.property.test.ts` 생성
    - 랜덤 판례 목록 + URL/비URL에 대해 조항당 ≤3건, urlVerified 판정 검증 (**Property 24**)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7_
    - _Properties: 23, 24_

- [x] 10. 체크포인트 - 탐지·평가·자문·연동 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 11. 정보 추출기·계산기 연동·비교 분석기 구현
  - [x] 11.1 정보 추출기 및 계산기 연동기 구현
    - `src/modules/contract-analysis/info-extractor/index.ts` 생성: `InfoExtractorModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/info-extractor/field-extractor.ts` 생성: `FieldExtractor` 클래스
      - 보증금·월세·매매가·관리비·계약기간·당사자·소재지·면적을 구조화 추출(필드명+값)
      - 금액=KRW, 면적=sqm, 기간=month 단위 부여
      - 값 확인 불가 시 isConfirmable=false("확인 불가") 처리하고 나머지 항목 계속 진행
      - 추출 실패 시 오류 메시지 반환
    - `src/modules/contract-analysis/calculator-bridge/index.ts` 생성: `CalculatorBridge` 클래스
      - 추출 정보를 취득세/중개수수료 계산기용 표준 인터페이스(입력/출력 스키마, 단위 명시)로 정리·전달
      - 금액 계산 자체는 수행하지 않음
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 11.2 비교 분석기 구현
    - `src/modules/contract-analysis/comparator/index.ts` 생성: `ComparatorModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/comparator/standard-form-loader.ts` 생성: 표준계약서를 표준계약서_저장소에서 5초 이내 로드, 없으면 비교 생략 안내, 로드 실패 시 오류·데이터 보존
    - `src/modules/contract-analysis/comparator/clause-comparator.ts` 생성: `ClauseComparator` 클래스
      - 표준계약서와 업로드 계약서를 조항 단위 대조하여 누락/변경/추가 식별
      - 각 비교 항목에 표준조항·업로드조항·차이유형 제공
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 11.3 정보 추출·비교 분석 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/info-extraction.property.test.ts` 생성
    - 랜덤 추출 결과에 대해 필드별 단위(KRW/sqm/month) 검증 (**Property 26**)
    - 일부 필드 누락 랜덤에 대해 미확인 표시 + 나머지 진행 검증 (**Property 27**)
    - `src/tests/property/contract-analysis/comparison.property.test.ts` 생성
    - 랜덤 표준/업로드 조항 조합에 대해 차이유형(누락/변경/추가) 분류 검증 (**Property 25**)
    - _Requirements: 8.2, 8.3, 8.4, 9.1, 9.3, 9.4_
    - _Properties: 25, 26, 27_

- [x] 12. 버전 관리기 및 시뮬레이션 엔진 구현
  - [x] 12.1 버전 관리기 구현
    - `src/modules/contract-analysis/version-manager/index.ts` 생성: `VersionManagerModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/version-manager/version-store.ts` 생성: `VersionStore` 클래스
      - action=save: 기존 버전 보존한 채 신규 버전 생성, 버전 번호 1부터 1씩 증가, 저장 일시(YYYY-MM-DD HH:mm:ss) 부여
      - DynamoDB `CONTRACT#{documentId}` 파티션 키, `VERSION#{zeroPadded}` 정렬 키 저장
      - 최소 10개 유지, 최대 50개 제한, 초과 시 버전 번호 최소값부터 FIFO 삭제
      - 저장 실패 시 기존 버전 보존·오류 반환·수정본 보존
    - `src/modules/contract-analysis/version-manager/version-comparator.ts` 생성: `VersionComparator` 클래스
      - action=compare: 두 버전 조항 단위 대조하여 추가/삭제/변경 구분, 5초 이내 반환
      - 각 버전 종합 위험도 등급 표시, gradeShift(상승/하락/동일) 산출
      - 비교 실패/5초 초과 시 오류·재시도·대상 데이터 무변경
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x] 12.2 시뮬레이션 엔진 구현
    - `src/modules/contract-analysis/simulation-engine/index.ts` 생성: `SimulationEngineModule` 클래스 (`ServiceModule` 구현)
    - `src/modules/contract-analysis/simulation-engine/simulator.ts` 생성: `Simulator` 클래스
      - 조항 변경안 1~20개 입력, 비어있거나 20개 초과 시 입력 오류·미수행
      - 원본과 분리된 가상 계약 상태 구성(원본 무변경 보장)
      - 변경 조항에 대해 위험조항 탐지기·위험도 평가기 재실행, 30초 이내 변경 후 종합 등급 산출
      - 변경 전/후 등급 대조: 한 단계 이상 낮아지면 개선, 높아지면 악화, 동일이면 동일
      - 재실행 실패/30초 초과 시 오류·재시도·원본 및 변경안 보존
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [ ]* 12.3 버전 관리·시뮬레이션 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/version-management.property.test.ts` 생성
    - 1~N회 순차 저장에 대해 버전 번호 연속 증가·기존 보존 검증 (**Property 29**)
    - 1~80회 저장에 대해 유지 수 ≤50·오래된 것부터 삭제 검증 (**Property 30**)
    - 랜덤 등급 쌍에 대해 gradeShift 판정 검증 (**Property 31**)
    - `src/tests/property/contract-analysis/simulation.property.test.ts` 생성
    - 0~30개 변경안에 대해 1~20개 허용/거부 판정 검증 (**Property 32**)
    - 랜덤 변경안에 대해 시뮬레이션 후 원본 상태 불변 검증 (**Property 33**)
    - 랜덤 전후 등급에 대해 comparison(개선/악화/동일) 판정 검증 (**Property 34**)
    - _Requirements: 12.1, 12.3, 12.4, 12.6, 13.1, 13.2, 13.4, 13.5, 13.6_
    - _Properties: 29, 30, 31, 32, 33, 34_

- [x] 13. 첨부서류 체크리스트 구현
  - [x] 13.1 첨부서류 체크리스트 서비스 구현
    - `src/modules/contract-analysis/checklist/checklist-service.ts` 생성: `ChecklistService` 클래스
      - 계약 유형 확정 시 3초 이내 필수 첨부서류 체크리스트 1개 이상 제공
      - 정의 없으면 대응 항목 없음 안내, 이전 입력 유지
      - 각 항목에 서류명·확인 목적 제공, 당사자 관점별 준비 주체 구분
      - 등기부등본 대조 완료 시 해당 항목 완료 표시, 불일치 시 완료 미표시 + 불일치 표시
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 14. 계약 유형별 시드 데이터 및 관리(admin) 구현
  - [x] 14.1 계약 유형별 룰셋·표준계약서·필수특약·체크리스트 시드 데이터 구축
    - `src/data/contract-toxic-rules.json` 생성: 매매/전세/월세/상가임대차별 독소조항 패턴·위험 유형·위험 사유·적용 관점·근거(각 유형당 최소 5개)
    - `src/data/contract-required-clauses.json` 생성: 계약 유형별 필수 특약 목록
    - `src/data/contract-standard-forms.json` 생성: 계약 유형별 표준계약서 조항
    - `src/data/contract-checklists.json` 생성: 계약 유형별 첨부서류 체크리스트(서류명·목적·준비 주체)
    - _Requirements: 15.1, 15.4_

  - [x] 14.2 관리(admin) 데이터 적재 파이프라인 구현
    - `src/modules/contract-analysis/admin/admin-service.ts` 생성: `ContractAdminService` 클래스
      - 룰셋/표준계약서 저장 시 각 독소조항 패턴을 임베딩 벡터로 변환하여 OpenSearch 적재
      - 개별 패턴 임베딩/적재 실패 시 실패 항목 기록·나머지 계속 진행·SNS 관리자 알림(failedPatterns)
      - 갱신 시각(UTC 타임스탬프)·단조 증가 버전 번호 메타데이터 관리
      - 갱신 성공/부분 실패 및 반영 버전 통지
      - 로드 실패 시 마지막 정상 버전으로 폴백·관리자 알림
    - _Requirements: 15.2, 15.3, 15.5, 15.6, 15.7_

  - [ ]* 14.3 데이터 적재·버전 관리 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/admin-loading.property.test.ts` 생성
    - 1~20개 패턴 + 랜덤 실패 위치에 대해 비실패 패턴 정상 적재·failedPatterns 기록 검증 (**Property 36**)
    - 연속 갱신 시뮬레이션에 대해 버전 번호 단조 증가·UTC 타임스탬프 보유 검증 (**Property 37**)
    - _Requirements: 15.3, 15.5_
    - _Properties: 36, 37_

- [x] 15. 오케스트레이터 및 Lambda 핸들러 구현
  - [x] 15.1 계약서 분석 오케스트레이터 구현
    - `src/modules/contract-analysis/orchestrator/analysis-orchestrator.ts` 생성: `AnalysisOrchestrator` 클래스
      - 전체 파이프라인 조율: 인식 → 정보 추출 → 룰셋 로드 → 위험조항 탐지 → 위험도 평가(+등기부) → 수정 제안 → 판례 연동 → 인용 → 비교 → 체크리스트 → 저장
      - 요청 접수 3초 이내 처리 상태 표시 시작, 5초 이하 간격 갱신
      - 문서 인식 제외 조항 분석 90초 이내 완료, 초과 시 안내·최대 1회 자동 재시도·이후 수동 재시도 옵션
      - 결과를 종합 위험도 → 위험 조항 목록 → 누락 특약 → 수정 제안 → 근거 각주 → 추출 정보 요약 → 첨부서류 체크리스트 순서로 구조화
      - 분석 대상 조항 0건이면 추출 정보 요약·체크리스트만 반환
      - 존댓말 한국어 응답, 오류 시 문서 식별자 24시간 보존
      - 부분 실패 대응(Graceful Degradation): 판례 연동·수정 제안·비교·등기부 대조 실패 시 핵심 결과만 반환
    - _Requirements: 3.5, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 15.2 Lambda 핸들러 및 API 라우팅 구현
    - `src/modules/contract-analysis/handler.ts` 생성: Lambda 핸들러
      - `POST /contract-analysis/upload`: 계약서 파일 업로드
      - `POST /contract-analysis/analyze`: documentId·계약유형·당사자관점 기반 분석
      - `POST /contract-analysis/registry`: 등기부등본 업로드·대조
      - `POST /contract-analysis/advise`: 조항 판단/수정 제안(mode=suggest|judge)
      - `GET /contract-analysis/recommendations`: 실시간 특약 추천
      - `POST /contract-analysis/versions`, `GET /contract-analysis/versions/compare`: 버전 저장/비교
      - `POST /contract-analysis/simulate`: 협상 시나리오 시뮬레이션
      - `GET /contract-analysis/checklist`: 첨부서류 체크리스트
      - `POST /contract-analysis/admin/rulesets`: 관리자 룰셋/표준계약서 갱신
      - 오류 응답: 표준 `ErrorResponse` 형식, 한국어 사용자 대면 메시지
    - _Requirements: 16.3_

  - [ ]* 15.3 분석 결과 구조 순서 속성 기반 테스트 작성
    - `src/tests/property/contract-analysis/result-structure.property.test.ts` 생성
    - 랜덤 분석 결과에 대해 섹션 순서(종합 위험도→위험 조항→누락 특약→수정 제안→근거 각주→추출 정보→체크리스트) 검증 (**Property 35**)
    - _Requirements: 14.3_
    - _Properties: 35_

- [x] 16. 모듈 통합 팩토리 및 플러그인 레지스트리 등록
  - [x] 16.1 모듈 팩토리 및 통합 구현
    - `src/modules/contract-analysis/index.ts` 생성: `ContractAnalysisModuleFactory` 클래스
      - 전체 서브모듈 초기화 및 의존성 주입
      - 플러그인 레지스트리에 계약서 분석 모듈 등록 (servicePrefix: 'CONTRACT')
      - 헬스체크 구현: 각 서브모듈 상태 확인
      - 오류 격리: 계약서 분석 모듈 장애가 기존 법률/세무/판례 모듈에 전파되지 않도록 Circuit Breaker(`src/common/utils/circuit-breaker.ts`) 적용
    - `src/modules/index.ts` 업데이트: `ContractAnalysisModuleFactory` import 및 등록 추가
    - _Requirements: 16.5, 16.6_

- [x] 17. 인프라 설정 (CDK 스택 확장)
  - [x] 17.1 계약서 분석 Lambda·API·저장소 리소스 추가
    - `src/infrastructure/lib/compute-stack.ts` 업데이트: 계약서 분석 Lambda 함수 추가
      - contract-upload, contract-analyze, contract-registry, contract-advise, contract-version, contract-simulate, contract-admin Lambda
      - 각 Lambda IAM 역할: OpenSearch `contract-*` 인덱스 읽기/쓰기, DynamoDB `CONTRACT#` 접두사 읽기/쓰기, S3 `contract-data/` 접두사, Bedrock/Textract 호출, 판례 서비스 호출 권한
    - `src/infrastructure/lib/api-stack.ts` 업데이트: `/contract-analysis/*` 경로 추가 (Rate Limiting, CORS)
    - `src/infrastructure/lib/case-search-stack.ts` 또는 신규 `contract-analysis-stack.ts`: `contract-toxic-rules`, `contract-standard-forms` OpenSearch 인덱스, SNS 적재 실패 토픽 정의
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [x] 18. 체크포인트 - 전체 모듈 통합 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [ ] 19. 통합 테스트 작성
  - [ ]* 19.1 통합 테스트 작성
    - `src/tests/integration/contract-analysis/analyze-flow.test.ts` 생성: 업로드 → 인식 → 위험 탐지 → 위험도 평가 → 수정 제안 → 각주 → 체크리스트 전체 파이프라인 테스트
    - `src/tests/integration/contract-analysis/registry-fraud.test.ts` 생성: 등기부 대조·전세사기 스코어링·소유자 불일치 테스트
    - `src/tests/integration/contract-analysis/case-linking.test.ts` 생성: 판례 연동 호출·10초 타임아웃·실패 폴백 테스트
    - `src/tests/integration/contract-analysis/version-simulation.test.ts` 생성: 버전 저장/비교·시뮬레이션 원본 무변경 테스트
    - `src/tests/integration/contract-analysis/comparison-calculator.test.ts` 생성: 표준계약서 비교·계산기 연동 표준 인터페이스 전달 테스트
    - `src/tests/integration/contract-analysis/error-isolation.test.ts` 생성: 판례/법률/세무 서비스 장애 시 계약서 분석 정상 동작 테스트
    - `src/tests/integration/contract-analysis/admin-loading.test.ts` 생성: 룰셋 갱신·부분 적재 실패 알림 테스트
    - AWS 서비스 모킹 (aws-sdk-client-mock 활용)
    - _Requirements: 5.7, 7.5, 8.2, 12.5, 13.2, 15.3, 16.6_

- [x] 20. 최종 체크포인트 - 전체 시스템 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

## Notes

- `*` 표시된 작업은 선택 사항으로 빠른 MVP를 위해 건너뛸 수 있습니다
- 각 작업은 구체적인 요구사항을 참조하여 추적 가능합니다
- 체크포인트에서 점진적 검증을 수행합니다
- 속성 기반 테스트는 설계 문서의 Correctness Properties(Property 1~40)를 모두 커버합니다
- 단위 테스트는 구체적 예시와 엣지 케이스를 검증합니다
- 기존 공통 모듈(`src/common/`, `src/modules/search/`)을 최대한 재활용합니다
- 로컬 개발은 Gemini Vision 멀티모달 인식과 Mock 모드를 우선하며, 배포 시 Bedrock/Textract로 교체합니다 (`OCR_PROVIDER`, `LLM_PROVIDER` 환경 변수)
- OpenSearch는 `contract-` 인덱스 접두사, DynamoDB는 `CONTRACT#` 파티션 키 접두사, S3는 `contract-data/` 객체 접두사로 데이터를 격리합니다
- 판례 검색 서비스(real-estate-case-search)는 판례 연동기를 통해 호출하며, 장애 시 판례 연동을 제외한 분석을 계속합니다
- 계산기 연동기는 취득세/중개수수료 계산기용 표준 인터페이스 전달만 수행하고 금액 계산은 하지 않습니다
- 계약서 분석 모듈의 오류가 기존 서비스에 전파되지 않도록 Circuit Breaker를 적용합니다
- fast-check 라이브러리를 사용하여 속성 기반 테스트를 수행하며, 각 테스트는 최소 100회 반복 실행합니다

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3"] },
    { "id": 5, "tasks": ["3.4", "4.1", "4.2"] },
    { "id": 6, "tasks": ["4.3", "6.1"] },
    { "id": 7, "tasks": ["6.2", "7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3", "8.1", "8.2"] },
    { "id": 9, "tasks": ["8.3", "9.1", "9.2"] },
    { "id": 10, "tasks": ["9.3", "11.1", "11.2"] },
    { "id": 11, "tasks": ["11.3", "12.1", "12.2"] },
    { "id": 12, "tasks": ["12.3", "13.1", "14.1"] },
    { "id": 13, "tasks": ["14.2", "15.1"] },
    { "id": 14, "tasks": ["14.3", "15.2"] },
    { "id": 15, "tasks": ["15.3", "16.1"] },
    { "id": 16, "tasks": ["17.1"] },
    { "id": 17, "tasks": ["19.1"] }
  ]
}
```
