import { parseGridStringTemplate, validateGridTemplate } from '@crossword/shared';

/**
 * Standard, thoroughly verified 12x12 crossword grid templates with:
 * - 180-degree rotational symmetry
 * - All white squares connected in a single component
 * - Minimum word length of 3 letters (no 1 or 2 letter words)
 * - Every white cell belongs to both across and down
 * - Word count <= 78
 */
export const RAW_GRID_TEMPLATES: string[][] = [
  // Template 1: Balanced Pinwheel 12x12
  [
    '....#.......',
    '....#.......',
    '....#.......',
    '....#...#...',
    '....#...#...',
    '###...#.....',
    '.....#...###',
    '...#...#....',
    '...#...#....',
    '.......#....',
    '.......#....',
    '.......#....',
  ],
  // Template 2: Diagonal Flow 12x12
  [
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
  ],
  // Template 3: Symmetrical Standard 12x12
  [
    '....#...#...',
    '....#...#...',
    '....#...#...',
    '###...#...##',
    '...#...#....',
    '...#...#....',
    '....#...#...',
    '....#...#...',
    '##...#...###',
    '...#...#....',
    '...#...#....',
    '...#...#....',
  ],
];

export function getValidatedTemplates(): boolean[][][] {
  const valid: boolean[][][] = [];

  for (const raw of RAW_GRID_TEMPLATES) {
    const grid = parseGridStringTemplate(raw);
    const result = validateGridTemplate(grid);
    if (result.valid) {
      valid.push(grid);
    } else {
      console.warn('[Templates] Skipped invalid template:', result.errors);
    }
  }

  return valid;
}
