# Implementation Plan: 부동산 판례 검색 및 분석 서비스

## Overview

기존 부동산 법률 AI 자문 시스템(real-estate-legal-ai-advisor)의 공유 인프라를 활용하여 부동산 판례 검색 및 분석 전용 RAG 기반 서비스를 구현한다. TypeScript/Node.js Lambda 함수를 중심으로 판례 검색 전용 모듈을 `src/modules/case-search/` 하위에 독립 배포 가능한 구조로 구축한다.

기존 시스템의 공통 인터페이스(`src/common/interfaces/`), 유틸리티(`src/common/utils/`), 플러그인 레지스트리(`src/common/plugin-registry.ts`), 검색 클라이언트(`src/modules/search/embedding-client.ts`, `src/modules/search/opensearch-client.ts`), 한국어 NLP(`src/modules/search/korean-nlp.ts`, `src/modules/search/synonym-dictionary.ts`)를 재활용하며, 판례 검색 도메인 특화 기능(사실관계 분석, 비교 분석, 트렌드 분석, 카테고리 탐색)을 추가한다.

## Tasks

- [x] 1. 판례 검색 모듈 기본 구조 및 인터페이스 설정
  - [x] 1.1 판례 검색 전용 디렉토리 구조 생성 및 타입 정의
    - `src/modules/case-search/` 하위 디렉토리 생성:
      ```
      src/modules/case-search/
      ├── interfaces/
      ├── fact-analysis/
      ├── case-search-engine/
      ├── case-analysis/
      ├── comparison/
      ├── trend-analysis/
      ├── case-citation/
      ├── category-browse/
      ├── query-handler/
      └── index.ts
      ```
    - `src/modules/case-search/interfaces/types.ts` 생성: `DisputeType`, `PartyRelation`, `SearchQuery`, `CaseSearchResult`, `SimilarityDetail` 타입 정의
    - `src/modules/case-search/interfaces/fact-analysis.ts` 생성: `FactAnalysisInput`, `FactAnalysisOutput` 인터페이스 정의
    - `src/modules/case-search/interfaces/case-search.ts` 생성: `CaseSearchModuleInput`, `CaseSearchModuleOutput` 인터페이스 정의
    - `src/modules/case-search/interfaces/case-analysis.ts` 생성: `CaseAnalysisInput`, `CaseAnalysisResponse`, `IndividualCaseAnalysis` 인터페이스 정의
    - `src/modules/case-search/interfaces/comparison.ts` 생성: `ComparisonInput`, `ComparisonResult`, `ComparedCase` 인터페이스 정의
    - `src/modules/case-search/interfaces/trend.ts` 생성: `TrendInput`, `TrendResult`, `TrendChange`, `LawChange` 인터페이스 정의
    - `src/modules/case-search/interfaces/citation.ts` 생성: `CaseCitation` 인터페이스 정의
    - `src/modules/case-search/interfaces/category.ts` 생성: `CategoryListInput`, `CategoryListOutput`, `CategoryCaseItem`, `SubCategory`, `CaseDetailInput`, `CaseDetailOutput` 인터페이스 정의
    - `src/modules/case-search/interfaces/session.ts` 생성: `CaseSearchSessionRecord`, `CaseSearchConversation`, `CaseSearchHistoryRecord` 인터페이스 정의
    - `src/modules/case-search/interfaces/index.ts` 생성: 전체 re-export
    - _Requirements: 10.4, 10.5_

  - [x] 1.2 판례 검색 전용 입출력 인터페이스 정의
    - `src/modules/case-search/interfaces/input-output.ts` 생성: `CaseSearchInput`, `CaseSearchOutput`, `InputValidationResult` 인터페이스 정의
    - 입력 검증: situationDescription (20~2000자), sessionId (선택)
    - 출력 구조: sessionId, analysis (CaseAnalysisResponse), processingTimeMs
    - _Requirements: 1.1, 1.5, 10.5_

