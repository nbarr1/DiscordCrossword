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

export const FALLBACK_PUZZLE_TEMPLATES: FallbackPuzzleDefinition[] = [
  {
    title: 'Daily Discord Starter (12x12)',
    author: 'Crossword Bot',
    theme: 'Tech, Gaming & Community',
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
      'ACE#DOG#CHAT',
      'CAR#ONE#LAVA',
      'DISCORDGAMES',
      '###RUN#FLY##',
      'STAR#EAR#ICE',
      'MOON#ART#SUN',
      'PEN#KEY#CODE',
      'EGG#RED#BLUE',
      '##JOY#ZIP###',
      'SERVERLEADER',
      'BIRD#DAY#SKY',
      'TREE#EGG#YES',
    ],
    clues: {
      across: {
        1: 'Top playing card or expert',
        4: 'Loyal barker',
        7: 'Casual Discord channel banter',
        11: 'Vehicle with four wheels',
        12: 'Single unit or digit',
        13: 'Molten volcanic rock',
        14: 'Activities played with server friends',
        17: 'Sprint on foot',
        18: 'Soar like an eagle',
        19: 'Twinkling celestial light',
        22: 'Organ of hearing',
        24: 'Frozen water cube',
        27: 'Earth’s nighttime satellite',
        28: 'Paintings, drawings, or sculptures',
        29: 'Center of our solar system',
        30: 'Writing instrument with ink',
        31: 'Unlocks a door or cipher',
        32: 'Software programming instructions',
        33: 'Hen produce for breakfast',
        34: 'Color of a ruby or stop sign',
        35: 'Color of the ocean and clear sky',
        36: 'Feeling of immense happiness',
        38: 'Compress files into an archive',
        40: 'Top solver in guild standings',
        46: 'Feathered creature of the sky',
        47: 'Twenty-four hour period',
        48: 'Atmospheric dome above',
        49: 'Tall woody forest plant',
        50: 'Breakfast staple',
        51: 'Affirmative response',
      },
      down: {
        1: 'Three-letter file extension or initialism',
        2: 'Letters forming an anagram of CIA',
        3: 'Emergency rooms, briefly',
        4: 'Playful vocalization sound',
        5: 'Nine-box vertical letter progression',
        6: 'High school equivalency diploma',
        7: 'Sound of ringing bells',
        8: 'Eight-letter vertical run',
        9: 'Avenue abbreviation',
        10: 'Teaching assistants in college',
        15: 'Abbreviation for registered nurse',
        16: 'Four-letter combination',
        19: 'Motion picture engineering acronym',
        20: 'Four-letter column sequence',
        21: 'Eight-box vertical line',
        23: 'Eight-letter column progression',
        25: 'Four-letter playful syllables',
        26: 'Direction or ending sound',
        31: 'Rye or grain reference',
        32: 'Accounting or business association',
        37: 'Four-letter column',
        39: 'Vertical four-letter segment',
        40: 'Television network letters',
        41: 'Ireland in native Irish tongue (Éire)',
        42: 'Letters for research, development, and engineering',
        43: 'Shortened daily sound',
        44: 'Scrape by: ___ out a living',
        45: 'Railroad yard abbreviation',
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
