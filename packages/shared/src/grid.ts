import { ClueInfo, ClueWithAnswer, Direction, GridCellMeta } from './types.js';
import { GAME_CONFIG } from './config.js';

export interface GridSlot {
  number: number;
  direction: Direction;
  row: number;
  col: number;
  length: number;
  cells: { row: number; col: number }[];
}

/**
 * Validates 180-degree rotational symmetry of a black-square grid.
 */
export function has180Symmetry(
  grid: boolean[][],
  width: number = GAME_CONFIG.GRID_WIDTH,
  height: number = GAME_CONFIG.GRID_HEIGHT
): boolean {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const oppR = height - 1 - r;
      const oppC = width - 1 - c;
      if (grid[r][c] !== grid[oppR][oppC]) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Checks that all white cells are connected in a single component.
 */
export function isAllWhiteConnected(
  grid: boolean[][],
  width: number = GAME_CONFIG.GRID_WIDTH,
  height: number = GAME_CONFIG.GRID_HEIGHT
): boolean {
  let firstWhite: { r: number; c: number } | null = null;
  let totalWhite = 0;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!grid[r][c]) {
        totalWhite++;
        if (!firstWhite) {
          firstWhite = { r, c };
        }
      }
    }
  }

  if (!firstWhite) return false;

  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const queue: { r: number; c: number }[] = [firstWhite];
  visited[firstWhite.r][firstWhite.c] = true;
  let reachedCount = 0;

  const dr = [-1, 1, 0, 0];
  const dc = [0, 0, -1, 1];

  while (queue.length > 0) {
    const { r, c } = queue.shift()!;
    reachedCount++;

    for (let i = 0; i < 4; i++) {
      const nr = r + dr[i];
      const nc = c + dc[i];

      if (
        nr >= 0 &&
        nr < height &&
        nc >= 0 &&
        nc < width &&
        !grid[nr][nc] &&
        !visited[nr][nc]
      ) {
        visited[nr][nc] = true;
        queue.push({ r: nr, c: nc });
      }
    }
  }

  return reachedCount === totalWhite;
}

/**
 * Computes numbers and slots for across and down entries.
 * grid[r][c] is true if black cell, false if white.
 */
export function computeGridSlots(
  grid: boolean[][],
  width: number = GAME_CONFIG.GRID_WIDTH,
  height: number = GAME_CONFIG.GRID_HEIGHT
): {
  cellNumbers: (number | null)[][];
  acrossSlots: GridSlot[];
  downSlots: GridSlot[];
} {
  const cellNumbers: (number | null)[][] = Array.from({ length: height }, () =>
    Array(width).fill(null)
  );
  const acrossSlots: GridSlot[] = [];
  const downSlots: GridSlot[] = [];

  let currentNumber = 1;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r][c]) {
        continue;
      }

      const startsAcross = (c === 0 || grid[r][c - 1]) && c + 1 < width && !grid[r][c + 1];
      const startsDown = (r === 0 || grid[r - 1][c]) && r + 1 < height && !grid[r + 1][c];

      if (startsAcross || startsDown) {
        cellNumbers[r][c] = currentNumber;

        if (startsAcross) {
          const cells: { row: number; col: number }[] = [];
          let colIdx = c;
          while (colIdx < width && !grid[r][colIdx]) {
            cells.push({ row: r, col: colIdx });
            colIdx++;
          }
          acrossSlots.push({
            number: currentNumber,
            direction: 'across',
            row: r,
            col: c,
            length: cells.length,
            cells,
          });
        }

        if (startsDown) {
          const cells: { row: number; col: number }[] = [];
          let rowIdx = r;
          while (rowIdx < height && !grid[rowIdx][c]) {
            cells.push({ row: rowIdx, col: c });
            rowIdx++;
          }
          downSlots.push({
            number: currentNumber,
            direction: 'down',
            row: r,
            col: c,
            length: cells.length,
            cells,
          });
        }

        currentNumber++;
      }
    }
  }

  return { cellNumbers, acrossSlots, downSlots };
}

/**
 * Checks that every white cell belongs to both an across and a down entry.
 */
export function everyWhiteHasBothDirections(
  grid: boolean[][],
  acrossSlots: GridSlot[],
  downSlots: GridSlot[],
  width: number = GAME_CONFIG.GRID_WIDTH,
  height: number = GAME_CONFIG.GRID_HEIGHT
): boolean {
  const hasAcross = Array.from({ length: height }, () => Array(width).fill(false));
  const hasDown = Array.from({ length: height }, () => Array(width).fill(false));

  for (const slot of acrossSlots) {
    for (const cell of slot.cells) {
      hasAcross[cell.row][cell.col] = true;
    }
  }

  for (const slot of downSlots) {
    for (const cell of slot.cells) {
      hasDown[cell.row][cell.col] = true;
    }
  }

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!grid[r][c]) {
        if (!hasAcross[r][c] || !hasDown[r][c]) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Converts a 2D boolean grid into client cell metadata.
 */
export function buildGridMeta(grid: boolean[][], cellNumbers: (number | null)[][]): GridCellMeta[][] {
  return grid.map((row, r) =>
    row.map((isBlack, c) => ({
      isBlack,
      number: cellNumbers[r][c],
    }))
  );
}
