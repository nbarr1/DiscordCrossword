import { describe, expect, it } from 'vitest';
import { computeGridSlots, parseGridStringTemplate } from '../packages/shared/src/index.js';
import { placeThemeEntries, PuzzlePipeline } from '../packages/server/src/engine/pipeline.js';
import { defaultDictionary } from '../packages/server/src/engine/wordlist.js';
import { clueRevealsAnswer } from '../packages/server/src/llm/clueQuality.js';
import type { ClueEntryInput, LlmProvider } from '../packages/server/src/llm/types.js';

const clueFor = (e: ClueEntryInput) => `A ${e.length}-letter clue`;

const stubLlm = (available: boolean, overrides: Partial<LlmProvider> = {}): LlmProvider => ({
  isAvailable: () => available,
  proposeTheme: async () => null,
  generateClues: async (entries) => Object.fromEntries(entries.map((e) => [`${e.number}-${e.direction}`, clueFor(e)])),
  verifyClues: async (items) => items.map((i) => ({ number: i.number, direction: i.direction, valid: true })),
  ...overrides,
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

  it('never publishes placeholder clues when the LLM request fails', async () => {
    const llm = stubLlm(true, {
      generateClues: async () => {
        throw new Error('quota exceeded');
      },
    });
    expect(await new PuzzlePipeline(llm).generatePuzzle('2026-10-01', { retryLimit: 2 })).toBeNull();
  }, 60_000);

  it('asks again for entries the first response left out, and rejects fills that stay incomplete', async () => {
    const requests: number[] = [];
    const partial = stubLlm(true, {
      generateClues: async (entries) => {
        requests.push(entries.length);
        // First request: drop one clue. Retry: supply it.
        const list = requests.length === 1 ? entries.slice(1) : entries;
        return Object.fromEntries(list.map((e) => [`${e.number}-${e.direction}`, clueFor(e)]));
      },
    });
    const puzzle = await new PuzzlePipeline(partial).generatePuzzle('2026-10-01', { retryLimit: 8 });
    expect(puzzle).not.toBeNull();
    expect(requests[1]).toBe(1);

    const neverComplete = stubLlm(true, {
      generateClues: async (entries) =>
        Object.fromEntries(entries.slice(1).map((e) => [`${e.number}-${e.direction}`, clueFor(e)])),
    });
    expect(await new PuzzlePipeline(neverComplete).generatePuzzle('2026-10-01', { retryLimit: 2 })).toBeNull();
  }, 60_000);

  it('drops verifier replacements that give the answer away', async () => {
    const llm = stubLlm(true, {
      verifyClues: async (items) =>
        items.map((i) => ({ number: i.number, direction: i.direction, valid: false, replacementClue: `Say ${i.answer}` })),
    });
    // Every replacement leaks, so every clue is removed and re-requested once, then kept from the retry.
    const puzzle = await new PuzzlePipeline(llm).generatePuzzle('2026-10-01', { retryLimit: 8 });
    expect(puzzle).not.toBeNull();
    for (const c of [...puzzle!.cluesWithAnswers.across, ...puzzle!.cluesWithAnswers.down]) {
      expect(clueRevealsAnswer(c.text, c.answer)).toBe(false);
    }
  }, 60_000);
});

describe('Theme entries', () => {
  const grid = parseGridStringTemplate([
    '...#........',
    '...#........',
    '...#........',
    '#.......#...',
    '#...#...#...',
    '....#...#...',
    '...#...#....',
    '...#...#...#',
    '...#.......#',
    '........#...',
    '........#...',
    '........#...',
  ]);
  const { acrossSlots, downSlots } = computeGridSlots(grid);
  const slots = [...acrossSlots, ...downSlots];

  it('places words in across slots of matching length and drops words that do not fit', () => {
    // This grid's long across slots hold 7 and 8 letters.
    const seeds = placeThemeEntries(slots, [
      { word: 'Moon beam', clueHint: 'Night light' },
      { word: 'STARLIT', clueHint: 'Like a clear night' },
      { word: 'COMETTAILS', clueHint: 'Too long for this grid' },
    ]);
    expect(seeds.map((s) => s.word).sort()).toEqual(['MOONBEAM', 'STARLIT']);
    for (const seed of seeds) {
      const slot = slots.find((s) => s.number === seed.number && s.direction === seed.direction)!;
      expect(slot.direction).toBe('across');
      expect(slot.length).toBe(seed.word.length);
    }
  });
});

describe('Clue giveaway check', () => {
  it('flags the answer as a whole word, a close form, or a run of words', () => {
    expect(clueRevealsAnswer('One more time', 'ONE')).toBe(true);
    expect(clueRevealsAnswer('Ones and zeros', 'ONE')).toBe(true);
    expect(clueRevealsAnswer('A long era', 'ERAS')).toBe(true);
    expect(clueRevealsAnswer('Ironclad rule, say', 'IRONCLADRULE')).toBe(true);
  });

  it('allows the answer inside longer, unrelated words', () => {
    expect(clueRevealsAnswer('Someone special', 'ONE')).toBe(false);
    expect(clueRevealsAnswer('Take care of', 'ARE')).toBe(false);
    expect(clueRevealsAnswer('Hat for a general', 'ERA')).toBe(false);
  });
});
