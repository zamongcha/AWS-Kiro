/**
 * 판례 검색 서비스 입출력 인터페이스 정의
 *
 * 외부에서 판례 검색 서비스를 호출할 때 사용하는
 * 입력, 출력, 입력 검증 결과 인터페이스를 정의한다.
 *
 * 입력 검증 규칙:
 * - situationDescription: 20자 이상 2000자 이하
 * - sessionId: 선택적 (후속 질문 시 기존 세션 연결)
 */

import type { CaseAnalysisResponse } from './case-analysis.js';

/**
 * 판례 검색 서비스 입력 인터페이스
 */
export interface CaseSearchInput {
  /** 사용자 상황 설명 (20~2000자) */
  situationDescription: string;
  /** 기존 세션 ID (후속 질문 시) */
  sessionId?: string;
}

/**
 * 판례 검색 서비스 출력 인터페이스
 */
export interface CaseSearchOutput {
  /** 세션 ID */
  sessionId: string;
  /** 판례 분석 응답 */
  analysis: CaseAnalysisResponse;
  /** 처리 소요 시간 (ms) */
  processingTimeMs: number;
}

/**
 * 입력 검증 결과 인터페이스
 *
 * 입력 텍스트의 유효성 검사 결과를 담는다.
 * 검증 실패 시 한국어 안내 메시지를 반환한다.
 */
export interface InputValidationResult {
  /** 검증 성공 여부 */
  isValid: boolean;
  /** 검증 실패 시 한국어 안내 메시지 */
  errorMessage?: string;
  /** 정제된 입력 텍스트 */
  sanitizedInput?: string;
}
