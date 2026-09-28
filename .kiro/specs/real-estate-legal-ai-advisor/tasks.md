# Implementation Plan: 부동산 법률 AI 자문 시스템

## Overview

AWS 서버리스 아키텍처 기반으로 RAG(Retrieval-Augmented Generation) 기술을 활용한 부동산 법률 AI 자문 시스템을 구현한다. TypeScript/Node.js Lambda 함수들을 중심으로 모듈별 독립 배포 가능한 구조를 구축하며, Amazon Bedrock(Claude 3.5 Sonnet + Titan Embeddings V2), OpenSearch Serverless, DynamoDB를 활용한다.

## Tasks

- [x] 1. 프로젝트 구조 및 공통 모듈 설정
  - [x] 1.1 프로젝트 초기화 및 디렉토리 구조 생성
    - `package.json` 생성 (TypeScript, Jest, fast-check, aws-sdk v3, esbuild 의존성 포함)
    - `tsconfig.json` 생성 (ES2022 타겟, strict mode)
    - `jest.config.ts` 생성 (ts-jest 프리셋, fast-check 통합)
    - 디렉토리 구조 생성:
      ```
      src/
      ├── common/          # 공통 모듈
      ├── modules/         # 서비스 모듈
      │   ├── law-collector/
      │   ├── case-collector/
      │   ├── search/
      │   ├── response-generator/
      │   ├── citation/
      │   ├── query-handler/
      │   └── admin/
      ├── infrastructure/  # IaC (CDK)
      └── tests/
          ├── unit/
          ├── property/
          └── integration/
      ```
    - _Requirements: 8.1, 8.2_

  - [x] 1.2 공통 인터페이스 및 타입 정의
    - `src/common/interfaces/service-module.ts` 생성: `ServiceModule`, `ModuleConfig`, `ModuleInput`, `ModuleOutput`, `ErrorResponse`, `HealthStatus` 인터페이스 정의
    - `src/common/interfaces/data-models.ts` 생성: `LawArticle`, `CourtCase`, `RevisionEntry`, `SessionRecord`, `ConversationEntry`, `Citation`, `LawCitation`, `CaseCitation` 타입 정의
    - `src/common/interfaces/search.ts` 생성: `SearchInput`, `SearchOutput`, `SearchResult` 인터페이스 정의
    - `src/common/interfaces/response.ts` 생성: `ResponseGeneratorInput`, `ResponseGeneratorOutput`, `FormattedAnswer` 인터페이스 정의
    - `src/common/interfaces/index.ts` 생성: 전체 re-export
    - _Requirements: 8.3_

  - [x] 1.3 공통 유틸리티 모듈 구현
    - `src/common/utils/retry.ts` 생성: 지수 백오프 및 고정 간격 재시도 로직 구현 (`RetryPolicy` 인터페이스, `executeWithRetry` 함수)
    - `src/common/utils/error-handler.ts` 생성: 오류 분류(Critical/High/Medium/Low), 표준 에러 응답 생성
    - `src/common/utils/circuit-breaker.ts` 생성: Circuit Breaker 패턴 구현 (`CircuitBreakerConfig`, 상태 관리)
    - `src/common/utils/validator.ts` 생성: 입력 검증 유틸리티 (길이 제한, 빈 값 체크)
    - `src/common/utils/index.ts` 생성: 전체 re-export
    - _Requirements: 1.5, 2.5, 8.6_

  - [ ]* 1.4 공통 유틸리티 속성 기반 테스트 작성
    - **Property 12: 재시도 정책 준수** — `src/tests/property/retry.property.test.ts` 생성
    - 법령 수집기: 5초 초기 간격, 배수 2 지수 백오프, 최대 3회 검증
    - 판례 수집기: 30초 고정 간격, 최대 3회 검증
    - **Property 8: 입력 길이 검증** — `src/tests/property/validator.property.test.ts` 생성
    - 0~2000자 범위 유니코드 문자열에 대한 10자 미만 거부, 1000자 초과 거부 검증
    - **Validates: Requirements 1.5, 2.5, 6.1, 6.8**

