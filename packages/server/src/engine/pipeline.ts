import {
  addDays,
  buildGridMeta,
  ClientPuzzlePayload,
  computeGridSlots,
  FullPuzzleData,
  GAME_CONFIG,
  getPuzzleDate,
  getPuzzleExpiry,
  GridSlot,
} from '@crossword/shared';
import { queryAll } from '../db/database.js';
import { clueRevealsAnswer } from '../llm/clueQuality.js';
import { defaultLlmProvider } from '../llm/gemini.js';
import { ClueEntryInput, LlmProvider, LlmThemeProposal } from '../llm/types.js';
import { getFallbackPuzzle } from './fallbackPuzzles.js';
import { CrosswordFiller } from './filler.js';
import { PuzzleStatus, savePuzzle } from './puzzleStore.js';
import { getValidatedTemplates } from './templates.js';
import { defaultDictionary, isOffensive } from './wordlist.js';

// Theme entries go in across slots at least this long, so they stand out from the rest of the fill.
const MIN_THEME_ENTRY_LENGTH = 5;
// A theme needs at least this many entries in the grid, or the title would promise more than the puzzle has.
const MIN_THEME_ENTRIES = 2;

export interface ThemeSeed {
  number: number;
  direction: 'across' | 'down';
  word: string;
  clueHint: string;
}

/**
 * Assigns theme words to across slots of the same length, longest word first. Across slots never
 * share cells, so seeds can't conflict with each other. Words that don't fit are dropped.
 */
export function placeThemeEntries(slots: GridSlot[], words: { word: string; clueHint: string }[]): ThemeSeed[] {
  const placed: ThemeSeed[] = [];
  const candidates = words
    .map((w) => ({ word: w.word.toUpperCase().replace(/[^A-Z]/g, ''), clueHint: w.clueHint }))
    .filter((w) => w.word.length >= MIN_THEME_ENTRY_LENGTH && !isOffensive(w.word))
    .sort((a, b) => b.word.length - a.word.length);

  for (const { word, clueHint } of candidates) {
    if (placed.some((p) => p.word === word)) continue;
    const slot = slots.find(
      (s) =>
        s.direction === 'across' &&
        s.length === word.length &&
        !placed.some((p) => p.number === s.number && p.direction === s.direction)
    );
    if (slot) {
      placed.push({ number: slot.number, direction: slot.direction, word, clueHint });
    }
  }
  return placed;
}

const entryKey = (e: { number: number; direction: string }) => `${e.number}-${e.direction}`;

export class PuzzlePipeline {
  private llm: LlmProvider;
  private filler: CrosswordFiller;

  constructor(llm: LlmProvider = defaultLlmProvider) {
    this.llm = llm;
    this.filler = new CrosswordFiller(defaultDictionary);
  }

