/**
 * ScopeChecker 단위 테스트
 *
 * 부동산 법률 범위 판별, 면책 고지, 관련 문서 미발견 안내 기능을 검증한다.
 *
 * @requirements 4.5, 4.6, 4.7
 */

import {
  ScopeChecker,
  DISCLAIMER,
  OUT_OF_SCOPE_MESSAGE,
  SUPPORTED_CATEGORIES,
} from '../../modules/response-generator/scope-checker';
import { SearchOutput, SearchResult, SearchResultType } from '../../common/interfaces/search';

describe('ScopeChecker', () => {
  let scopeChecker: ScopeChecker;

  beforeEach(() => {
    scopeChecker = new ScopeChecker();
  });

  describe('checkScope', () => {
    describe('범위 내 질문 판별', () => {
      it('임대차 관련 질문을 범위 내로 판별한다', () => {
        const result = scopeChecker.checkScope('전세 보증금을 돌려받을 수 있나요?');
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories).toContain('임대차');
        expect(result.outOfScopeMessage).toBeUndefined();
      });

      it('매매 관련 질문을 범위 내로 판별한다', () => {
        const result = scopeChecker.checkScope('아파트 매매계약 해제 절차가 궁금합니다');
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories).toContain('매매');
      });

      it('등기 관련 질문을 범위 내로 판별한다', () => {
        const result = scopeChecker.checkScope('소유권이전등기를 어떻게 하나요?');
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories).toContain('등기');
      });

      it('중개 관련 질문을 범위 내로 판별한다', () => {
        const result = scopeChecker.checkScope('공인중개사 중개수수료 기준이 뭔가요?');
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories).toContain('중개');
      });

      it('세금 관련 질문을 범위 내로 판별한다', () => {
        const result = scopeChecker.checkScope('양도소득세 비과세 조건이 궁금합니다');
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories).toContain('세금');
      });

      it('토지이용 관련 질문을 범위 내로 판별한다', () => {
        const result = scopeChecker.checkScope('용도지역 변경 절차가 어떻게 되나요?');
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories).toContain('토지이용');
      });

      it('재건축/재개발 관련 질문을 범위 내로 판별한다', () => {
        const result = scopeChecker.checkScope('재건축 조합 설립 요건이 뭔가요?');
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories).toContain('재건축/재개발');
      });

      it('복수 카테고리가 감지될 수 있다', () => {
        const result = scopeChecker.checkScope(
          '전세에서 매매로 전환할 때 취득세는 어떻게 되나요?'
        );
        expect(result.isInScope).toBe(true);
        expect(result.detectedCategories.length).toBeGreaterThanOrEqual(2);
      });

      it('일반 부동산 키워드 + 법률 맥락이면 범위 내로 판단한다', () => {
        const result = scopeChecker.checkScope('아파트 계약 관련 법률 절차');
        expect(result.isInScope).toBe(true);
      });
    });

    describe('범위 외 질문 판별', () => {
      it('부동산과 무관한 질문을 범위 외로 판별한다', () => {
        const result = scopeChecker.checkScope('오늘 날씨가 어때요?');
        expect(result.isInScope).toBe(false);
        expect(result.detectedCategories).toHaveLength(0);
        expect(result.outOfScopeMessage).toBe(OUT_OF_SCOPE_MESSAGE);
      });

      it('일반 법률 질문을 범위 외로 판별한다', () => {
        const result = scopeChecker.checkScope('교통사고 합의금은 얼마인가요?');
        expect(result.isInScope).toBe(false);
        expect(result.outOfScopeMessage).toBe(OUT_OF_SCOPE_MESSAGE);
      });

      it('빈 문자열을 범위 외로 판별한다', () => {
        const result = scopeChecker.checkScope('');
        expect(result.isInScope).toBe(false);
        expect(result.outOfScopeMessage).toBe(OUT_OF_SCOPE_MESSAGE);
      });

      it('공백만 있는 입력을 범위 외로 판별한다', () => {
        const result = scopeChecker.checkScope('   ');
        expect(result.isInScope).toBe(false);
        expect(result.outOfScopeMessage).toBe(OUT_OF_SCOPE_MESSAGE);
      });

      it('범위 외 안내 메시지에 지원 카테고리 목록이 포함된다', () => {
        const result = scopeChecker.checkScope('프로그래밍 공부법');
        expect(result.outOfScopeMessage).toContain('임대차');
        expect(result.outOfScopeMessage).toContain('매매');
        expect(result.outOfScopeMessage).toContain('등기');
        expect(result.outOfScopeMessage).toContain('중개');
        expect(result.outOfScopeMessage).toContain('세금');
        expect(result.outOfScopeMessage).toContain('토지이용');
        expect(result.outOfScopeMessage).toContain('재건축/재개발');
      });
    });
  });

  describe('appendDisclaimer', () => {
    it('답변에 면책 고지를 추가한다', () => {
      const answer = '전세 보증금은 임대차보호법에 의해 보호됩니다.';
      const result = scopeChecker.appendDisclaimer(answer);
      expect(result).toContain(answer);
      expect(result).toContain(DISCLAIMER);
    });

    it('면책 고지가 답변 끝에 위치한다', () => {
      const answer = '관련 법령을 확인해 보세요.';
      const result = scopeChecker.appendDisclaimer(answer);
      expect(result.endsWith(DISCLAIMER)).toBe(true);
    });

    it('이미 면책 고지가 포함된 답변에는 중복 삽입하지 않는다', () => {
      const answer = `답변 내용입니다.\n\n---\n⚠️ ${DISCLAIMER}`;
      const result = scopeChecker.appendDisclaimer(answer);
      const disclaimerCount = (result.match(new RegExp(DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      expect(disclaimerCount).toBe(1);
    });

    it('빈 답변에도 면책 고지를 반환한다', () => {
      const result = scopeChecker.appendDisclaimer('');
      expect(result).toBe(DISCLAIMER);
    });

    it('답변과 면책 고지 사이에 구분선이 포함된다', () => {
      const answer = '답변입니다.';
      const result = scopeChecker.appendDisclaimer(answer);
      expect(result).toContain('---');
      expect(result).toContain('⚠️');
    });
  });

  describe('generateNoRelevantDocumentsGuide', () => {
    it('검색 결과가 없을 때 안내 메시지를 생성한다', () => {
      const guide = scopeChecker.generateNoRelevantDocumentsGuide(
        '임대차 보증금 관련 질문',
        undefined
      );
      expect(guide.message).toContain('찾지 못했습니다');
      expect(guide.availableScope).toContain('임대차');
      expect(guide.additionalGuidance.length).toBeGreaterThan(0);
    });

    it('빈 검색 결과에 대해 안내 메시지를 생성한다', () => {
      const emptySearchOutput: SearchOutput = {
        results: [],
        totalCount: 0,
        searchTime: 100,
      };
      const guide = scopeChecker.generateNoRelevantDocumentsGuide(
        '전세금 반환 청구',
        emptySearchOutput
      );
      expect(guide.message).toContain('찾지 못했습니다');
      expect(guide.availableScope).toBeDefined();
      expect(guide.additionalGuidance.length).toBeGreaterThan(0);
    });

    it('모든 결과가 관련도 기준 미달일 때 적절한 안내를 생성한다', () => {
      const lowRelevanceOutput: SearchOutput = {
        results: [
          createMockSearchResult({ isLowRelevance: true }),
          createMockSearchResult({ isLowRelevance: true }),
        ],
        totalCount: 2,
        searchTime: 200,
      };
      const guide = scopeChecker.generateNoRelevantDocumentsGuide(
        '등기 관련 질문',
        lowRelevanceOutput
      );
      expect(guide.message).toContain('관련도가 낮을 수 있습니다');
    });

    it('일부 결과가 관련도 기준 이상일 때 부분 안내를 생성한다', () => {
      const partialOutput: SearchOutput = {
        results: [
          createMockSearchResult({ isLowRelevance: false }),
          createMockSearchResult({ isLowRelevance: true }),
        ],
        totalCount: 2,
        searchTime: 150,
      };
      const guide = scopeChecker.generateNoRelevantDocumentsGuide(
        '매매 관련 질문',
        partialOutput
      );
      expect(guide.message).toContain('모든 측면을 다루지 못할 수 있습니다');
    });

    it('안내에 지원 카테고리 목록이 포함된다', () => {
      const guide = scopeChecker.generateNoRelevantDocumentsGuide(
        '부동산 질문',
        undefined
      );
      for (const category of SUPPORTED_CATEGORIES) {
        expect(guide.availableScope).toContain(category);
      }
    });

    it('감지된 주제가 추가 안내에 포함된다', () => {
      const guide = scopeChecker.generateNoRelevantDocumentsGuide(
        '임대차 보증금 반환 소송',
        undefined
      );
      expect(guide.additionalGuidance.some((g) => g.includes('임대차'))).toBe(true);
    });
  });

  describe('hasRelevantDocuments', () => {
    it('관련 문서가 있으면 true를 반환한다', () => {
      const output: SearchOutput = {
        results: [createMockSearchResult({ isLowRelevance: false })],
        totalCount: 1,
        searchTime: 100,
      };
      expect(scopeChecker.hasRelevantDocuments(output)).toBe(true);
    });

    it('모든 문서가 관련도 미달이면 false를 반환한다', () => {
      const output: SearchOutput = {
        results: [
          createMockSearchResult({ isLowRelevance: true }),
          createMockSearchResult({ isLowRelevance: true }),
        ],
        totalCount: 2,
        searchTime: 100,
      };
      expect(scopeChecker.hasRelevantDocuments(output)).toBe(false);
    });

    it('빈 결과에 대해 false를 반환한다', () => {
      const output: SearchOutput = {
        results: [],
        totalCount: 0,
        searchTime: 50,
      };
      expect(scopeChecker.hasRelevantDocuments(output)).toBe(false);
    });

    it('null/undefined 입력에 대해 false를 반환한다', () => {
      expect(scopeChecker.hasRelevantDocuments(null as unknown as SearchOutput)).toBe(false);
      expect(scopeChecker.hasRelevantDocuments(undefined as unknown as SearchOutput)).toBe(false);
    });
  });

  describe('DISCLAIMER 상수', () => {
    it('면책 고지가 "법적 효력이 없습니다"를 포함한다', () => {
      expect(DISCLAIMER).toContain('법적 효력이 없습니다');
    });

    it('면책 고지가 "참고용"을 포함한다', () => {
      expect(DISCLAIMER).toContain('참고용');
    });
  });

  describe('SUPPORTED_CATEGORIES 상수', () => {
    it('7개 카테고리를 포함한다', () => {
      expect(SUPPORTED_CATEGORIES).toHaveLength(7);
    });

    it('필수 카테고리를 모두 포함한다', () => {
      expect(SUPPORTED_CATEGORIES).toContain('임대차');
      expect(SUPPORTED_CATEGORIES).toContain('매매');
      expect(SUPPORTED_CATEGORIES).toContain('등기');
      expect(SUPPORTED_CATEGORIES).toContain('중개');
      expect(SUPPORTED_CATEGORIES).toContain('세금');
      expect(SUPPORTED_CATEGORIES).toContain('토지이용');
      expect(SUPPORTED_CATEGORIES).toContain('재건축/재개발');
    });
  });
});

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createMockSearchResult(
  options: { isLowRelevance?: boolean } = {}
): SearchResult {
  return {
    id: `doc-${Math.random().toString(36).slice(2)}`,
    type: SearchResultType.LAW,
    content: '테스트 문서 내용',
    score: options.isLowRelevance ? 0.3 : 0.85,
    source: {
      title: '테스트 법령',
      date: '2024-01-01',
      isLowRelevance: options.isLowRelevance ?? false,
    },
  };
}
