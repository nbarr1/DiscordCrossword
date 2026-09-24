import { describe, expect, it } from 'vitest';
import { PuzzlePipeline } from '../packages/server/src/engine/pipeline.js';
import { defaultDictionary } from '../packages/server/src/engine/wordlist.js';
import type { LlmProvider } from '../packages/server/src/llm/types.js';

const stubLlm = (available: boolean): LlmProvider => ({
  isAvailable: () => available,
  proposeTheme: async () => null,
  generateClues: async (entries) =>
    Object.fromEntries(entries.map((e) => [`${e.number}-${e.direction}`, `A ${e.length}-letter clue`])),
  verifyClues: async (items) => items.map((i) => ({ number: i.number, direction: i.direction, valid: true })),
});

describe('Puzzle pipeline', () => {
  it('generates a puzzle whose recorded size matches its grid', async () => {
    const puzzle = await new PuzzlePipeline(stubLlm(true)).generatePuzzle('2026-10-01', { retryLimit: 8 });
    expect(puzzle).not.toBeNull();
    expect(puzzle!.height).toBe(puzzle!.grid.length);
    expect(puzzle!.width).toBe(puzzle!.grid[0].length);
    expect(puzzle!.solution).toHaveLength(puzzle!.height);

    const answers = [...puzzle!.cluesWithAnswers.across, ...puzzle!.cluesWithAnswers.down].map((c) => c.answer);
    expect(answers.filter((a) => !defaultDictionary.hasWord(a))).toEqual([]);
  }, 60_000);

  it('skips generation when no LLM can write clues', async () => {
    expect(await new PuzzlePipeline(stubLlm(false)).generatePuzzle('2026-10-01')).toBeNull();
  });
});