- [x] 2. 플러그인 레지스트리 및 모듈 관리 시스템
  - [x] 2.1 플러그인 레지스트리 구현
    - `src/common/plugin-registry.ts` 생성: `PluginRegistry` 클래스 구현
    - `register()`: 모듈 등록 (입력/출력 스키마 검증 포함)
    - `deregister()`: 모듈 해제
    - `getModule()`: 모듈 조회
    - `listModules()`: 전체 모듈 목록 및 상태 반환
    - 모듈 헬스체크 통합 (`healthCheck()` 호출)
    - _Requirements: 8.2, 8.3, 8.5_

  - [ ]* 2.2 플러그인 레지스트리 단위 테스트 작성
    - `src/tests/unit/plugin-registry.test.ts` 생성
    - 모듈 등록/해제, 중복 등록 방지, 헬스체크 상태 관리 검증
    - _Requirements: 8.2, 8.3_

- [x] 3. 체크포인트 - 기본 구조 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 4. 한국어 NLP 모듈 구현
  - [x] 4.1 형태소 분석 및 키워드 추출 구현
    - `src/modules/search/korean-nlp.ts` 생성: `KoreanNLPModule` 클래스 구현
    - `extractKeywords()`: 한국어 형태소 분석으로 명사/동사 어간 추출 (1~10개 제한)
    - `classifyTopic()`: 부동산 법률 관련 여부 판별 (임대차, 매매, 등기, 중개, 세금, 토지이용)
    - `detectLanguage()`: 한국어/혼합/알 수 없음 판별
    - 한국어 형태소 분석 라이브러리 통합 (mecab-ko 또는 koalanlp 활용)
    - _Requirements: 9.1, 9.2, 9.6, 9.7_

  - [x] 4.2 동의어 사전 및 검색 확장 구현
    - `src/modules/search/synonym-dictionary.ts` 생성: `SynonymDictionary` 클래스 구현
    - DynamoDB `SynonymDictionary` 테이블에서 동의어 사전 로드
    - `expandQuery()`: 질문 내 용어의 동의어를 검색 쿼리에 포함
    - 초기 동의어 데이터 파일 `src/data/initial-synonyms.json` 생성 (부동산 법률 용어 20개 이상 등록)
    - _Requirements: 9.3_

  - [ ]* 4.3 한국어 NLP 속성 기반 테스트 작성
    - **Property 10: 한국어 키워드 추출 범위** — `src/tests/property/korean-nlp.property.test.ts` 생성
    - 다양한 한국어 문장에 대해 키워드 수가 1~10개 범위인지 검증
    - **Property 11: 동의어 검색 확장** — `src/tests/property/synonym.property.test.ts` 생성
    - 사전 등록 용어가 질문에 포함 시 모든 동의어가 검색 쿼리에 포함되는지 검증
    - **Validates: Requirements 9.2, 9.3**

- [x] 5. 법령 수집 모듈 구현
  - [x] 5.1 법령 수집기 핵심 로직 구현
    - `src/modules/law-collector/index.ts` 생성: `LawCollectorModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/law-collector/law-api-client.ts` 생성: 국가법령정보센터 Open API 클라이언트
    - 수집 대상 법령 목록 관리: 주택임대차보호법, 부동산 거래신고 등에 관한 법률, 공인중개사법, 부동산등기법, 민법(물권편), 상가건물 임대차보호법
    - 구조화된 데이터 파싱: 법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력
    - 재시도 로직 통합: 5초 초기 간격 지수 백오프, 최대 3회
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 5.2 법령 데이터 저장 및 벡터 적재
    - `src/modules/law-collector/law-storage.ts` 생성: S3 원본 저장 + DynamoDB 메타데이터 기록
    - `src/modules/law-collector/law-embedder.ts` 생성: Titan Embeddings V2를 통한 임베딩 변환 및 OpenSearch 적재
    - S3 경로: `raw/laws/{law_id}/{version}/full.json`
    - 임베딩 실패 시 해당 조항만 기록하고 나머지 계속 진행
    - 개정 여부 감지 시 데이터 갱신 로직
    - _Requirements: 1.3, 1.4, 1.7, 1.8_

  - [x] 5.3 법령 수집 Lambda 핸들러 및 스케줄링 설정
    - `src/modules/law-collector/handler.ts` 생성: Lambda 핸들러 (EventBridge 트리거)
    - 매일 1회 실행 스케줄 설정
    - SNS 실패 알림 통합 (최대 재시도 후 실패 시)
    - CloudWatch 로그 구성
    - _Requirements: 1.4, 1.6_

  - [ ]* 5.4 법령 수집기 속성 기반 테스트 작성
    - **Property 1: 데이터 구조 완전성** — `src/tests/property/law-data-structure.property.test.ts` 생성
    - 랜덤 법령 데이터 생성 후 필수 필드(법령명, 조항 번호, 조항 내용, 시행일자, 개정 이력) 포함 여부 검증
    - **Validates: Requirements 1.3**