- [x] 2. 입력 처리 및 세션 관리 구현
  - [x] 2.1 입력 검증기 구현
    - `src/modules/case-search/query-handler/input-validator.ts` 생성: `CaseSearchInputValidator` 클래스
      - 입력 길이 검증: 20자 미만 거부, 2000자 초과 거부
      - 빈 입력 거부
      - 검증 실패 시 한국어 안내 메시지 반환 (예: "분쟁 상황을 20자 이상으로 구체적으로 설명해 주세요.")
      - 입력 텍스트 정제(sanitize) 처리
    - _Requirements: 1.1, 1.5_

  - [x] 2.2 세션 관리자 구현
    - `src/modules/case-search/query-handler/session-manager.ts` 생성: `CaseSearchSessionManager` 클래스
      - DynamoDB 세션 CRUD (PK: `CASE_SEARCH#SESSION#{sessionId}`)
      - 대화 이력 최대 30개 유지 (초과 시 가장 오래된 항목 FIFO 제거)
      - TTL 기반 자동 만료 (24시간)
      - 세션 컨텍스트 조회 (후속 질문 처리용)
    - `src/modules/case-search/query-handler/history-recorder.ts` 생성: `SearchHistoryRecorder` 클래스
      - 검색 이력 DynamoDB 기록 (PK: `CASE_SEARCH#HISTORY#{date}`)
      - 분쟁 유형, 검색 쿼리, 결과 수, 최고 유사도 점수 기록
    - _Requirements: 8.1, 8.2, 10.2_

  - [ ]* 2.3 입력 검증 및 세션 관리 속성 기반 테스트 작성
    - **Property 1: 입력 길이 검증** — `src/tests/property/case-search/input-validation.property.test.ts` 생성
    - 0~3000자 범위의 랜덤 유니코드(한국어 포함) 문자열에 대해 20자 미만 거부, 2000자 초과 거부, 20~2000자 허용 검증
    - **Property 10: 세션 크기 제한** — `src/tests/property/case-search/session-limit.property.test.ts` 생성
    - 1~60개 랜덤 대화 항목 삽입 시 최대 30개 유지, 초과 시 가장 오래된 항목 제거 검증
    - **Validates: Requirements 1.1, 1.5, 8.1**

- [x] 3. 사실관계 분석 모듈 구현
  - [x] 3.1 사실관계 분석기 구현
    - `src/modules/case-search/fact-analysis/index.ts` 생성: `FactAnalysisModule` 클래스
    - `src/modules/case-search/fact-analysis/fact-extractor.ts` 생성: `FactExtractor` 클래스
      - Bedrock Claude 3.5 Sonnet 호출하여 사실관계 추출
      - 프롬프트: 사용자 상황 설명에서 분쟁유형, 당사자관계, 핵심사실, 법적쟁점 추출 지시
      - LLM 응답 JSON 파싱 및 FactAnalysisOutput 구조 검증
    - `src/modules/case-search/fact-analysis/dispute-classifier.ts` 생성: `DisputeClassifier` 클래스
      - 5가지 분쟁유형 분류: lease, sale, registration, brokerage, redevelopment
      - 복수 분쟁유형 분류 지원 (1개 이상)
      - 부동산 관련 분쟁이 아닌 경우 감지 및 안내 메시지 생성
    - `src/modules/case-search/fact-analysis/search-query-builder.ts` 생성: `SearchQueryBuilder` 클래스
      - 핵심 사실관계와 법적 쟁점을 검색 쿼리로 변환
      - 동의어 확장 (기존 `SynonymDictionary` 재활용)
      - 분쟁유형별 필터 조건 생성
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 9.2, 9.3_

  - [ ]* 3.2 사실관계 분석 속성 기반 테스트 작성
    - **Property 2: 사실관계 분석 출력 구조 완전성** — `src/tests/property/case-search/fact-analysis-output.property.test.ts` 생성
    - 다양한 FactAnalysisOutput에 대해 disputeTypes 1개 이상 유효값 포함, keyFacts 1개 이상, legalIssues 1개 이상, searchQueries 1개 이상 비어있지 않은 쿼리 검증
    - **Property 5: 검색 쿼리 분쟁유형 필터 적용** — `src/tests/property/case-search/query-filter.property.test.ts` 생성
    - 랜덤 DisputeType 조합 + SearchQuery에 대해 생성된 OpenSearch 요청에 case_type 필터가 반드시 포함되고 분류된 분쟁유형과 일치하는지 검증
    - **Property 11: 동의어 검색 확장** — `src/tests/property/case-search/synonym-expansion.property.test.ts` 생성
    - 동의어 사전 등록 용어가 입력에 포함 시 모든 등록 동의어가 검색 쿼리에 포함되는지 검증
    - **Validates: Requirements 1.2, 1.3, 1.4, 2.2, 9.2, 9.3**

