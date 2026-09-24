import {
  ClientPuzzlePayload,
  FullPuzzleData,
  GAME_CONFIG,
  buildGridMeta,
  computeGridSlots,
  validateGridTemplate,
} from '@crossword/shared';
import { queryAll, runQuery } from '../db/database.js';
import { defaultLlmProvider } from '../llm/gemini.js';
import { LlmProvider } from '../llm/types.js';
import { createFallbackPuzzle } from './fallbackPuzzles.js';
import { CrosswordFiller } from './filler.js';
import { getValidatedTemplates } from './templates.js';
import { defaultDictionary } from './wordlist.js';

export class PuzzlePipeline {
  private llm: LlmProvider;
  private filler: CrosswordFiller;

  constructor(llm: LlmProvider = defaultLlmProvider) {
    this.llm = llm;
    this.filler = new CrosswordFiller(defaultDictionary);
  }

  /**
   * Generates a single complete crossword puzzle for a given target date.
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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[Pipeline] Generating puzzle for ${dateStr} (Attempt ${attempt}/${maxRetries})...`);

      // 1. Pick a template
      const templateIdx = Math.floor(Math.random() * templates.length);
      const grid = templates[templateIdx];

      // 2. Propose theme (optional)
      let themeInfo = null;
      let seedEntries: { number: number; direction: 'across' | 'down'; word: string }[] = [];

      try {
        themeInfo = await this.llm.proposeTheme(options.themePrompt);
      } catch (err) {
        console.warn('[Pipeline] Theme proposal skipped:', err);
      }

      // 3. Fill grid (with fallback to themeless fill)
      let fillResult = this.filler.fill(grid, {
        timeBudgetMs: GAME_CONFIG.SOLVER_TIME_BUDGET_MS,
        seedEntries,
      });

      if (!fillResult.success && seedEntries.length > 0) {
        console.log('[Pipeline] Themed fill failed time budget, falling back to themeless fill...');
        fillResult = this.filler.fill(grid, {
          timeBudgetMs: GAME_CONFIG.SOLVER_TIME_BUDGET_MS,
        });
      }

      if (!fillResult.success || !fillResult.solution) {
        console.warn(`[Pipeline] Fill failed on attempt ${attempt}`);
        continue;
      }

      // 4. Validation gate on grid
      const gridValidation = validateGridTemplate(grid);
      if (!gridValidation.valid) {
        console.warn(`[Pipeline] Grid template validation failed:`, gridValidation.errors);
        continue;
      }

      // Compute slots & clues
      const { cellNumbers, acrossSlots, downSlots } = computeGridSlots(grid);
      const gridMeta = buildGridMeta(grid, cellNumbers);

      const clueEntriesForLlm = [
        ...acrossSlots.map((s) => ({
          number: s.number,
          direction: 'across' as const,
          answer: fillResult.slotWords[`${s.number}-across`] || s.cells.map((c) => fillResult.solution![c.row][c.col]).join(''),
          length: s.length,
        })),
        ...downSlots.map((s) => ({
          number: s.number,
          direction: 'down' as const,
          answer: fillResult.slotWords[`${s.number}-down`] || s.cells.map((c) => fillResult.solution![c.row][c.col]).join(''),
          length: s.length,
        })),
      ];

      // 5. Generate clues via LLM
      const cluesMap = await this.llm.generateClues(clueEntriesForLlm, 'medium');

      // 6. Second pass: verify clues
      const verifyItems = clueEntriesForLlm.map((e) => ({
        number: e.number,
        direction: e.direction,
        answer: e.answer,
        clue: cluesMap[`${e.number}-${e.direction}`] || `Clue for ${e.number}-${e.direction}`,
      }));

      const verifications = await this.llm.verifyClues(verifyItems);
      for (const v of verifications) {
        if (!v.valid && v.replacementClue) {
          cluesMap[`${v.number}-${v.direction}`] = v.replacementClue;
        }
      }

      const acrossClues = acrossSlots.map((s) => ({
        number: s.number,
        direction: 'across' as const,
        text: cluesMap[`${s.number}-across`] || `Clue for ${s.number}-Across`,
        row: s.row,
        col: s.col,
        length: s.length,
        answer: fillResult.slotWords[`${s.number}-across`] || s.cells.map((c) => fillResult.solution![c.row][c.col]).join(''),
      }));

      const downClues = downSlots.map((s) => ({
        number: s.number,
        direction: 'down' as const,
        text: cluesMap[`${s.number}-down`] || `Clue for ${s.number}-Down`,
        row: s.row,
        col: s.col,
        length: s.length,
        answer: fillResult.slotWords[`${s.number}-down`] || s.cells.map((c) => fillResult.solution![c.row][c.col]).join(''),
      }));

      const expiresDate = new Date(`${dateStr}T00:00:00Z`);
      expiresDate.setUTCDate(expiresDate.getUTCDate() + 1);

      const puzzle: FullPuzzleData = {
        id: `puzzle-${dateStr}-${Date.now().toString(36)}`,
        date: dateStr,
        title: themeInfo?.theme || `Daily Crossword (${dateStr})`,
        author: 'Daily Crossword Bot',
        theme: themeInfo?.themeDescription || undefined,
        width: 15,
        height: 15,
        grid: gridMeta,
        clues: {
          across: acrossClues.map(({ answer, ...c }) => c),
          down: downClues.map(({ answer, ...c }) => c),
        },
        cluesWithAnswers: {
          across: acrossClues,
          down: downClues,
        },
        solution: fillResult.solution,
        expiresAt: expiresDate.toISOString(),
        isClosed: false,
        status: 'buffered',
        createdAt: new Date().toISOString(),
      };

      return puzzle;
    }

    console.warn(`[Pipeline] Could not generate puzzle after ${maxRetries} attempts`);
    return null;
  }

  /**
   * Upcoming dates the buffer must cover: tomorrow through
   * BUFFER_DAYS_AHEAD + BUFFER_TARGET_MIN - 1 days out (4 dates with the defaults).
   * Walking a fixed window, rather than counting buffered rows, means no date is
   * skipped when a buffered puzzle is published.
   */
  public static getBufferTargetDates(now: Date = new Date()): string[] {
    const horizon = GAME_CONFIG.BUFFER_DAYS_AHEAD + GAME_CONFIG.BUFFER_TARGET_MIN - 1;
    const dates: string[] = [];
    for (let offset = 1; offset <= horizon; offset++) {
      const target = new Date(now);
      target.setUTCDate(now.getUTCDate() + offset);
      dates.push(target.toISOString().split('T')[0]);
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
    const existing = await queryAll<{ date: string }>(
      `SELECT date FROM puzzles WHERE status != 'archived' AND date >= ? AND date <= ?;`,
      [targetDates[0], targetDates[targetDates.length - 1]]
    );
    const covered = new Set(existing.map((r) => r.date));
    const missing = targetDates.filter((d) => !covered.has(d));

    if (missing.length === 0) {
      return;
    }

    console.log(`[Pipeline] Buffer is missing puzzles for ${missing.join(', ')}. Generating...`);

    for (let i = 0; i < missing.length; i++) {
      const dateStr = missing[i];
      const puzzle = await this.generatePuzzle(dateStr);
      if (puzzle) {
        await this.savePuzzleToDatabase(puzzle, 'buffered');
      } else {
        console.warn(`[Pipeline] Failed to generate buffered puzzle for ${dateStr}, using fallback puzzle buffer entry.`);
        const fallback = createFallbackPuzzle(dateStr, i);
        fallback.status = 'buffered';
        await this.savePuzzleToDatabase(fallback, 'buffered');
      }
    }
  }

  public async savePuzzleToDatabase(puzzle: FullPuzzleData, status: 'buffered' | 'published' | 'archived'): Promise<void> {
    await runQuery(
      `INSERT OR REPLACE INTO puzzles (
        id, date, title, author, theme, width, height,
        grid_json, clues_json, solution_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        puzzle.id,
        puzzle.date,
        puzzle.title,
        puzzle.author,
        puzzle.theme || null,
        puzzle.width,
        puzzle.height,
        JSON.stringify(puzzle.grid),
        JSON.stringify(puzzle.cluesWithAnswers),
        JSON.stringify(puzzle.solution),
        status,
        puzzle.createdAt,
      ]
    );
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