- [x] 6. 판례 수집 모듈 구현
  - [x] 6.1 판례 수집기 핵심 로직 구현
    - `src/modules/case-collector/index.ts` 생성: `CaseCollectorModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/case-collector/case-api-client.ts` 생성: 대법원 종합법률정보 API 클라이언트
    - 수집 대상 카테고리: 임대차 분쟁, 매매 분쟁, 등기 분쟁, 중개 분쟁, 재건축/재개발 분쟁
    - 구조화된 데이터 파싱: 사건번호, 선고일자, 법원명, 사건 유형, 판결 요지, 판결 전문, 참조 법령
    - 중복 판별: 동일 사건번호 존재 시 신규 저장 생략
    - 재시도 로직: 30초 고정 간격, 최대 3회
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.8_

  - [x] 6.2 판례 청크 분할 및 벡터 적재
    - `src/modules/case-collector/chunk-splitter.ts` 생성: 판결 요지/전문을 500~1000 토큰 단위로 청크 분할
    - `src/modules/case-collector/case-embedder.ts` 생성: 청크별 임베딩 변환 및 OpenSearch 적재
    - S3 경로: `raw/cases/{case_id}/full.json`, `raw/cases/{case_id}/chunks/`
    - DynamoDB 메타데이터 기록 (수집 상태, 벡터 적재 상태)
    - _Requirements: 2.3, 2.7_

  - [x] 6.3 판례 수집 Lambda 핸들러 및 스케줄링 설정
    - `src/modules/case-collector/handler.ts` 생성: Lambda 핸들러 (EventBridge 트리거)
    - 24시간 간격 실행 스케줄 설정
    - SNS 실패 알림 통합
    - _Requirements: 2.4, 2.6_

  - [ ]* 6.4 판례 수집기 속성 기반 테스트 작성
    - **Property 1: 데이터 구조 완전성** — `src/tests/property/case-data-structure.property.test.ts` 생성
    - 랜덤 판례 데이터 생성 후 필수 필드(사건번호, 선고일자, 법원명, 사건 유형, 판결 요지, 판결 전문, 참조 법령) 포함 여부 검증
    - **Property 2: 청크 분할 라운드트립** — `src/tests/property/chunk-splitter.property.test.ts` 생성
    - 다양한 길이(500~10000 토큰) 한국어 텍스트를 청크 분할 후 결합하면 원본과 동일, 각 청크 500~1000 토큰 검증
    - **Property 3: 중복 제거 멱등성** — `src/tests/property/deduplication.property.test.ts` 생성
    - 동일 사건번호 N회 삽입 시 저장소에 1건만 존재 검증
    - **Validates: Requirements 2.3, 2.7, 2.8, 7.4**

