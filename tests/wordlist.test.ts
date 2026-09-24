import { describe, expect, it } from 'vitest';
import { CrosswordDictionary, defaultDictionary, isOffensive } from '../packages/server/src/engine/wordlist.js';

describe('Crossword dictionary', () => {
  it('loads the bundled word list', () => {
    expect(defaultDictionary.size).toBeGreaterThan(200_000);
    expect(defaultDictionary.hasWord('OREO')).toBe(true);
  });

  it('matches patterns exactly like a linear scan, in score order', () => {
    const dict = new CrosswordDictionary([
      ['CART', 60], ['CARE', 90], ['CORE', 70], ['BORE', 80], ['CAREER', 50], ['CURT', 95],
    ]);
    expect(dict.findMatches('C.R.').map((w) => w.word)).toEqual(['CURT', 'CARE', 'CORE', 'CART']);
    expect(dict.findMatches('..RE').map((w) => w.word)).toEqual(['CARE', 'BORE', 'CORE']);
    expect(dict.findMatches('....')).toHaveLength(5);
    expect(dict.findMatches('X...')).toEqual([]);
    expect(dict.countMatches('C.R.')).toBe(4);
    expect(dict.hasMatch('C.RT', new Set(['CART', 'CURT']))).toBe(false);
    expect(dict.hasMatch('C.RT', new Set(['CART']))).toBe(true);
  });

  it('agrees with a linear scan on the full list', () => {
    for (const pattern of ['A..LE', '.R.N.E', 'S......', '...ZZ']) {
      const re = new RegExp(`^${pattern}$`);
      const expected = defaultDictionary.findMatches('.'.repeat(pattern.length)).filter((w) => re.test(w.word));
      expect(defaultDictionary.findMatches(pattern)).toEqual(expected);
    }
  });

  it('sees words added after the index was built', () => {
    const dict = new CrosswordDictionary([['CARE', 90]]);
    expect(dict.countMatches('C..E')).toBe(1);
    dict.addCustomWord('CAVE');
    expect(dict.findMatches('C..E').map((w) => w.word)).toEqual(['CAVE', 'CARE']);
  });

  it('rejects offensive words, including inside phrases, without blocking innocent ones', () => {
    expect(isOffensive('BULLSHIT')).toBe(true);
    expect(isOffensive('HOLYSHITBALLS')).toBe(true);
    expect(isOffensive('COCK')).toBe(true);
    for (const ok of ['PEACOCK', 'DICKENS', 'SPICE', 'HOTWATER', 'PACHINKO']) {
      expect(isOffensive(ok)).toBe(false);
    }
    const dict = new CrosswordDictionary([['BULLSHIT', 90], ['PEACOCK', 80]]);
    expect(dict.hasWord('BULLSHIT')).toBe(false);
    expect(dict.hasWord('PEACOCK')).toBe(true);
  });
});
