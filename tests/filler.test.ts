import { computeGridSlots, parseGridStringTemplate } from '../packages/shared/src/index.js';
import { describe, expect, it } from 'vitest';
import { CrosswordFiller } from '../packages/server/src/engine/filler.js';
import { getValidatedTemplates } from '../packages/server/src/engine/templates.js';
import { CrosswordDictionary, defaultDictionary } from '../packages/server/src/engine/wordlist.js';

describe('Crossword Backtracking Filler', () => {
  it('fills a grid reproducibly using a fixed random seed', () => {
    // 5x5 connected mini-crossword template
    // C A T S #
    // A R E A #
    // T E S T #
    // S A L T #
    // # # # # #
    const lines = [
      '....#',
      '....#',
      '....#',
      '....#',
      '#####',
    ];
    const grid = parseGridStringTemplate(lines);

    const dict = new CrosswordDictionary();
    dict.addCustomWord('CATS', 95);
    dict.addCustomWord('AREA', 90);
    dict.addCustomWord('TEST', 90);
    dict.addCustomWord('SALT', 85);
    dict.addCustomWord('CARS', 90);

    const filler = new CrosswordFiller(dict);

    const result1 = filler.fill(grid, { seed: 12345, timeBudgetMs: 5000 });
    const result2 = filler.fill(grid, { seed: 12345, timeBudgetMs: 5000 });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.solution).toEqual(result2.solution);
  });

  it('prevents duplicate word placements across slots', () => {
    // 2 across slots of length 4, no intersections
    const lines = [
      '....#',
      '#####',
      '....#',
      '#####',
      '#####',
    ];
    const grid = parseGridStringTemplate(lines);

    const dict = new CrosswordDictionary();
    dict.addCustomWord('WORD', 90);
    dict.addCustomWord('TEST', 85);

    const filler = new CrosswordFiller(dict);
    const result = filler.fill(grid, { seed: 42, timeBudgetMs: 5000 });

    expect(result.success).toBe(true);
    const words = Object.values(result.slotWords);
    expect(words.length).toBe(2);
    // Must not reuse "WORD" twice
    expect(words[0]).not.toBe(words[1]);
  });

  it('fills a shipped template with unique dictionary words', () => {
    const filler = new CrosswordFiller(defaultDictionary);
    for (const grid of [getValidatedTemplates()[0], getValidatedTemplates()[2]]) {
      const result = filler.fill(grid, { seed: 2, timeBudgetMs: 10000 });
      expect(result.success).toBe(true);

      // Check every slot from the final letters, including words formed only by crossings.
      const { acrossSlots, downSlots } = computeGridSlots(grid);
      const words = [...acrossSlots, ...downSlots].map((s) =>
        s.cells.map((c) => result.solution![c.row][c.col]).join('')
      );
      expect(words.filter((w) => !defaultDictionary.hasWord(w))).toEqual([]);
      expect(new Set(words).size).toBe(words.length);
    }
  });
});
