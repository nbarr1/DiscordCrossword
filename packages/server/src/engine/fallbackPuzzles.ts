import { FullPuzzleData, buildGridMeta, computeGridSlots, parseGridStringTemplate } from '@crossword/shared';

export interface FallbackPuzzleDefinition {
  title: string;
  author: string;
  theme?: string;
  rawGrid: string[];
  solution: string[];
  clues: {
    across: Record<number, string>;
    down: Record<number, string>;
  };
}

/**
 * Served when no generated puzzle is available for a date. Every entry is a word from the
 * bundled word list, and the grid passes validateGridTemplate (see tests/fallback.test.ts).
 */
export const FALLBACK_PUZZLE_TEMPLATES: FallbackPuzzleDefinition[] = [
  {
    title: 'Daily Starter Crossword',
    author: 'Crossword Bot',
    rawGrid: [
      '...#...#....',
      '...#...#....',
      '............',
      '###...#...##',
      '....#...#...',
      '....#...#...',
      '...#...#....',
      '...#...#....',
      '##...#...###',
      '............',
      '....#...#...',
      '....#...#...',
    ],
    solution: [
      'FOE#HAS#BUNT',
      'YUM#ATE#INFO',
      'IRONCLADRULE',
      '###AKA#ADS##',
      'ICBM#NOD#APT',
      'SHOE#TIE#BEE',
      'EAR#GIN#GLEN',
      'EON#ACT#EELS',
      '##FEZ#MMA###',
      'LARGEHEARTED',
      'OREO#INN#ALE',
      'UTES#STY#OFF',
    ],
    clues: {
      across: {
        1: 'Adversary',
        4: 'Owns',
        7: 'Soft tap in baseball',
        11: '"Delicious!"',
        12: 'Had dinner',
        13: 'Details, for short',
        14: 'Regulation with no exceptions',
        17: 'Alias letters',
        18: 'Commercials',
        19: 'Long-range missile, briefly',
        22: 'Silent "yes"',
        24: 'Fitting',
        27: 'Sneaker or loafer',
        28: 'Draw',
        29: 'Spelling contest',
        30: 'Corn unit',
        31: 'Martini base',
        32: 'Secluded valley',
        33: 'Very long time',
        34: 'Play division',
        35: 'Snakelike swimmers',
        36: 'Tasseled cap',
        38: 'Cage-fighting sport, briefly',
        40: 'Generous and kind',
        46: 'Twist-apart cookie',
        47: 'Roadside lodging',
        48: 'Pub pour',
        49: 'Salt Lake City college athletes',
        50: 'Messy room, figuratively',
        51: 'Not on',
      },
      down: {
        1: 'Memo heading, briefly',
        2: 'Belonging to us',
        3: 'Moody rock genre',
        4: 'Clever shortcut',
        5: 'Ocean between Europe and the Americas',
        6: 'The Mediterranean, for one',
        7: 'Robin or wren',
        8: 'Out of order',
        9: 'Super Bowl org.',
        10: 'Foot digit',
        15: 'It goes on a tag at a mixer',
        16: 'Miami-___ County',
        19: '"Got it"',
        20: 'Elaine ___, two-time U.S. Cabinet secretary',
        21: '1966 film about Elsa the lioness',
        23: 'Soothing salve',
        25: 'Banana skin',
        26: 'Perfect scores, often',
        31: 'Steady look',
        32: 'Equipment',
        37: 'Senses of self',
        39: 'Lots of',
        40: 'Reed of the Velvet Underground',
        41: 'Gallery display',
        42: 'Not hers',
        43: 'The way, in Chinese philosophy',
        44: "Santa's helper",
        45: 'Excellent, in 1980s slang',
      },
    },
  },
];

export function createFallbackPuzzle(dateStr: string, index = 0): FullPuzzleData {
  const tpl = FALLBACK_PUZZLE_TEMPLATES[index % FALLBACK_PUZZLE_TEMPLATES.length];
  const grid = parseGridStringTemplate(tpl.rawGrid);
  const width = tpl.rawGrid[0]?.length || 12;
  const height = tpl.rawGrid.length || 12;
  const { cellNumbers, acrossSlots, downSlots } = computeGridSlots(grid, width, height);
  const gridMeta = buildGridMeta(grid, cellNumbers);

  const acrossClues = acrossSlots.map((slot) => ({
    number: slot.number,
    direction: 'across' as const,
    text: tpl.clues.across[slot.number] || `Clue for ${slot.number}-Across`,
    row: slot.row,
    col: slot.col,
    length: slot.length,
    answer: slot.cells.map((c) => tpl.solution[c.row][c.col]).join(''),
  }));

  const downClues = downSlots.map((slot) => ({
    number: slot.number,
    direction: 'down' as const,
    text: tpl.clues.down[slot.number] || `Clue for ${slot.number}-Down`,
    row: slot.row,
    col: slot.col,
    length: slot.length,
    answer: slot.cells.map((c) => tpl.solution[c.row][c.col]).join(''),
  }));

  const solutionGrid = tpl.solution.map((row) => row.split(''));

  const expiresDate = new Date(`${dateStr}T00:00:00Z`);
  expiresDate.setUTCDate(expiresDate.getUTCDate() + 1);

  return {
    id: `puzzle-${dateStr}`,
    date: dateStr,
    title: tpl.title,
    author: tpl.author,
    theme: tpl.theme,
    width,
    height,
    grid: gridMeta,
    clues: {
      across: acrossClues.map(({ answer, ...c }) => c),
      down: downClues.map(({ answer, ...c }) => c),
    },
    cluesWithAnswers: {
      across: acrossClues,
      down: downClues,
    },
    solution: solutionGrid,
    expiresAt: expiresDate.toISOString(),
    isClosed: false,
    status: 'published',
    createdAt: new Date().toISOString(),
  };
}

export function getFallbackPuzzle(dateStr: string): FullPuzzleData {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash);
  return createFallbackPuzzle(dateStr, index);
}