- [x] 7. 체크포인트 - 데이터 수집 파이프라인 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 8. 검색 모듈 구현
  - [x] 8.1 벡터 검색 엔진 구현
    - `src/modules/search/index.ts` 생성: `SearchModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/search/embedding-client.ts` 생성: Titan Embeddings V2 호출하여 질문 벡터 변환 (3초 이내)
    - `src/modules/search/opensearch-client.ts` 생성: OpenSearch Serverless kNN 검색 클라이언트
    - 법령/판례 네임스페이스 분리 검색
    - 유사도 점수 내림차순 정렬, 각 유형 최대 5건 반환
    - 관련도 기준 미달 문서에 `isLowRelevance: true` 표시
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 8.4_

  - [x] 8.2 질문 분해 및 하이브리드 검색 구현
    - `src/modules/search/query-decomposer.ts` 생성: 복합 질문을 주제별로 분해
    - 형태소 분석 + 동의어 확장을 통한 검색 쿼리 생성
    - 주제별 독립 검색 및 결과 구분 반환
    - 혼합 언어(한국어+영어) 처리: 한국어 기준 해석
    - 형태소 분석 실패 시 원본 텍스트 그대로 검색
    - _Requirements: 3.5, 9.2, 9.3, 9.6, 9.7_

  - [x] 8.3 검색 Lambda 핸들러 구현
    - `src/modules/search/handler.ts` 생성: Lambda 핸들러
    - 검색 실패 시 오류 메시지 반환 및 질문 텍스트 보존
    - 검색 로그 DynamoDB 기록 (운영 데이터)
    - 5초 이내 결과 반환 타임아웃 관리
    - _Requirements: 3.2, 3.6, 3.7_

  - [ ]* 8.4 검색 모듈 속성 기반 테스트 작성
    - **Property 4: 검색 결과 정렬 및 제한** — `src/tests/property/search-results.property.test.ts` 생성
    - 랜덤 유사도 점수 목록에 대해 내림차순 정렬 및 최대 5건 제한 검증
    - **Property 5: 질문 분해와 검색 독립성** — `src/tests/property/query-decomposition.property.test.ts` 생성
    - 2~5개 주제 포함 복합 질문에 대해 주제별 독립 검색 결과 존재 검증
    - **Validates: Requirements 3.3, 3.5**

- [x] 9. 응답 생성 모듈 구현
  - [x] 9.1 LLM 기반 응답 생성기 구현
    - `src/modules/response-generator/index.ts` 생성: `ResponseGeneratorModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/response-generator/bedrock-client.ts` 생성: Claude 3.5 Sonnet 호출 클라이언트 (60초 타임아웃)
    - `src/modules/response-generator/prompt-builder.ts` 생성: 프롬프트 템플릿 (검색 결과 + 질문 + 세션 컨텍스트 조합)
    - 답변 구조: 질문 요약 → 관련 법령 설명 → 관련 판례 설명 → 종합 의견 → 참고 자료 목록
    - 답변 길이 제한: 200자 이상 5000자 이하
    - 존댓말(합쇼체/해요체) 형식 프롬프트 지시
    - 법률 용어 부연 설명 지시 포함
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 9.1, 9.5_

  - [x] 9.2 범위 판별 및 면책 고지 구현
    - `src/modules/response-generator/scope-checker.ts` 생성: 부동산 법률 범위 판별 (부동산 거래, 임대차, 등기, 재건축, 세금, 토지이용)
    - 범위 외 질문 시 안내 메시지 생성
    - 답변 말미 면책 고지 자동 삽입: "본 답변은 참고용이며 법적 효력이 없습니다"
    - 관련 법령/판례 미발견 시 답변 가능 범위 명시 및 추가 확인 사항 안내
    - _Requirements: 4.5, 4.6, 4.7_

  - [x] 9.3 응답 생성 Lambda 핸들러 구현
    - `src/modules/response-generator/handler.ts` 생성: Lambda 핸들러
    - LLM 호출 실패/타임아웃 시 사용자 오류 안내 메시지 반환
    - _Requirements: 4.8_

  - [ ]* 9.4 응답 생성기 속성 기반 테스트 작성
    - **Property 6: 응답 구조 완전성** — `src/tests/property/response-structure.property.test.ts` 생성
    - 다양한 검색 결과 조합에 대해 답변이 5개 섹션 순서 포함, 200~5000자, 면책 고지 포함 검증
    - **Validates: Requirements 4.4, 4.6**

- [x] 10. 인용 표시 모듈 구현
  - [x] 10.1 인용 포맷터 및 각주 시스템 구현
    - `src/modules/citation/index.ts` 생성: `CitationModule` 클래스 (`ServiceModule` 인터페이스 구현)
    - `src/modules/citation/citation-formatter.ts` 생성:
      - 법령 인용 포맷: 법령명 + 조항 번호 + 100자 이내 요약
      - 판례 인용 포맷: 사건번호 + 선고일자 + 200자 이내 요지
      - 본문 내 [1], [2] 형식 각주 번호 삽입
      - 답변 하단 각주 번호 순 인용 목록 생성
    - `src/modules/citation/url-resolver.ts` 생성: 법령/판례 원문 URL 생성 (국가법령정보센터, 대법원)
    - 개정된 법령 표시 및 현행 법령 정보 안내
    - 인용할 문서가 없을 경우 안내 메시지 생성
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 10.2 인용 모듈 속성 기반 테스트 작성
    - **Property 7: 인용 각주 일관성** — `src/tests/property/citation.property.test.ts` 생성
    - 1~10개 랜덤 인용 데이터에 대해 본문 각주 [N]과 하단 목록 N번째 항목의 1:1 대응 검증
    - 법령 인용 100자 이내, 판례 인용 200자 이내 검증
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 11. 체크포인트 - 핵심 모듈 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