- [x] 4. 판례 검색 엔진 구현
  - [x] 4.1 판례 검색 엔진 구현
    - `src/modules/case-search/case-search-engine/index.ts` 생성: `CaseSearchEngineModule` 클래스
    - `src/modules/case-search/case-search-engine/vector-search.ts` 생성: `CaseVectorSearch` 클래스
      - 기존 `embedding-client.ts` 재활용하여 사실관계 임베딩 변환
      - 기존 `opensearch-client.ts` 재활용하여 court-cases 인덱스 kNN 검색
      - 하이브리드 검색: 벡터 유사도 + case_type 필터 + court_level 부스팅(대법원 우선) + 시간 부스팅(최근 판결)
      - 최대 10건 결과 반환
    - `src/modules/case-search/case-search-engine/relevance-scorer.ts` 생성: `RelevanceScorer` 클래스
      - 사실관계 유사도 점수 0.0~1.0 정규화
      - 유사도 내림차순 정렬
      - 동일 유사도 시 대법원 판례 우선
      - 저관련도 감지: 전체 결과 유사도 0.3 미만 시 isLowRelevance = true
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.1_

  - [ ]* 4.2 판례 검색 속성 기반 테스트 작성
    - **Property 3: 검색 결과 정렬 및 제한** — `src/tests/property/case-search/search-results-order.property.test.ts` 생성
    - 1~30건의 랜덤 CaseSearchResult(랜덤 유사도, 랜덤 법원등급)에 대해 최대 10건, 유사도 내림차순, 동일 유사도 시 대법원 우선 검증
    - **Property 4: 저관련도 감지** — `src/tests/property/case-search/low-relevance-detection.property.test.ts` 생성
    - 0.0~1.0 범위의 랜덤 유사도 점수 목록에 대해 전체 0.3 미만이면 isLowRelevance=true, 0.3 이상 1건 이상이면 false 검증
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6**

- [x] 5. 체크포인트 - 입력 처리 및 검색 파이프라인 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 6. 판례 분석 모듈 구현
  - [x] 6.1 판례 분석기 구현
    - `src/modules/case-search/case-analysis/index.ts` 생성: `CaseAnalysisModule` 클래스
    - `src/modules/case-search/case-analysis/case-analyzer.ts` 생성: `CaseAnalyzer` 클래스
      - Bedrock Claude 3.5 Sonnet 호출하여 개별 판례 분석
      - 프롬프트: 판결 요지, 핵심 쟁점, 판결 이유, 실무 시사점 추출 지시
      - 사용자 상황과의 유사점/차이점 비교 지시
      - 법률 용어 부연 설명 지시 포함
      - 한국어 존댓말(해요체) 응답 지시
    - `src/modules/case-search/case-analysis/response-builder.ts` 생성: `CaseAnalysisResponseBuilder` 클래스
      - 응답 구조 조립: situationSummary → caseAnalyses → comparisonAnalysis(조건부) → trendAnalysis(조건부) → overallImplication → citations → disclaimer
      - 면책 고지 자동 삽입
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 6.2 판례 분석 속성 기반 테스트 작성
    - **Property 6: 분석 응답 구조 완전성** — `src/tests/property/case-search/analysis-response-structure.property.test.ts` 생성
    - 다양한 CaseAnalysisResponse에 대해 situationSummary 비어있지 않음, caseAnalyses 각 항목에 judgmentSummary/keyIssues(1개 이상)/judgmentReason/practicalImplication/similarityToUser(similarities 1개 이상, differences 1개 이상) 포함, overallImplication/disclaimer 비어있지 않음 검증
    - **Validates: Requirements 3.1, 3.2, 3.5, 3.6**

