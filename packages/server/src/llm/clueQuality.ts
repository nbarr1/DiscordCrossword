// Endings that make a word an obvious form of the answer (ONE and ONES, ERA and ERAS).
const DERIVATIVE_SUFFIXES = ['', 'S', 'ES', 'D', 'ED', 'ING', 'ER', 'ERS', 'LY'];

/**
 * True when a clue gives its answer away: the answer, the answer with one of the endings above,
 * or the answer without one of them appears as a whole word or as a run of consecutive words.
 * Answers are stored without spaces, so "Ironclad rule" reveals IRONCLADRULE.
 *
 * Matching whole words, not substrings, keeps ordinary clues: "Someone special" doesn't
 * reveal ONE, and "Take care of" doesn't reveal ARE.
 */
export function clueRevealsAnswer(clue: string, answer: string): boolean {
  const target = answer.toUpperCase().replace(/[^A-Z]/g, '');
  if (target.length < 3) return false;

  const words = clue.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < words.length && joined.length <= target.length + 3; j++) {
      joined += words[j];
      if (DERIVATIVE_SUFFIXES.some((s) => joined === target + s)) return true;
      if (joined.length >= 3 && DERIVATIVE_SUFFIXES.some((s) => s && target === joined + s)) return true;
    }
  }
  return false;
}
