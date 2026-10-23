// Friendly labels for mistake patterns (snake_case ids produced by the LLM).
// Each entry: [English label, short Korean label].

const LABELS = {
  past_tense_with_past_time: ['Past tense with past-time words', '과거 시간 표현 + 과거형'],
  past_tense: ['Past tense', '과거형'],
  third_person_s: ['Third-person -s', '3인칭 단수 -s'],
  subject_verb_agreement: ['Subject–verb agreement', '주어·동사 수 일치'],
  be_verb_with_verb: ['Extra "be" before a verb', '동사 앞 불필요한 be'],
  be_plus_verb: ['Extra "be" before a verb', '동사 앞 불필요한 be'],
  be_verb_misuse: ['Extra "be" before a verb', '동사 앞 불필요한 be'],
  verb_pattern: ['Verb patterns', '동사 뒤 구조'],
  preposition_choice: ['Prepositions', '전치사 선택'],
  unnatural_phrasing: ['Natural phrasing', '자연스러운 표현'],
  korean_switch: ['Saying it in English', '영어로 말하기'],
  missing_article: ['Missing article (a / the)', '관사 빠짐'],
  article: ['Articles (a / the)', '관사'],
  wrong_article: ['Wrong article', '관사 잘못 씀'],
  preposition: ['Prepositions', '전치사'],
  wrong_preposition: ['Wrong preposition', '전치사 잘못 씀'],
  missing_preposition: ['Missing preposition', '전치사 빠짐'],
  explain_to_me: ['"Explain to" someone', 'explain 뒤 to'],
  word_choice: ['Word choice', '단어 선택'],
  word_order: ['Word order', '어순'],
  plural: ['Plural nouns', '복수형'],
  plural_noun: ['Plural nouns', '복수형'],
  countable_uncountable: ['Countable vs. uncountable', '셀 수 있는/없는 명사'],
  missing_subject: ['Missing subject', '주어 빠짐'],
  missing_object: ['Missing object', '목적어 빠짐'],
  tense_consistency: ['Tense consistency', '시제 일관성'],
  present_perfect: ['Present perfect', '현재완료'],
  gerund_infinitive: ['Gerund vs. infinitive', '동명사 / to부정사'],
  question_form: ['Question word order', '의문문 어순'],
  indirect_question: ['Indirect questions', '간접 의문문'],
  konglish: ['Konglish expressions', '콩글리시 표현'],
  politeness: ['Politeness & tone', '공손한 표현'],
  collocation: ['Natural word pairs', '자연스러운 단어 조합'],
  pronoun: ['Pronouns', '대명사'],
  comparative: ['Comparatives', '비교급'],
};

export function titleCase(id) {
  return String(id || 'other')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** @returns {{pattern:string, label:string, label_ko:string}} */
export function labelFor(pattern) {
  const key = String(pattern || 'other').toLowerCase().trim();
  const hit = LABELS[key];
  if (hit) return { pattern: key, label: hit[0], label_ko: hit[1] };
  return { pattern: key, label: titleCase(key), label_ko: '' };
}

export const PATTERN_LABELS = LABELS;