- [x] 7. 비교 분석 모듈 구현
  - [x] 7.1 비교 분석기 구현
    - `src/modules/case-search/comparison/index.ts` 생성: `ComparisonModule` 클래스
    - `src/modules/case-search/comparison/comparison-analyzer.ts` 생성: `ComparisonAnalyzer` 클래스
      - 비교 분석 트리거 조건: 동일 쟁점에서 상이한 결론을 가진 판례 2건 이상
      - 조건 미충족 시 비교 분석 생략 (null 반환)
      - Bedrock Claude 3.5 Sonnet 호출: 사실관계 차이점, 판단 근거 차이, 결론이 달라진 핵심 요인 분석
      - 대법원/하급심 간 결론 상이 시 courtHierarchyNote 포함
    - `src/modules/case-search/comparison/issue-matcher.ts` 생성: `IssueMatcher` 클래스
      - 검색된 판례 간 쟁점 매칭 로직
      - 동일 쟁점 상이 결론 판례 쌍 식별
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 7.2 비교 분석 속성 기반 테스트 작성
    - **Property 7: 비교 분석 트리거 및 구조** — `src/tests/property/case-search/comparison-trigger.property.test.ts` 생성
    - 랜덤 판례 목록(쟁점 일치/불일치, 결론 동일/상이 조합)에 대해:
      - 동일 쟁점 상이 결론 2건 이상이면 비교 분석 수행
      - 2건 미만이면 비교 분석 생략
      - 수행 시 ComparedCase에 필수 필드 모두 존재
      - 대법원/하급심 간 결론 차이 시 courtHierarchyNote 포함 검증
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 8. 트렌드 분석 모듈 구현
  - [x] 8.1 트렌드 분석기 구현
    - `src/modules/case-search/trend-analysis/index.ts` 생성: `TrendAnalysisModule` 클래스
    - `src/modules/case-search/trend-analysis/trend-analyzer.ts` 생성: `TrendAnalyzer` 클래스
      - 트렌드 분석 조건: 해당 분쟁유형 판례 5건 이상
      - 5건 미만 시 insufficientData=true, 분석 생략
      - OpenSearch에서 해당 분쟁유형 최근 5년 판례 조회
      - Bedrock Claude 3.5 Sonnet 호출: 시간순 판결 방향 변화, 관련 법령 개정 영향 분석
      - 결과 구조: analysisPeriod, totalCasesAnalyzed, trendDescription, timelineChanges(시간순 정렬), relatedLawChanges
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 8.2 트렌드 분석 속성 기반 테스트 작성
    - **Property 8: 트렌드 분석 조건 및 구조** — `src/tests/property/case-search/trend-analysis-condition.property.test.ts` 생성
    - 1~20건의 랜덤 판례 수에 대해:
      - 5건 미만이면 insufficientData=true, 분석 생략
      - 5건 이상이면 정상 분석 수행
      - 정상 분석 시 analysisPeriod 최근 5년 이내, totalCasesAnalyzed≥1, timelineChanges 시간순 정렬 검증
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.5**

- [x] 9. 인용 표시 모듈 구현
  - [x] 9.1 판례 인용 포맷터 구현
    - `src/modules/case-search/case-citation/index.ts` 생성: `CaseCitationModule` 클래스
    - `src/modules/case-search/case-citation/citation-formatter.ts` 생성: `CaseCitationFormatter` 클래스
      - 판례 인용 포맷: 사건번호, 선고일자, 법원명, 법원등급(supreme/lower), 200자 이내 판결 요지
      - 본문 내 [1], [2] 형식 각주 번호 삽입
      - 응답 하단 각주 번호 순 인용 목록 생성
      - 각주 번호와 citations 배열 1:1 대응 보장
    - `src/modules/case-search/case-citation/url-resolver.ts` 생성: `CaseUrlResolver` 클래스
      - 대법원 종합법률정보 시스템 판례 원문 URL 생성
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 9.2 인용 표시 속성 기반 테스트 작성
    - **Property 9: 인용 각주 일관성** — `src/tests/property/case-search/citation-consistency.property.test.ts` 생성
    - 1~10개의 랜덤 CaseCitation에 대해:
      - 본문 각주 [N]과 citations 배열 N번째 항목 1:1 대응
      - 각 CaseCitation에 caseNumber, courtName, courtLevel(supreme|lower), judgmentDate 포함
      - summary 200자 이하 검증
    - **Validates: Requirements 6.1, 6.2, 6.4**

- [x] 10. 체크포인트 - 분석 모듈 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 11. 카테고리 탐색 모듈 구현
  - [x] 11.1 카테고리 탐색 서비스 구현
    - `src/modules/case-search/category-browse/index.ts` 생성: `CategoryBrowseModule` 클래스
    - `src/modules/case-search/category-browse/category-service.ts` 생성: `CategoryService` 클래스
      - 5가지 분쟁유형 카테고리 목록 제공
      - 분쟁유형별 판례 목록 조회 (OpenSearch case_type 필터 + judgment_date 내림차순 정렬)
      - 하위 세부 분류 제공 (SubCategory 목록 + 판례 수)
      - 페이지네이션 지원 (기본 페이지 크기 20)
    - `src/modules/case-search/category-browse/case-detail-service.ts` 생성: `CaseDetailService` 클래스
      - 개별 판례 상세 분석: OpenSearch에서 판례 전문 조회 → CaseAnalysisModule 호출
      - CaseDetailOutput 구조 반환
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 11.2 카테고리 탐색 속성 기반 테스트 작성
    - **Property 12: 카테고리 판례 목록 정렬 및 완전성** — `src/tests/property/case-search/category-list-order.property.test.ts` 생성
    - 다양한 선고일자의 CategoryCaseItem 목록에 대해:
      - 선고일자 내림차순 정렬
      - 각 항목에 caseNumber, judgmentDate, courtName, keyIssueSummary 비어있지 않은 값 포함 검증
    - **Validates: Requirements 7.2, 7.3**