- [x] 12. 질문 처리 인터페이스 모듈 구현
  - [x] 12.1 질문 입력 검증 및 세션 관리 구현
    - `src/modules/query-handler/index.ts` 생성: `QueryHandlerModule` 클래스
    - `src/modules/query-handler/input-validator.ts` 생성: 입력 길이 검증 (10~1000자), 빈 입력 거부
    - `src/modules/query-handler/session-manager.ts` 생성: DynamoDB 세션 CRUD
      - 세션 생성/조회/업데이트
      - 대화 이력 최대 50개 유지 (초과 시 가장 오래된 항목 제거)
      - TTL 기반 자동 만료 (24시간)
    - _Requirements: 6.1, 6.6, 6.8_

  - [x] 12.2 질문 처리 오케스트레이터 구현
    - `src/modules/query-handler/orchestrator.ts` 생성: 전체 질문-응답 파이프라인 조율
      - 입력 검증 → 세션 컨텍스트 조회 → 검색 모듈 호출 → 응답 생성 모듈 호출 → 세션 저장
    - 30초 전체 응답 타임아웃 관리
    - 2초 이내 처리 상태 표시 시작 (API Gateway 응답 시작)
    - 후속 질문 시 이전 대화 컨텍스트 참조
    - _Requirements: 6.2, 6.4, 6.5, 6.7_

  - [x] 12.3 질문 처리 Lambda 핸들러 및 API Gateway 설정
    - `src/modules/query-handler/handler.ts` 생성: Lambda 핸들러 (`POST /questions` 엔드포인트)
    - API Gateway REST API 설정 (CORS, 요청/응답 모델 정의)
    - 30초 타임아웃 초과 시 안내 메시지 + 재시도 옵션 응답
    - 자주 묻는 질문 카테고리 엔드포인트: `GET /categories` (임대차, 매매, 등기, 중개, 세금)
    - _Requirements: 6.3, 6.4, 6.5_

  - [ ]* 12.4 세션 관리 속성 기반 테스트 작성
    - **Property 9: 세션 크기 제한** — `src/tests/property/session.property.test.ts` 생성
    - 1~100개 대화 항목 삽입 시 최대 50개 유지, 초과 시 가장 오래된 항목 제거 검증
    - **Validates: Requirements 6.6**

- [x] 13. 관리 모듈 구현
  - [x] 13.1 데이터 관리 및 모니터링 구현
    - `src/modules/admin/index.ts` 생성: `AdminModule` 클래스
    - `src/modules/admin/data-dashboard.ts` 생성: 데이터 현황 조회 API
      - 수집된 법령 수, 판례 수, 최종 갱신 일시, 벡터 적재 상태 반환
      - DynamoDB `DataManagement` 테이블 조회
    - `src/modules/admin/handler.ts` 생성: Lambda 핸들러 (`GET /admin/status` 엔드포인트)
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 13.2 피드백 수집 및 검색 품질 관리 구현
    - `src/modules/admin/feedback-collector.ts` 생성: 사용자 피드백(답변 유용성 평가) 수집/저장
    - DynamoDB `Feedback` 테이블 CRUD
    - 피드백 제출 엔드포인트: `POST /feedback`
    - 검색 로그 저장 (질문, 검색 결과, 클릭 패턴)
    - _Requirements: 3.7, 3.8_

