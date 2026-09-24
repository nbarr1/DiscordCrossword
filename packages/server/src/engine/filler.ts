import { GAME_CONFIG, GridSlot, computeGridSlots } from '@crossword/shared';
import { CrosswordDictionary, defaultDictionary, ScoredWord } from './wordlist.js';

export interface FillOptions {
  timeBudgetMs?: number;
  seed?: number;
  seedEntries?: { number: number; direction: 'across' | 'down'; word: string }[];
}

export interface FillResult {
  success: boolean;
  solution: string[][] | null;
  slots: GridSlot[];
  slotWords: Record<string, string>;
  stats: {
    nodesExplored: number;
    durationMs: number;
    timedOut: boolean;
  };
}

/**
 * Simple pseudo-random number generator (Mulberry32) for deterministic tests.
 */
function createPrng(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CrosswordFiller {
  private dictionary: CrosswordDictionary;

  constructor(dict: CrosswordDictionary = defaultDictionary) {
    this.dictionary = dict;
  }

  public fill(grid: boolean[][], options: FillOptions = {}): FillResult {
    const startTime = Date.now();
    const timeBudgetMs = options.timeBudgetMs ?? GAME_CONFIG.SOLVER_TIME_BUDGET_MS;
    const random = options.seed !== undefined ? createPrng(options.seed) : Math.random;

    const width = grid[0]?.length || GAME_CONFIG.GRID_WIDTH;
    const height = grid.length || GAME_CONFIG.GRID_HEIGHT;
    const { acrossSlots, downSlots } = computeGridSlots(grid, width, height);
    const allSlots: GridSlot[] = [...acrossSlots, ...downSlots];

    // Build letter grid initialized to '.' for white, '#' for black
    const letters: string[][] = grid.map((row) =>
      row.map((isBlack) => (isBlack ? '#' : '.'))
    );

    const usedWords = new Set<string>();
    const slotWords: Record<string, string> = {};
    let nodesExplored = 0;
    let timedOut = false;

    // Apply any initial seed entries if provided
    if (options.seedEntries) {
      for (const seed of options.seedEntries) {
        const slot = allSlots.find(
          (s) => s.number === seed.number && s.direction === seed.direction
        );
        if (slot && slot.length === seed.word.length) {
          const upper = seed.word.toUpperCase();
          this.dictionary.addCustomWord(upper, 99);
          usedWords.add(upper);
          slotWords[`${slot.number}-${slot.direction}`] = upper;
          for (let i = 0; i < slot.length; i++) {
            const { row, col } = slot.cells[i];
            letters[row][col] = upper[i];
          }
        }
      }
    }

    const getPattern = (slot: GridSlot): string => {
      let pattern = '';
      for (const c of slot.cells) {
        pattern += letters[c.row][c.col];
      }
      return pattern;
    };

    const isSlotFilled = (slot: GridSlot): boolean => {
      return !getPattern(slot).includes('.');
    };

    const solve = (): boolean => {
      nodesExplored++;
      if (nodesExplored % 20 === 0) {
        if (Date.now() - startTime > timeBudgetMs) {
          timedOut = true;
          return false;
        }
      }

      // Find unfilled slots and pick the most constrained (MRV)
      const unfilled: { slot: GridSlot; pattern: string; candidates: ScoredWord[] }[] = [];

      for (const slot of allSlots) {
        const key = `${slot.number}-${slot.direction}`;
        if (slotWords[key]) continue;

        const pattern = getPattern(slot);
        if (!pattern.includes('.')) {
          // Already fully formed by crossing words!
          const word = pattern;
          if (usedWords.has(word) && !slotWords[key]) {
            // Duplicate word across entries!
            return false;
          }
          if (!this.dictionary.hasWord(word)) {
            // Crossing formed an invalid word
            return false;
          }
          slotWords[key] = word;
          usedWords.add(word);
          continue;
        }

        const candidates = this.dictionary
          .findMatches(pattern)
          .filter((c) => !usedWords.has(c.word));

        if (candidates.length === 0) {
          // Dead end!
          return false;
        }

        unfilled.push({ slot, pattern, candidates });
      }

      if (unfilled.length === 0) {
        // All slots filled!
        return true;
      }

      // Sort unfilled slots: fewest candidates first (MRV)
      unfilled.sort((a, b) => a.candidates.length - b.candidates.length);

      const target = unfilled[0];
      const slot = target.slot;
      const key = `${slot.number}-${slot.direction}`;

      // Order candidates by quality score, with deterministic slight jitter
      const candidates = [...target.candidates];
      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return random() - 0.5;
      });

      for (const cand of candidates) {
        if (usedWords.has(cand.word)) continue;

        // Try candidate
        const prevLetters: { row: number; col: number; prev: string }[] = [];
        for (let i = 0; i < slot.length; i++) {
          const { row, col } = slot.cells[i];
          prevLetters.push({ row, col, prev: letters[row][col] });
          letters[row][col] = cand.word[i];
        }

        usedWords.add(cand.word);
        slotWords[key] = cand.word;

        // Forward-checking: verify that intersecting slots still have at least 1 candidate
        let forwardCheckOk = true;
        for (const other of allSlots) {
          const otherKey = `${other.number}-${other.direction}`;
          if (slotWords[otherKey]) continue;

          const pat = getPattern(other);
          if (pat.includes('.')) {
            const matches = this.dictionary.findMatches(pat);
            const validMatches = matches.filter((m) => !usedWords.has(m.word));
            if (validMatches.length === 0) {
              forwardCheckOk = false;
              break;
            }
          }
        }

        if (forwardCheckOk) {
          if (solve()) {
            return true;
          }
        }

        // Backtrack
        delete slotWords[key];
        usedWords.delete(cand.word);
        for (const item of prevLetters) {
          letters[item.row][item.col] = item.prev;
        }

        if (timedOut) return false;
      }

      return false;
    };

    const success = solve();
    const durationMs = Date.now() - startTime;

    return {
      success,
      solution: success ? letters.map((row) => [...row]) : null,
      slots: allSlots,
      slotWords,
      stats: {
        nodesExplored,
        durationMs,
        timedOut,
      },
    };
  }
}
