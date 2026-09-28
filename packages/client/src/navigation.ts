import { GridCellMeta } from '@crossword/shared';

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const STEPS: Record<ArrowKey, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export function isArrowKey(key: string): key is ArrowKey {
  return key in STEPS;
}

/**
 * The nearest white cell from `cell` in the arrow's direction, skipping black squares,
 * or null when there is none before the edge of the grid.
 */
export function findArrowTarget(
  gridMeta: GridCellMeta[][],
  cell: { row: number; col: number },
  key: ArrowKey
): { row: number; col: number } | null {
  const [dr, dc] = STEPS[key];
  let row = cell.row + dr;
  let col = cell.col + dc;
  while (gridMeta[row]?.[col]) {
    if (!gridMeta[row][col].isBlack) {
      return { row, col };
    }
    row += dr;
    col += dc;
  }
  return null;
}
