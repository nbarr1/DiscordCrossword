import { GAME_CONFIG, GridSlot, computeGridSlots } from '@crossword/shared';
import { CrosswordDictionary, defaultDictionary } from './wordlist.js';

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

    // Slots crossing each slot, so forward checking only revisits entries a placement can affect.
    const slotKey = (slot: GridSlot) => `${slot.number}-${slot.direction}`;
    const slotsByCell = new Map<string, GridSlot[]>();
    for (const slot of allSlots) {
      for (const { row, col } of slot.cells) {
        const cellKey = `${row},${col}`;
        if (!slotsByCell.has(cellKey)) slotsByCell.set(cellKey, []);
        slotsByCell.get(cellKey)!.push(slot);
      }
    }
    const crossingSlots = new Map<string, GridSlot[]>();
    for (const slot of allSlots) {
      const crossing = new Set<GridSlot>();
      for (const { row, col } of slot.cells) {
        for (const other of slotsByCell.get(`${row},${col}`)!) {
          if (other !== slot) crossing.add(other);
        }
      }
      crossingSlots.set(slotKey(slot), [...crossing]);
    }

    const search = (implicit: string[]): boolean => {
      nodesExplored++;
      if (nodesExplored % 20 === 0) {
        if (Date.now() - startTime > timeBudgetMs) {
          timedOut = true;
          return false;
        }
      }

      // Find unfilled slots and pick the most constrained (MRV)
      let target: { slot: GridSlot; pattern: string; count: number } | null = null;

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
          implicit.push(key);
          continue;
        }

        const count = this.dictionary.countMatches(pattern);
        if (count === 0) {
          // Dead end!
          return false;
        }

        if (!target || count < target.count) {
          target = { slot, pattern, count };
        }
      }

      if (!target) {
        // All slots filled!
        return true;
      }

      const slot = target.slot;
      const key = `${slot.number}-${slot.direction}`;

      // Order candidates by quality score, with a seeded jitter so fills vary between runs
      const candidates = this.dictionary
        .findMatches(target.pattern)
        .filter((c) => !usedWords.has(c.word))
        .map((c) => ({ ...c, rank: c.score + random() * 10 }))
        .sort((a, b) => b.rank - a.rank);

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

        // Forward-checking: verify that crossing slots still have at least 1 candidate
        let forwardCheckOk = true;
        for (const other of crossingSlots.get(key)!) {
          if (slotWords[slotKey(other)]) continue;

          const pat = getPattern(other);
          const ok = pat.includes('.')
            ? this.dictionary.hasMatch(pat, usedWords)
            : this.dictionary.hasWord(pat) && !usedWords.has(pat);
          if (!ok) {
            forwardCheckOk = false;
            break;
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

    // Words completed by crossing letters are recorded as a side effect of search();
    // undo them when this branch fails, or backtracking leaves stale (possibly invalid) entries.
    const solve = (): boolean => {
      const implicit: string[] = [];
      if (search(implicit)) return true;
      for (const key of implicit) {
        usedWords.delete(slotWords[key]);
        delete slotWords[key];
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
