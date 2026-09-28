/**
 * 한국어 NLP 모듈
 *
 * 한국어 형태소 분석, 키워드 추출, 주제 분류, 언어 감지 기능을 제공한다.
 * Lambda 환경에서 네이티브 형태소 분석기(mecab-ko) 사용이 어렵기 때문에
 * 규칙 기반 한국어 형태소 분석기를 구현하여 사용한다.
 *
 * @module KoreanNLPModule
 * @requirements 9.1, 9.2, 9.6, 9.7
 */

/**
 * 주제 분류 결과 인터페이스
 */
export interface TopicClassificationResult {
  /** 부동산 법률 관련 여부 */
  isRealEstateLaw: boolean;
  /** 감지된 주제 목록 */
  topics: string[];
}

/**
 * 언어 감지 결과 타입
 */
export type DetectedLanguage = 'korean' | 'mixed' | 'unknown';

/**
 * 한국어 불용어(조사/어미/보조용언) 목록
 * 형태소 분석 시 제거할 대상
 */
const STOP_WORDS: Set<string> = new Set([
  // 주격/목적격/관형격 조사
  '은', '는', '이', '가', '을', '를', '의',
  // 부사격 조사
  '에', '에서', '으로', '로', '와', '과', '도', '만', '까지', '부터',
  // 접속/보조 조사
  '이나', '나', '이란', '란', '이라', '라', '처럼', '같이', '보다', '마다',
  // 보조 용언/서술격 조사
  '하다', '이다', '있다', '되다', '않다', '없다', '못하다',
  // 기타 빈출 어미/접사
  '것', '수', '때', '중', '등', '들', '및', '또는', '그리고', '하지만',
  '대해', '대한', '위한', '위해', '통해', '따라', '관한', '관해',
]);

/**
 * 한국어 조사 패턴 (어절 끝에서 분리 대상)
 * 길이가 긴 것부터 매칭하여 최장 일치를 적용한다.
 */
const PARTICLES: string[] = [
  // 3글자 조사
  '에서는', '으로는', '까지는', '부터는', '에서의', '으로의',
  '이라는', '라는', '에서도', '으로도',
  // 2글자 조사
  '에서', '으로', '까지', '부터', '에게', '한테', '처럼', '같이',
  '보다', '마다', '이나', '이란', '이라', '에는', '에도', '와는',
  '과는', '도는', '만은', '로의', '로는', '에의',
  // 1글자 조사
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과',
  '도', '만', '나', '라', '든', '며',
];

/**
 * 부동산 법률 주제별 관련 용어 사전
 * 각 주제에 해당하는 키워드를 매핑한다.
 */
