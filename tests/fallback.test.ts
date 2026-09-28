import { describe, expect, it } from 'vitest';
import { parseGridStringTemplate, validateGridTemplate } from '../packages/shared/src/index.js';
import {
  createFallbackPuzzle,
  FALLBACK_PUZZLE_TEMPLATES,
  getFallbackPuzzle,
} from '../packages/server/src/engine/fallbackPuzzles.js';
import { defaultDictionary } from '../packages/server/src/engine/wordlist.js';
import { clueRevealsAnswer } from '../packages/server/src/llm/clueQuality.js';

describe('Fallback puzzles', () => {
  it('serves a different puzzle on each day until the set runs out', () => {
    const count = FALLBACK_PUZZLE_TEMPLATES.length;
    expect(count).toBeGreaterThanOrEqual(7);
    const solutions = Array.from({ length: count }, (_, i) =>
      getFallbackPuzzle(`2026-03-${String(i + 1).padStart(2, '0')}`).solution.map((r) => r.join('')).join('')
    );
    expect(new Set(solutions).size).toBe(count);
  });

  it('never repeats a word from another fallback puzzle', () => {
    const seen = new Map<string, string>();
    const repeats: string[] = [];
    FALLBACK_PUZZLE_TEMPLATES.forEach((tpl, index) => {
      const puzzle = createFallbackPuzzle('2026-01-01', index);
      for (const e of [...puzzle.cluesWithAnswers.across, ...puzzle.cluesWithAnswers.down]) {
        if (e.answer.length >= 5 && seen.has(e.answer)) repeats.push(`${e.answer} (${seen.get(e.answer)}, ${tpl.title})`);
        seen.set(e.answer, tpl.title);
      }
    });
    expect(repeats).toEqual([]);
  });

  FALLBACK_PUZZLE_TEMPLATES.forEach((tpl, index) => {
    describe(tpl.title, () => {
      const puzzle = createFallbackPuzzle('2026-01-01', index);
      const entries = [...puzzle.cluesWithAnswers.across, ...puzzle.cluesWithAnswers.down];

      it('uses a valid grid whose black squares match the solution', () => {
        const grid = parseGridStringTemplate(tpl.rawGrid);
        expect(validateGridTemplate(grid, puzzle.width, puzzle.height).errors).toEqual([]);
        tpl.solution.forEach((row, r) => {
          expect(row).toHaveLength(puzzle.width);
          [...row].forEach((ch, c) => expect(ch === '#').toBe(grid[r][c]));
        });
      });

      it('only contains unique words from the dictionary', () => {
        const answers = entries.map((e) => e.answer);
        expect(answers.filter((a) => !defaultDictionary.hasWord(a))).toEqual([]);
        expect(new Set(answers).size).toBe(answers.length);
      });

      it('has a written clue for every entry that does not contain its answer', () => {
        for (const e of entries) {
          expect(e.text, `${e.number}-${e.direction}`).not.toMatch(/^Clue for/);
          expect(clueRevealsAnswer(e.text, e.answer), `${e.number}-${e.direction}: ${e.text}`).toBe(false);
        }
        // No clue written for a number that isn't in the grid.
        expect(Object.keys(tpl.clues.across).length).toBe(puzzle.cluesWithAnswers.across.length);
        expect(Object.keys(tpl.clues.down).length).toBe(puzzle.cluesWithAnswers.down.length);
      });
    });
  });
});
