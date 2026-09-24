/**
 * Crossword dictionary and word indexing.
 *
 * Words and quality scores come from the Collaborative Word List by Crossword Nexus
 * (MIT License), filtered to A-Z entries of 3-15 letters scoring 50 or more.
 * See packages/server/data/WORDLIST_LICENSE.md. An offensive-word blocklist is applied on load.
 */

import fs from 'fs';

export interface ScoredWord {
  word: string;
  score: number;
}

// Blocklist of offensive words and slurs to prevent them from appearing in generated crosswords
export const OFFENSIVE_BLOCKLIST = new Set([
  'ASSHOLE',
  'BITCH',
  'BASTARD',
  'CUNT',
  'DICK',
  'FUCK',
  'FUCKING',
  'NIGGER',
  'RETARD',
  'SLUT',
  'WHORE',
  'CHINK',
  'SPIC',
  'KIKE',
  'FAGGOT',
  'COCK',
  'SHIT',
  'TWAT',
  'PUSSY',
  'RETARDS',
  'RETARDED',
]);

// Roots that are offensive anywhere inside an entry, which matters for multi-word phrases
// (e.g. "...SHIT..."). Ambiguous roots (DICK, COCK, SPIC, TWAT...) stay exact-match only,
// since they appear inside ordinary words like DICKENS, PEACOCK, SPICE, and HOTWATER.
const OFFENSIVE_ROOTS = /FUCK|SHIT|CUNT|NIGG|FAGGOT|WHORE|BITCH|ASSHOLE|SLUT|DILDO|JIZZ|COCKSUCK|KIKE/;

export function isOffensive(word: string): boolean {
  return OFFENSIVE_BLOCKLIST.has(word) || OFFENSIVE_ROOTS.test(word);
}

/**
 * Curated vocabulary across word lengths 3 through 15 with quality ratings (50-95).
 * Common, lively words are prioritized.
 */
const WORD_LIST_PATH = new URL('../../data/xwordlist.txt', import.meta.url);

/**
 * Reads a `WORD;score` file, one entry per line.
 */
export function loadWordListFile(filePath: string | URL = WORD_LIST_PATH): [string, number][] {
  const entries: [string, number][] = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const sep = line.indexOf(';');
    if (sep <= 0) continue;
    const score = Number(line.slice(sep + 1));
    if (Number.isFinite(score)) {
      entries.push([line.slice(0, sep), score]);
    }
  }
  return entries;
}

interface LengthIndex {
  words: ScoredWord[];
  // bits[pos * 26 + letter] is a bitset over `words` of entries with that letter at that position.
  bits: Uint32Array[];
}

export class CrosswordDictionary {
  private wordsByLength: Map<number, ScoredWord[]> = new Map();
  private allWordsSet: Set<string> = new Set();
  // Built lazily per length and dropped when words are added.
  private indexes: Map<number, LengthIndex> = new Map();

  constructor(entries: [string, number][] = loadWordListFile()) {
    this.loadWords(entries);
  }

  private loadWords(raw: [string, number][]) {
    for (const [w, score] of raw) {
      const clean = w.trim().toUpperCase();
      if (!/^[A-Z]+$/.test(clean) || isOffensive(clean)) {
        continue;
      }
      if (clean.length < 3 || clean.length > 15 || this.allWordsSet.has(clean)) {
        continue;
      }

      this.allWordsSet.add(clean);
      const entry: ScoredWord = { word: clean, score };

      if (!this.wordsByLength.has(clean.length)) {
        this.wordsByLength.set(clean.length, []);
      }
      this.wordsByLength.get(clean.length)!.push(entry);
    }

    // Sort by descending score
    for (const list of this.wordsByLength.values()) {
      list.sort((a, b) => b.score - a.score);
    }
  }

  public get size(): number {
    return this.allWordsSet.size;
  }

  public hasWord(word: string): boolean {
    return this.allWordsSet.has(word.trim().toUpperCase());
  }

  /**
   * Adds custom words (e.g. from LLM theme seeds) with a high score.
   */
  public addCustomWord(word: string, score = 98) {
    const clean = word.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (clean.length < 3 || clean.length > 15 || isOffensive(clean)) return;

    if (!this.allWordsSet.has(clean)) {
      this.allWordsSet.add(clean);
      const entry: ScoredWord = { word: clean, score };
      if (!this.wordsByLength.has(clean.length)) {
        this.wordsByLength.set(clean.length, []);
      }
      this.wordsByLength.get(clean.length)!.unshift(entry);
      this.indexes.delete(clean.length);
    }
  }

  private getIndex(len: number): LengthIndex {
    let index = this.indexes.get(len);
    if (index) return index;

    const words = this.wordsByLength.get(len) || [];
    const wordsPerBitset = Math.ceil(words.length / 32);
    const bits = Array.from({ length: len * 26 }, () => new Uint32Array(wordsPerBitset));
    words.forEach((entry, i) => {
      for (let pos = 0; pos < len; pos++) {
        bits[pos * 26 + (entry.word.charCodeAt(pos) - 65)][i >>> 5] |= 1 << (i & 31);
      }
    });

    index = { words, bits };
    this.indexes.set(len, index);
    return index;
  }

  /**
   * Returns the bitset of words matching the pattern, or null when every position is a wildcard.
   */
  private matchBits(pattern: string, index: LengthIndex): Uint32Array | null {
    let result: Uint32Array | null = null;
    for (let pos = 0; pos < pattern.length; pos++) {
      const ch = pattern.charCodeAt(pos);
      if (ch === 46) continue; // '.'
      const letterBits = index.bits[pos * 26 + (ch - 65)];
      if (!letterBits) return new Uint32Array(0);
      if (!result) {
        result = letterBits.slice();
      } else {
        for (let k = 0; k < result.length; k++) result[k] &= letterBits[k];
      }
    }
    return result;
  }

  /**
   * Finds matching candidate words given a pattern like "C..T" or "A.P.E"
   * '.' represents any letter. Results keep the dictionary's score order.
   */
  public findMatches(pattern: string): ScoredWord[] {
    const index = this.getIndex(pattern.length);
    const bits = this.matchBits(pattern, index);
    if (!bits) return index.words;

    const matches: ScoredWord[] = [];
    for (let k = 0; k < bits.length; k++) {
      let block = bits[k];
      while (block !== 0) {
        const bit = 31 - Math.clz32(block & -block);
        matches.push(index.words[(k << 5) + bit]);
        block &= block - 1;
      }
    }
    return matches;
  }

  /**
   * Counts words matching the pattern (including words already used elsewhere).
   */
  public countMatches(pattern: string): number {
    const index = this.getIndex(pattern.length);
    const bits = this.matchBits(pattern, index);
    if (!bits) return index.words.length;

    let count = 0;
    for (let k = 0; k < bits.length; k++) {
      let block = bits[k];
      while (block !== 0) {
        block &= block - 1;
        count++;
      }
    }
    return count;
  }

  /**
   * True when at least one word matching the pattern isn't in `exclude`.
   */
  public hasMatch(pattern: string, exclude: Set<string>): boolean {
    const index = this.getIndex(pattern.length);
    const bits = this.matchBits(pattern, index);
    if (!bits) return index.words.some((w) => !exclude.has(w.word));

    for (let k = 0; k < bits.length; k++) {
      let block = bits[k];
      while (block !== 0) {
        const bit = 31 - Math.clz32(block & -block);
        if (!exclude.has(index.words[(k << 5) + bit].word)) return true;
        block &= block - 1;
      }
    }
    return false;
  }
}

export const defaultDictionary = new CrosswordDictionary();