- [x] 14. 인프라스트럭처 코드 (AWS CDK)
  - [x] 14.1 CDK 프로젝트 설정 및 기본 스택 구현
    - `src/infrastructure/bin/app.ts` 생성: CDK 앱 엔트리포인트
    - `src/infrastructure/lib/vpc-stack.ts` 생성: VPC 및 네트워크 설정 (필요 시)
    - `src/infrastructure/lib/storage-stack.ts` 생성:
      - S3 버킷 (`real-estate-legal-data-{env}`)
      - DynamoDB 테이블 4개 (Sessions, DataManagement, Feedback, SynonymDictionary)
      - OpenSearch Serverless 컬렉션 + 인덱스 (법령, 판례 네임스페이스)
    - _Requirements: 8.1, 8.4_

  - [x] 14.2 컴퓨트 및 API 스택 구현
    - `src/infrastructure/lib/compute-stack.ts` 생성:
      - Lambda 함수 7개 (질문 처리, 검색, 응답 생성, 인용 처리, 법령 수집, 판례 수집, 관리)
      - 각 Lambda IAM 역할 및 정책 (최소 권한 원칙)
    - `src/infrastructure/lib/api-stack.ts` 생성:
      - API Gateway REST API 정의
      - 엔드포인트: `POST /questions`, `GET /categories`, `POST /feedback`, `GET /admin/status`
    - `src/infrastructure/lib/scheduling-stack.ts` 생성:
      - EventBridge Scheduler 규칙 (법령 수집 매일 1회, 판례 수집 24시간 간격)
      - SNS 토픽 + 구독 (실패 알림)
    - _Requirements: 1.4, 1.6, 2.4, 2.6, 7.5, 7.6, 7.7, 8.1, 8.5_

- [x] 15. 통합 연결 및 종단 간 연동
  - [x] 15.1 모듈 간 연동 및 전체 파이프라인 통합
    - `src/modules/query-handler/orchestrator.ts` 업데이트: 실제 모듈 호출 연동 (검색 → 응답 생성 → 인용)
    - `src/modules/law-collector/index.ts` 업데이트: 실제 외부 API → S3 → 임베딩 → OpenSearch 파이프라인 연동
    - `src/modules/case-collector/index.ts` 업데이트: 실제 외부 API → S3 → 청크 → 임베딩 → OpenSearch 파이프라인 연동
    - 플러그인 레지스트리에 모든 모듈 등록 로직 추가
    - 모듈 간 오류 격리 확인 (Circuit Breaker 적용)
    - _Requirements: 8.1, 8.2, 8.5, 8.6_

  - [ ]* 15.2 통합 테스트 작성
    - `src/tests/integration/question-flow.test.ts` 생성: 전체 질문-응답 파이프라인 통합 테스트
    - `src/tests/integration/data-collection.test.ts` 생성: 데이터 수집 파이프라인 통합 테스트
    - `src/tests/integration/session-context.test.ts` 생성: 세션 기반 후속 질문 컨텍스트 유지 테스트
    - AWS 서비스 모킹 (aws-sdk-client-mock 활용)
    - _Requirements: 6.7, 8.6_

- [x] 16. 최종 체크포인트 - 전체 시스템 검증
  - 모든 테스트 통과 확인, 사용자에게 질문 사항이 있으면 확인.

## Notes

- `*` 표시된 작업은 선택 사항으로 빠른 MVP를 위해 건너뛸 수 있습니다
- 각 작업은 구체적인 요구사항을 참조하여 추적 가능합니다
- 체크포인트에서 점진적 검증을 수행합니다
- 속성 기반 테스트는 설계 문서의 Correctness Properties를 검증합니다
- 단위 테스트는 구체적 예시와 엣지 케이스를 검증합니다
- 한국어 형태소 분석 라이브러리 선정은 4.1 태스크에서 확정합니다 (mecab-ko-dic, koalanlp 등)
- 외부 API(국가법령정보센터, 대법원) 연동 시 실제 API 키 발급이 필요합니다
- OpenSearch Serverless 인덱스 매핑은 설계 문서의 스키마를 그대로 적용합니다

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1", "6.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "6.2", "6.3"] },
    { "id": 6, "tasks": ["5.4", "6.4", "8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 8, "tasks": ["8.4", "9.2", "9.3"] },
    { "id": 9, "tasks": ["9.4", "10.1"] },
    { "id": 10, "tasks": ["10.2", "12.1"] },
    { "id": 11, "tasks": ["12.2", "12.3"] },
    { "id": 12, "tasks": ["12.4", "13.1", "13.2"] },
    { "id": 13, "tasks": ["14.1"] },
    { "id": 14, "tasks": ["14.2"] },
    { "id": 15, "tasks": ["15.1"] },
    { "id": 16, "tasks": ["15.2"] }
  ]
}
```
