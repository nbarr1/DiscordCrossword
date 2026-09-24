import { GAME_CONFIG } from './config.js';
import {
  computeGridSlots,
  everyWhiteHasBothDirections,
  has180Symmetry,
  isAllWhiteConnected,
} from './grid.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  stats?: {
    totalEntries: number;
    acrossEntries: number;
    downEntries: number;
    blackCells: number;
    whiteCells: number;
  };
}

/**
 * Validates a 15x15 black square template against all strict crossword rules.
 * grid[r][c] === true for black cells, false for white cells.
 */
export function validateGridTemplate(
  grid: boolean[][],
  width = GAME_CONFIG.GRID_WIDTH,
  height = GAME_CONFIG.GRID_HEIGHT
): ValidationResult {
  const errors: string[] = [];

  // 1. Grid dimensions
  if (!grid || grid.length !== height) {
    return {
      valid: false,
      errors: [`Grid height must be ${height}, received ${grid?.length}`],
    };
  }
  for (let r = 0; r < height; r++) {
    if (!grid[r] || grid[r].length !== width) {
      return {
        valid: false,
        errors: [`Grid width must be ${width} on row ${r}, received ${grid[r]?.length}`],
      };
    }
  }

  // 2. 180-degree rotational symmetry
  if (!has180Symmetry(grid, width, height)) {
    errors.push('Grid lacks 180-degree rotational symmetry');
  }

  // 3. All white cells connected
  if (!isAllWhiteConnected(grid, width, height)) {
    errors.push('Grid white cells are not all connected (disconnected regions detected)');
  }

  // 4. Slots computation
  const { acrossSlots, downSlots } = computeGridSlots(grid, width, height);
  const totalEntries = acrossSlots.length + downSlots.length;

  // 5. Entry count limit (<= 78)
  if (totalEntries > GAME_CONFIG.MAX_ENTRIES) {
    errors.push(
      `Total entries (${totalEntries}) exceeds maximum allowed of ${GAME_CONFIG.MAX_ENTRIES}`
    );
  }

  // 6. Minimum entry length (>= 3)
  for (const slot of acrossSlots) {
    if (slot.length < GAME_CONFIG.MIN_WORD_LENGTH) {
      errors.push(
        `Across entry ${slot.number} at (${slot.row}, ${slot.col}) has length ${slot.length} (minimum is ${GAME_CONFIG.MIN_WORD_LENGTH})`
      );
    }
  }
  for (const slot of downSlots) {
    if (slot.length < GAME_CONFIG.MIN_WORD_LENGTH) {
      errors.push(
        `Down entry ${slot.number} at (${slot.row}, ${slot.col}) has length ${slot.length} (minimum is ${GAME_CONFIG.MIN_WORD_LENGTH})`
      );
    }
  }

  // 7. Every white cell belongs to both across and down
  if (!everyWhiteHasBothDirections(grid, acrossSlots, downSlots, width, height)) {
    errors.push('Every white cell must belong to both an across and a down entry (no uncrossed letters)');
  }

  let blackCells = 0;
  let whiteCells = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r][c]) blackCells++;
      else whiteCells++;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      totalEntries,
      acrossEntries: acrossSlots.length,
      downEntries: downSlots.length,
      blackCells,
      whiteCells,
    },
  };
}

/**
 * Parses a string template representation (e.g. 15 strings of length 15 with '.' for white and '#' for black)
 */
export function parseGridStringTemplate(rows: string[]): boolean[][] {
  return rows.map((row) =>
    row
      .trim()
      .split('')
      .map((char) => char === '#')
  );
}

/**
 * Serializes a boolean grid to an array of 15 strings.
 */
export function serializeGridToString(grid: boolean[][]): string[] {
  return grid.map((row) => row.map((b) => (b ? '#' : '.')).join(''));
}
