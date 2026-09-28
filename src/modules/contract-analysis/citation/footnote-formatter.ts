/**
 * 각주 포맷터 (FootnoteFormatter)
 *
 * 각 위험 조항에 대해 근거 법조항(법령명·조항번호)·판례를 각주 형태로
 * 부여한다. 본문 내 각주 번호([1], [2] …)는 조항별로 등장 순서에 따라
 * 1부터 연속 부여되며, 하단 근거 목록의 N번째 항목과 1:1 대응한다.
 *
 * 주요 규칙:
 *   - 조항당 각주 수는 최대 5개로 제한한다(초과 근거는 절삭). (Property 23, 요구사항 7.1)
 *   - 각주 번호는 근거 목록의 등장 순서대로 1부터 빈틈없이 부여된다. (Property 23, 요구사항 7.2)
 *   - 특정 조항에 근거가 하나도 없으면 noBasisFound=true 로 표시하고,
 *     나머지 조항의 각주 부여는 계속 진행한다. (요구사항 7.6)
 *
 * @module FootnoteFormatter
 * @requirements 7.1, 7.2, 7.6
 */

import type {
  RiskClause,
  LegalReference,
} from '../interfaces/index.js';
import type {
  AnnotatedClause,
  CitationInput,
  CitationOutput,
  Footnote,
} from '../interfaces/citation.js';

/** 조항당 부여 가능한 각주의 최대 개수 (요구사항 7.1) */
export const MAX_FOOTNOTES_PER_CLAUSE = 5;

/**
 * 각주 포맷터
 *
 * @requirements 7.1, 7.2, 7.6
 */
export class FootnoteFormatter {
  /**
   * 위험 조항 목록과 근거 매핑을 받아 각 조항에 각주를 부여한다.
   *
   * 조항의 등장 순서를 유지하며, 각 조항 내부에서 근거 목록의 순서대로
   * 1부터 연속하는 각주 번호를 부여한다. 근거가 없는 조항은 빈 각주 목록과
   * noBasisFound=true 로 표시하되, 나머지 조항 처리는 계속한다.
   *
   * @param input - 위험 조항 목록과 clauseId→근거 목록 매핑
   * @returns 각주가 부여된 조항 목록
   *
   * @requirements 7.1, 7.2, 7.6
   */
  format(input: CitationInput): CitationOutput {
    const annotatedClauses = input.riskClauses.map((clause) =>
      this.annotateClause(clause, input.legalReferences[clause.clauseId] ?? []),
    );
    return { annotatedClauses };
  }

  /**
   * 단일 위험 조항에 대해 각주를 부여한다.
   *
   * 근거 목록을 등장 순서대로 최대 5개까지 취하여, 1부터 연속하는 번호를
   * 부여한다. 유효한 근거가 하나도 없으면 noBasisFound=true 로 표시한다.
   *
   * @param clause - 대상 위험 조항
   * @param references - 해당 조항의 근거 목록 (등장 순서 유지)
   * @returns 각주가 부여된 조항
   *
   * @requirements 7.1, 7.2, 7.6
   */
  private annotateClause(
    clause: RiskClause,
    references: LegalReference[],
  ): AnnotatedClause {
    const validReferences = references.filter((ref) =>
      this.isValidReference(ref),
    );
    const limited = validReferences.slice(0, MAX_FOOTNOTES_PER_CLAUSE);

    const footnotes: Footnote[] = limited.map((reference, index) => ({
      // 본문 등장 순서대로 1부터 연속 부여 (요구사항 7.2)
      number: index + 1,
      reference,
    }));

    return {
      clauseId: clause.clauseId,
      footnotes,
      noBasisFound: footnotes.length === 0,
    };
  }

  /**
   * 근거 참조가 각주로 표시할 만한 최소 정보를 갖추었는지 확인한다.
   *
   * 법조항(law_article)은 법령명 또는 조항 번호가 있어야 하고, 판례
   * (precedent)는 사건번호가 있어야 유효한 근거로 간주한다. 요약(summary)만
   * 존재하는 경우에도 근거로 인정한다.
   *
   * @param reference - 근거 참조
   * @returns 유효한 근거이면 true
   */
  private isValidReference(reference: LegalReference): boolean {
    if (!reference || typeof reference !== 'object') {
      return false;
    }
    const hasSummary =
      typeof reference.summary === 'string' && reference.summary.trim() !== '';
    if (reference.type === 'law_article') {
      return (
        this.isNonEmpty(reference.lawName) ||
        this.isNonEmpty(reference.articleNumber) ||
        hasSummary
      );
    }
    if (reference.type === 'precedent') {
      return this.isNonEmpty(reference.caseNumber) || hasSummary;
    }
    return false;
  }

  /**
   * 문자열 값이 존재하고 공백이 아닌지 확인한다.
   *
   * @param value - 검사 대상 문자열
   * @returns 비어있지 않으면 true
   */
  private isNonEmpty(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim() !== '';
  }
}