const REAL_ESTATE_TOPIC_DICTIONARY: Record<string, string[]> = {
  임대차: [
    '임대차', '임대', '임차', '전세', '월세', '보증금', '임대인', '임차인',
    '세입자', '집주인', '임대료', '차임', '전세금', '반전세', '임대차보호법',
    '주택임대차', '상가임대차', '계약갱신', '갱신청구권', '대항력', '확정일자',
    '우선변제', '최우선변제', '소액임차인', '임대차계약', '전월세', '퇴거',
    '명도', '보증금반환', '전세보증보험', '임대차분쟁',
  ],
  매매: [
    '매매', '매수', '매도', '매입', '매각', '거래', '계약금', '중도금', '잔금',
    '매매계약', '부동산거래', '거래신고', '실거래가', '매매대금', '소유권이전',
    '잔금지급', '계약해제', '위약금', '해약금', '가계약', '본계약',
    '부동산매매', '토지매매', '아파트매매', '주택매매',
  ],
  등기: [
    '등기', '소유권', '근저당', '저당권', '등기부', '등기부등본', '등기사항',
    '소유권이전등기', '보존등기', '말소등기', '가등기', '본등기', '등기원인',
    '등기권리자', '등기의무자', '등기관', '부동산등기법', '등기소',
    '전세권등기', '지상권등기', '가압류', '압류', '경매개시결정등기',
  ],
  중개: [
    '중개', '공인중개사', '중개수수료', '중개보수', '중개업', '중개사무소',
    '공인중개사법', '중개대상물', '중개계약', '전속중개', '일반중개',
    '중개사고', '중개책임', '부동산중개', '중개의뢰', '중개업자',
  ],
  세금: [
    '세금', '취득세', '양도세', '양도소득세', '재산세', '종합부동산세', '종부세',
    '부가가치세', '증여세', '상속세', '등록세', '인지세', '지방세',
    '세율', '과세', '비과세', '감면', '공제', '납부', '신고',
    '양도차익', '취득가액', '양도가액', '과세표준', '세금계산',
  ],
  토지이용: [
    '토지', '토지이용', '용도지역', '용도지구', '용도구역', '건폐율', '용적률',
    '지목', '지적', '토지이용계획', '국토계획법', '개발행위', '개발허가',
    '건축허가', '농지', '농지전용', '산지', '임야', '녹지', '주거지역',
    '상업지역', '공업지역', '토지수용', '토지보상',
  ],
  재건축: [
    '재건축', '재개발', '정비사업', '조합', '조합원', '정비구역', '관리처분',
    '분담금', '추가분담금', '이주비', '재건축초과이익', '초과이익환수',
    '재건축부담금', '안전진단', '정비계획', '사업시행', '조합설립',
    '매도청구', '도시정비법',
  ],
  분양: [
    '분양', '분양권', '분양가', '분양계약', '사전청약', '청약', '청약통장',
    '당첨', '특별공급', '일반공급', '분양가상한제', '전매', '전매제한',
    '입주', '입주권', '모델하우스', '분양대금', '중도금대출', '잔금대출',
  ],
  경매: [
    '경매', '공매', '낙찰', '유찰', '입찰', '최저가', '감정가', '매각',
    '배당', '배당요구', '경매개시', '임의경매', '강제경매', '경락',
    '매수인', '채권자', '채무자', '경매물건', '권리분석', '인수조건',
    '말소기준권리', '대항력', '배당순위',
  ],
  재개발: [
    '재개발', '도시재개발', '주택재개발', '도시환경정비', '정비사업',
    '재개발구역', '재개발조합', '이주대책', '세입자대책', '관리처분계획',
  ],
};

/**
 * 부동산 법률 전문 용어 사전
 * 키워드 추출 시 해당 용어가 포함되면 우선적으로 추출한다.
 */
const REAL_ESTATE_LAW_TERMS: Set<string> = new Set([
  // 모든 주제 사전의 용어를 통합
  ...Object.values(REAL_ESTATE_TOPIC_DICTIONARY).flat(),
]);

/**
 * 한국어 동사/형용사 어미 패턴
 * 어간 추출 시 제거할 어미 목록
 */
const VERB_ENDINGS: string[] = [
  '합니다', '합니까', '하세요', '하십시오', '하겠습니다',
  '됩니다', '됩니까', '되었습니다', '되나요', '되는지',
  '입니다', '입니까', '인가요', '인지',
  '습니다', '습니까', '었습니다', '겠습니다',
  '는데요', '는데', '는지', '나요', '을까요', 'ㄹ까요',
  '했다', '한다', '된다', '인다', '있다', '없다',
  '하는', '하면', '하고', '해서', '하여', '해야', '할',
  '되는', '되면', '되고', '되어', '돼서', '되어서',
];

/**
 * 한국어 NLP 모듈 클래스
 *
 * 규칙 기반 한국어 형태소 분석을 통해 키워드 추출, 주제 분류,
 * 언어 감지 기능을 제공한다.
 *
 * Lambda 환경에 적합한 경량 구현으로, 네이티브 형태소 분석기 없이
 * 조사 분리, 어미 제거, 부동산 법률 용어 사전 기반 추출을 수행한다.
 */
export class KoreanNLPModule {
  /**
   * 한국어 텍스트에서 키워드를 추출한다.
   *
   * 형태소 분석을 통해 명사와 동사 어간을 추출하고,
   * 불용어를 제거하여 의미 있는 키워드만 반환한다.
   *
   * @param text - 분석할 한국어 텍스트
   * @returns 추출된 키워드 배열 (1~10개)
   *
   * @requirements 9.1, 9.2, 9.7
   */
  extractKeywords(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const normalizedText = this.normalizeText(text);

    // 1. 부동산 법률 전문 용어를 먼저 추출 (사전 기반 매칭)
    const dictionaryKeywords = this.extractDictionaryTerms(normalizedText);

    // 2. 규칙 기반 형태소 분석으로 추가 키워드 추출
    const morphemeKeywords = this.extractMorphemeKeywords(normalizedText);

    // 3. 복합 명사 추출
    const compoundNouns = this.extractCompoundNouns(normalizedText);

    // 4. 결과 통합 및 중복 제거 (사전 용어 우선)
    const allKeywords = [
      ...dictionaryKeywords,
      ...compoundNouns,
      ...morphemeKeywords,
    ];

    const uniqueKeywords = this.deduplicateKeywords(allKeywords);

    // 5. 1~10개 제한 적용
    const result = uniqueKeywords.slice(0, 10);

    // 최소 1개 보장: 키워드가 없으면 원본 텍스트에서 가장 긴 어절 사용
    if (result.length === 0) {
      const fallback = this.getFallbackKeyword(normalizedText);
      if (fallback) {
        return [fallback];
      }
    }

    return result;
  }