- [x] 12. 오케스트레이터 및 Lambda 핸들러 구현
  - [x] 12.1 질문 처리 오케스트레이터 구현
    - `src/modules/case-search/query-handler/orchestrator.ts` 생성: `CaseSearchOrchestrator` 클래스
      - 전체 파이프라인 조율: 입력 검증 → 세션 컨텍스트 조회 → 사실관계 분석 → 판례 검색 → 판례 분석(+ 조건부 비교/트렌드) → 인용 처리 → 세션 저장
      - 60초 전체 응답 타임아웃 관리
      - 2초 이내 처리 상태 표시 시작
      - 후속 질문 시 이전 대화 컨텍스트를 LLM 프롬프트에 포함
      - 부분 실패 대응: 비교/트렌드 분석 실패 시 핵심 분석만 반환
    - _Requirements: 1.7, 3.7, 3.8, 8.2, 8.3, 8.4, 8.5_

  - [x] 12.2 Lambda 핸들러 및 API 라우팅 구현
    - `src/modules/case-search/query-handler/handler.ts` 생성: Lambda 핸들러
      - `POST /case-search/analyze`: 상황 설명 기반 판례 검색 및 분석
      - `POST /case-search/follow-up`: 후속 질문 처리
      - `GET /case-search/categories`: 분쟁 유형 카테고리 목록
      - `GET /case-search/categories/{type}`: 카테고리별 판례 목록
      - `GET /case-search/categories/{type}/subcategories`: 하위 세부 분류
      - `GET /case-search/cases/{caseId}`: 개별 판례 상세 분석
      - `POST /case-search/feedback`: 사용자 피드백 제출
    - 오류 응답: 표준 ErrorResponse 형식, 한국어 사용자 대면 메시지
    - _Requirements: 10.3, 10.5_

  - [ ]* 12.3 후속 질문 컨텍스트 속성 기반 테스트 작성
    - **Property 13: 후속 질문 컨텍스트 포함** — `src/tests/property/case-search/follow-up-context.property.test.ts` 생성
    - 0~30개의 랜덤 세션 컨텍스트 + 후속 질문에 대해 LLM 프롬프트에 이전 대화 내용(검색된 판례 정보, 분석 결과)이 포함되는지 검증
    - **Validates: Requirements 8.2**

- [x] 13. 피드백 및 동의어 확장 구현
  - [x] 13.1 피드백 수집 및 동의어 데이터 추가
    - `src/modules/case-search/query-handler/feedback-handler.ts` 생성: `FeedbackHandler` 클래스
      - 사용자 피드백(helpful/not_helpful) DynamoDB 저장 (PK: `CASE_SEARCH#FEEDBACK#{sessionId}`)
      - 피드백 레코드: questionId, rating, disputeType, timestamp
    - `src/data/case-search-synonyms.json` 생성: 판례 검색 전용 동의어 데이터
      - "집주인이 보증금 안 돌려줘" → "임대차보증금 반환 청구"
      - "전세 사기" → "임차권 보호, 대항력"
      - "복비 너무 많이 냄" → "중개보수 초과 청구"
      - "재건축 부담금" → "재건축초과이익 환수"
      - "등기 안 해줌" → "소유권이전등기 청구"
      - 최소 20개 이상 매핑 등록
    - _Requirements: 9.2, 9.3_

