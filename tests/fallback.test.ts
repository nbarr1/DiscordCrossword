import { describe, expect, it } from 'vitest';
import { parseGridStringTemplate, validateGridTemplate } from '../packages/shared/src/index.js';
import { createFallbackPuzzle, FALLBACK_PUZZLE_TEMPLATES } from '../packages/server/src/engine/fallbackPuzzles.js';
import { defaultDictionary } from '../packages/server/src/engine/wordlist.js';

describe('Fallback puzzles', () => {
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
          expect(e.text.toUpperCase().replace(/[^A-Z]/g, ''), `${e.number}-${e.direction}`).not.toContain(e.answer);
        }
        // No clue written for a number that isn't in the grid.
        expect(Object.keys(tpl.clues.across).length).toBe(puzzle.cluesWithAnswers.across.length);
        expect(Object.keys(tpl.clues.down).length).toBe(puzzle.cluesWithAnswers.down.length);
      });
    });
  });
});