  /**
   * 텍스트의 부동산 법률 주제를 분류한다.
   *
   * 미리 정의된 부동산 법률 용어 사전을 기반으로
   * 텍스트에 포함된 주제를 판별한다.
   *
   * @param text - 분류할 텍스트
   * @returns 부동산 법률 관련 여부와 감지된 주제 목록
   *
   * @requirements 9.6
   */
  classifyTopic(text: string): TopicClassificationResult {
    if (!text || text.trim().length === 0) {
      return { isRealEstateLaw: false, topics: [] };
    }

    const normalizedText = this.normalizeText(text);
    const detectedTopics: string[] = [];

    // 각 주제별로 관련 용어 매칭 점수를 계산
    for (const [topic, terms] of Object.entries(REAL_ESTATE_TOPIC_DICTIONARY)) {
      const matchCount = terms.filter((term) =>
        normalizedText.includes(term)
      ).length;

      // 1개 이상의 관련 용어가 매칭되면 해당 주제로 분류
      if (matchCount > 0) {
        detectedTopics.push(topic);
      }
    }

    return {
      isRealEstateLaw: detectedTopics.length > 0,
      topics: detectedTopics,
    };
  }

  /**
   * 텍스트의 언어를 감지한다.
   *
   * 유니코드 범위를 기반으로 한국어(한글) 포함 여부를 판별한다.
   * - 한글 음절: U+AC00 ~ U+D7AF
   * - 한글 자모: U+1100 ~ U+11FF
   * - 한글 호환 자모: U+3130 ~ U+318F
   *
   * @param text - 감지할 텍스트
   * @returns 감지된 언어 ('korean' | 'mixed' | 'unknown')
   */
  detectLanguage(text: string): DetectedLanguage {
    if (!text || text.trim().length === 0) {
      return 'unknown';
    }

    const cleanText = text.replace(/[\s\d\p{P}\p{S}]/gu, '');

    if (cleanText.length === 0) {
      return 'unknown';
    }

    let koreanCharCount = 0;
    let otherCharCount = 0;

    for (const char of cleanText) {
      if (this.isHangul(char)) {
        koreanCharCount++;
      } else {
        otherCharCount++;
      }
    }

    const totalChars = koreanCharCount + otherCharCount;

    if (totalChars === 0) {
      return 'unknown';
    }

    const koreanRatio = koreanCharCount / totalChars;

    if (koreanRatio >= 0.8) {
      return 'korean';
    } else if (koreanRatio > 0 && koreanRatio < 0.8) {
      return 'mixed';
    }

    return 'unknown';
  }

  // ─── Private Helper Methods ────────────────────────────────────────────────

  /**
   * 텍스트를 정규화한다.
   * 불필요한 공백, 특수문자를 정리한다.
   */
  private normalizeText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 부동산 법률 전문 용어 사전에서 매칭되는 용어를 추출한다.
   */
  private extractDictionaryTerms(text: string): string[] {
    const found: string[] = [];

    for (const term of REAL_ESTATE_LAW_TERMS) {
      if (term.length >= 2 && text.includes(term)) {
        found.push(term);
      }
    }

    // 길이가 긴 것을 우선 (더 구체적인 용어)
    found.sort((a, b) => b.length - a.length);

    // 포함 관계 제거: 더 긴 용어가 이미 있으면 짧은 용어 제거
    const filtered: string[] = [];
    for (const term of found) {
      const isSubstring = filtered.some(
        (existing) => existing !== term && existing.includes(term)
      );
      if (!isSubstring) {
        filtered.push(term);
      }
    }

    return filtered;
  }