- [x] 14. 모듈 통합 팩토리 및 플러그인 레지스트리 등록
  - [x] 14.1 모듈 팩토리 및 통합 구현
    - `src/modules/case-search/index.ts` 생성: `CaseSearchModuleFactory` 클래스
      - 전체 서브모듈 초기화 및 의존성 주입
      - 플러그인 레지스트리에 판례 검색 모듈 등록 (servicePrefix: 'CASE_SEARCH')
      - 헬스체크 구현: 각 서브모듈 상태 확인
    - `src/modules/index.ts` 업데이트: CaseSearchModuleFactory import 및 등록 추가
    - 오류 격리: 판례 검색 모듈 장애 시 기존 법률 자문 모듈에 영향 없도록 Circuit Breaker 적용
    - _Requirements: 10.1, 10.4, 10.6_

- [x] 15. 인프라 설정 (CDK 스택 확장)
  - [x] 15.1 판례 검색 Lambda 및 API Gateway 경로 추가
    - `src/infrastructure/lib/compute-stack.ts` 업데이트: 판례 검색 Lambda 함수 추가
      - case-search-analyze Lambda (POST /case-search/analyze, POST /case-search/follow-up)
      - case-search-category Lambda (GET /case-search/categories/*, GET /case-search/cases/*)
      - case-search-feedback Lambda (POST /case-search/feedback)
      - 각 Lambda IAM 역할: OpenSearch 읽기 전용, DynamoDB CASE_SEARCH# 접두사 읽기/쓰기, Bedrock 호출
    - `src/infrastructure/lib/api-stack.ts` 업데이트: `/case-search/*` 경로 추가
      - Rate Limiting 별도 적용
      - CORS 설정
    - _Requirements: 10.1, 10.3, 10.6_

- [x] 16. 체크포인트 - 전체 모듈 통합 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [ ] 17. 통합 테스트 작성
  - [ ]* 17.1 통합 테스트 작성
    - `src/tests/integration/case-search/analyze-flow.test.ts` 생성: 상황 설명 → 사실관계 분석 → 판례 검색 → 분석 응답 전체 파이프라인 테스트
    - `src/tests/integration/case-search/comparison-trigger.test.ts` 생성: 비교 분석 조건부 실행 테스트
    - `src/tests/integration/case-search/trend-trigger.test.ts` 생성: 트렌드 분석 조건부 실행 테스트
    - `src/tests/integration/case-search/follow-up-context.test.ts` 생성: 후속 질문 세션 컨텍스트 유지 테스트
    - `src/tests/integration/case-search/category-browse.test.ts` 생성: 카테고리 탐색 흐름 테스트
    - `src/tests/integration/case-search/error-isolation.test.ts` 생성: 판례 검색 모듈 장애 시 기존 법률 자문 모듈 정상 동작 테스트
    - AWS 서비스 모킹 (aws-sdk-client-mock 활용)
    - _Requirements: 10.6, 8.2, 4.1, 4.5, 5.1, 7.2_

- [x] 18. 최종 체크포인트 - 전체 시스템 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

## Notes

- `*` 표시된 작업은 선택 사항으로 빠른 MVP를 위해 건너뛸 수 있습니다
- 각 작업은 구체적인 요구사항을 참조하여 추적 가능합니다
- 체크포인트에서 점진적 검증을 수행합니다
- 속성 기반 테스트는 설계 문서의 Correctness Properties(Property 1~13)를 검증합니다
- 단위 테스트는 구체적 예시와 엣지 케이스를 검증합니다
- 기존 공통 모듈(`src/common/`, `src/modules/search/`)을 최대한 재활용합니다
- OpenSearch court-cases 인덱스는 기존 법률 자문 시스템과 공유하며, 판례 검색 모듈은 읽기 전용으로 접근합니다
- DynamoDB는 `CASE_SEARCH#` 파티션 키 접두사로 데이터를 격리합니다
- 판례 검색 모듈의 오류가 기존 법률 자문 모듈에 전파되지 않도록 Circuit Breaker를 적용합니다
- fast-check 라이브러리를 사용하여 속성 기반 테스트를 수행하며, 각 테스트는 최소 100회 반복 실행합니다

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3", "3.1"] },
    { "id": 4, "tasks": ["3.2", "4.1"] },
    { "id": 5, "tasks": ["4.2", "6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1", "8.1", "9.1"] },
    { "id": 7, "tasks": ["7.2", "8.2", "9.2", "11.1"] },
    { "id": 8, "tasks": ["11.2", "12.1"] },
    { "id": 9, "tasks": ["12.2", "12.3", "13.1"] },
    { "id": 10, "tasks": ["14.1"] },
    { "id": 11, "tasks": ["15.1"] },
    { "id": 12, "tasks": ["17.1"] }
  ]
}
```