  /**
   * Generates a single complete crossword puzzle for a given target date, or returns null when
   * every attempt fails (no fill, or the LLM couldn't supply a usable clue for every entry).
   */
  public async generatePuzzle(
    dateStr: string,
    options: { themePrompt?: string; retryLimit?: number } = {}
  ): Promise<FullPuzzleData | null> {
    const maxRetries = options.retryLimit ?? GAME_CONFIG.MAX_PIPELINE_RETRIES;
    const templates = getValidatedTemplates();

    if (templates.length === 0) {
      console.error('[Pipeline] No valid templates available');
      return null;
    }

    // Without an LLM every clue would be a placeholder, which is worse than a hand-clued fallback puzzle.
    if (this.llm.isAvailable && !this.llm.isAvailable()) {
      console.warn('[Pipeline] No LLM configured (set GEMINI_API_KEY); skipping generation for', dateStr);
      return null;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[Pipeline] Generating puzzle for ${dateStr} (Attempt ${attempt}/${maxRetries})...`);

      // 1. Pick a template
      const grid = templates[Math.floor(Math.random() * templates.length)];
      const { cellNumbers, acrossSlots, downSlots } = computeGridSlots(grid);
      const allSlots = [...acrossSlots, ...downSlots];

      // 2. Propose a theme and place its entries (optional)
      let theme = await this.proposeTheme(allSlots, options.themePrompt);

      // 3. Fill the grid around the theme entries, falling back to a themeless fill
      let fillResult = await this.filler.fill(grid, {
        timeBudgetMs: GAME_CONFIG.SOLVER_TIME_BUDGET_MS,
        seedEntries: theme?.seeds,
      });

      if (!fillResult.success && theme) {
        console.log('[Pipeline] Themed fill failed time budget, falling back to themeless fill...');
        theme = null;
        fillResult = await this.filler.fill(grid, {
          timeBudgetMs: GAME_CONFIG.SOLVER_TIME_BUDGET_MS,
        });
      }

      if (!fillResult.success || !fillResult.solution) {
        console.warn(`[Pipeline] Fill failed on attempt ${attempt}`);
        continue;
      }

      const solution = fillResult.solution;
      const themeHints = new Map(theme?.seeds.map((s) => [entryKey(s), s.clueHint]));
      const entries: ClueEntryInput[] = allSlots.map((s) => ({
        number: s.number,
        direction: s.direction,
        answer: s.cells.map((c) => solution[c.row][c.col]).join(''),
        length: s.length,
        themeHint: themeHints.get(entryKey(s)),
      }));

      // 4. Clue every entry; a puzzle with missing clues is discarded, never published with placeholders
      let clues: Record<string, string> | null;
      try {
        clues = await this.writeClues(entries);
      } catch (err) {
        console.warn(`[Pipeline] Clue generation failed on attempt ${attempt}:`, err);
        continue;
      }
      if (!clues) {
        continue;
      }

      const toClue = (s: GridSlot) => ({
        number: s.number,
        direction: s.direction,
        text: clues![entryKey(s)],
        row: s.row,
        col: s.col,
        length: s.length,
        answer: s.cells.map((c) => solution[c.row][c.col]).join(''),
      });
      const acrossClues = acrossSlots.map(toClue);
      const downClues = downSlots.map(toClue);

      return {
        id: `puzzle-${dateStr}-${Date.now().toString(36)}`,
        date: dateStr,
        title: theme?.proposal.theme || `Daily Crossword (${dateStr})`,
        author: 'Daily Crossword Bot',
        theme: theme?.proposal.themeDescription || undefined,
        width: grid[0].length,
        height: grid.length,
        grid: buildGridMeta(grid, cellNumbers),
        clues: {
          across: acrossClues.map(({ answer, ...c }) => c),
          down: downClues.map(({ answer, ...c }) => c),
        },
        cluesWithAnswers: {
          across: acrossClues,
          down: downClues,
        },
        solution,
        expiresAt: getPuzzleExpiry(dateStr).toISOString(),
        isClosed: false,
        status: 'buffered',
        createdAt: new Date().toISOString(),
      };
    }

    console.warn(`[Pipeline] Could not generate puzzle after ${maxRetries} attempts`);
    return null;
  }

  /**
   * Asks the LLM for a theme whose entries fit this grid's long across slots and places them.
   * Returns null for a themeless puzzle.
   */
  private async proposeTheme(
    slots: GridSlot[],
    topic?: string
  ): Promise<{ proposal: LlmThemeProposal; seeds: ThemeSeed[] } | null> {
    const entryLengths = [
      ...new Set(slots.filter((s) => s.direction === 'across' && s.length >= MIN_THEME_ENTRY_LENGTH).map((s) => s.length)),
    ].sort((a, b) => b - a);
    if (entryLengths.length === 0) return null;

    let proposal: LlmThemeProposal | null = null;
    try {
      proposal = await this.llm.proposeTheme({ topic, entryLengths });
    } catch (err) {
      console.warn('[Pipeline] Theme proposal skipped:', err);
    }
    if (!proposal) return null;

    const seeds = placeThemeEntries(slots, proposal.seedEntries);
    if (seeds.length < MIN_THEME_ENTRIES) {
      console.log(`[Pipeline] Only ${seeds.length} theme entries fit the grid; making a themeless puzzle.`);
      return null;
    }
    return { proposal, seeds };
  }

  /**
   * Returns a usable clue for every entry, or null when some entries still lack one after a
   * second request. Rejects when the LLM request itself fails.
   */
  private async writeClues(entries: ClueEntryInput[]): Promise<Record<string, string> | null> {
    const clues = await this.llm.generateClues(entries, 'medium');

    // A second opinion. If verification can't run, the generated clues (already screened for
    // giveaways) stand.
    const toVerify = entries
      .filter((e) => clues[entryKey(e)])
      .map((e) => ({ number: e.number, direction: e.direction, answer: e.answer, clue: clues[entryKey(e)] }));
    try {
      for (const v of await this.llm.verifyClues(toVerify)) {
        const entry = entries.find((e) => entryKey(e) === entryKey(v));
        if (v.valid || !entry) continue;
        if (v.replacementClue && !clueRevealsAnswer(v.replacementClue, entry.answer)) {
          clues[entryKey(v)] = v.replacementClue;
        } else {
          delete clues[entryKey(v)];
        }
      }
    } catch (err) {
      console.warn('[Pipeline] Clue verification unavailable; keeping the generated clues:', err);
    }

    let missing = entries.filter((e) => !clues[entryKey(e)]);
    if (missing.length > 0) {
      const retry = await this.llm.generateClues(missing, 'medium');
      for (const e of missing) {
        const clue = retry[entryKey(e)];
        if (clue && !clueRevealsAnswer(clue, e.answer)) {
          clues[entryKey(e)] = clue;
        }
      }
      missing = entries.filter((e) => !clues[entryKey(e)]);
    }

    if (missing.length > 0) {
      console.warn(`[Pipeline] No usable clue for ${missing.map(entryKey).join(', ')}; discarding this fill.`);
      return null;
    }
    return clues;
  }

  /**
   * Upcoming dates the buffer must cover: tomorrow through
   * BUFFER_DAYS_AHEAD + BUFFER_TARGET_MIN - 1 days out (4 dates with the defaults).
   * Walking a fixed window, rather than counting buffered rows, means no date is
   * skipped when a buffered puzzle is published.
   */
  public static getBufferTargetDates(now: Date = new Date()): string[] {
    const horizon = GAME_CONFIG.BUFFER_DAYS_AHEAD + GAME_CONFIG.BUFFER_TARGET_MIN - 1;
    const today = getPuzzleDate(now);
    const dates: string[] = [];
    for (let offset = 1; offset <= horizon; offset++) {
      dates.push(addDays(today, offset));
    }
    return dates;
  }

  /**
   * Maintains the buffer of ready-to-publish puzzles.
   * "generate puzzles at least two days ahead and keep 3-7 ready. If the buffer is empty at release time, publish a fallback puzzle from a small stored set and log a warning."
   */
  public async maintainBuffer(now: Date = new Date()): Promise<void> {
    const targetDates = PuzzlePipeline.getBufferTargetDates(now);

    // Rejected (archived) puzzles don't count, so a rejected date gets regenerated.
    const existing = queryAll<{ date: string }>(
      `SELECT date FROM puzzles WHERE status != 'archived' AND date >= ? AND date <= ?;`,
      [targetDates[0], targetDates[targetDates.length - 1]]
    );
    const covered = new Set(existing.map((r) => r.date));
    const missing = targetDates.filter((d) => !covered.has(d));

    if (missing.length === 0) {
      return;
    }

    console.log(`[Pipeline] Buffer is missing puzzles for ${missing.join(', ')}. Generating...`);

    for (const dateStr of missing) {
      const puzzle = await this.generatePuzzle(dateStr);
      if (puzzle) {
        this.savePuzzleToDatabase(puzzle, 'buffered');
      } else {
        console.warn(`[Pipeline] Failed to generate buffered puzzle for ${dateStr}, using fallback puzzle buffer entry.`);
        this.savePuzzleToDatabase(getFallbackPuzzle(dateStr), 'buffered');
      }
    }
  }

  public savePuzzleToDatabase(puzzle: FullPuzzleData, status: PuzzleStatus): void {
    savePuzzle(puzzle, status);
  }

  /**
   * Strips out answers for client payload.
   * ANTI-CHEAT: Absolutely no answers in client payload for active puzzle.
   */
  public static sanitizeForClient(puzzle: FullPuzzleData): ClientPuzzlePayload {
    return {
      id: puzzle.id,
      date: puzzle.date,
      title: puzzle.title,
      author: puzzle.author,
      theme: puzzle.theme,
      width: puzzle.width,
      height: puzzle.height,
      grid: puzzle.grid,
      clues: {
        across: puzzle.cluesWithAnswers.across.map(({ answer, ...rest }) => rest),
        down: puzzle.cluesWithAnswers.down.map(({ answer, ...rest }) => rest),
      },
      expiresAt: puzzle.expiresAt,
      isClosed: puzzle.isClosed,
    };
  }
}