  /**
   * 규칙 기반 형태소 분석으로 키워드를 추출한다.
   * 어절을 분리하고 조사를 제거하여 명사/동사 어간을 추출한다.
   */
  private extractMorphemeKeywords(text: string): string[] {
    const words = text.split(/\s+/);
    const keywords: string[] = [];

    for (const word of words) {
      const stems = this.analyzeWord(word);
      for (const stem of stems) {
        if (this.isValidKeyword(stem)) {
          keywords.push(stem);
        }
      }
    }

    return keywords;
  }

  /**
   * 개별 어절을 분석하여 어간/명사를 추출한다.
   */
  private analyzeWord(word: string): string[] {
    const results: string[] = [];

    // 1. 동사/형용사 어미 제거 시도
    const verbStem = this.stripVerbEnding(word);
    if (verbStem && verbStem.length >= 2) {
      results.push(verbStem);
    }

    // 2. 조사 분리
    const nounForm = this.stripParticle(word);
    if (nounForm && nounForm.length >= 2) {
      results.push(nounForm);
    }

    // 3. 원형이 2글자 이상이면 그대로 추가
    if (word.length >= 2 && results.length === 0) {
      results.push(word);
    }

    return results;
  }

  /**
   * 어절에서 조사를 분리한다.
   * 가장 긴 조사부터 매칭하여 분리한다.
   */
  private stripParticle(word: string): string | null {
    for (const particle of PARTICLES) {
      if (word.endsWith(particle) && word.length > particle.length) {
        const stem = word.slice(0, -particle.length);
        if (stem.length >= 2) {
          return stem;
        }
      }
    }
    return null;
  }

  /**
   * 동사/형용사 어미를 제거하여 어간을 추출한다.
   */
  private stripVerbEnding(word: string): string | null {
    for (const ending of VERB_ENDINGS) {
      if (word.endsWith(ending) && word.length > ending.length) {
        const stem = word.slice(0, -ending.length);
        if (stem.length >= 2) {
          return stem;
        }
      }
    }
    return null;
  }

  /**
   * 복합 명사를 추출한다.
   * 연속된 한글 2~4글자 조합이 법률 용어 사전에 있는지 확인한다.
   */
  private extractCompoundNouns(text: string): string[] {
    const compounds: string[] = [];
    const cleanText = text.replace(/[^가-힣\s]/g, '');
    const words = cleanText.split(/\s+/);

    // 인접 어절 결합으로 복합 명사 후보 생성
    for (let i = 0; i < words.length - 1; i++) {
      const stemA = this.stripParticle(words[i]) || words[i];
      const stemB = this.stripParticle(words[i + 1]) || words[i + 1];
      const compound = stemA + stemB;

      if (REAL_ESTATE_LAW_TERMS.has(compound)) {
        compounds.push(compound);
      }
    }

    return compounds;
  }

  /**
   * 유효한 키워드인지 검증한다.
   * - 2글자 이상
   * - 불용어가 아닌 것
   * - 한글이 포함된 것
   */
  private isValidKeyword(word: string): boolean {
    if (word.length < 2) {
      return false;
    }

    if (STOP_WORDS.has(word)) {
      return false;
    }

    // 한글이 하나라도 포함되어야 함
    return /[가-힣]/.test(word);
  }

  /**
   * 키워드 중복을 제거한다.
   * 동일 키워드와 포함 관계를 모두 고려한다.
   */
  private deduplicateKeywords(keywords: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const keyword of keywords) {
      if (!seen.has(keyword)) {
        seen.add(keyword);
        result.push(keyword);
      }
    }

    return result;
  }

  /**
   * 키워드 추출 실패 시 대체 키워드를 반환한다.
   */
  private getFallbackKeyword(text: string): string | null {
    const words = text
      .split(/\s+/)
      .filter((w) => w.length >= 2 && /[가-힣]/.test(w));

    if (words.length === 0) {
      return null;
    }

    // 가장 긴 어절을 반환 (조사 분리 후)
    const sorted = words
      .map((w) => this.stripParticle(w) || w)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
      .sort((a, b) => b.length - a.length);

    return sorted.length > 0 ? sorted[0] : words[0];
  }

  /**
   * 문자가 한글인지 확인한다.
   * 한글 음절 (U+AC00-U+D7AF), 한글 자모 (U+1100-U+11FF),
   * 한글 호환 자모 (U+3130-U+318F) 범위를 체크한다.
   */
  private isHangul(char: string): boolean {
    const code = char.charCodeAt(0);
    return (
      (code >= 0xac00 && code <= 0xd7af) || // 한글 음절
      (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
      (code >= 0x3130 && code <= 0x318f)    // 한글 호환 자모
    );
  }
}
