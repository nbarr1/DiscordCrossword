import { describe, expect, it } from 'vitest';
import { findArrowTarget } from '../packages/client/src/navigation.js';
import { GridCellMeta } from '../packages/shared/src/index.js';

describe('Crossword Grid Keyboard Navigation', () => {
  // Simple 3x3 test grid where (1, 1) is a black cell:
  // [white, white, white]
  // [white, BLACK, white]
  // [white, white, white]
  const w = (number: number): GridCellMeta => ({ isBlack: false, number });
  const mockGridMeta: GridCellMeta[][] = [
    [w(1), w(2), w(3)],
    [w(4), { isBlack: true, number: null }, w(5)],
    [w(6), w(7), w(8)],
  ];

  it('moves one cell with the arrow keys', () => {
    expect(findArrowTarget(mockGridMeta, { row: 0, col: 0 }, 'ArrowRight')).toEqual({ row: 0, col: 1 });
    expect(findArrowTarget(mockGridMeta, { row: 0, col: 1 }, 'ArrowLeft')).toEqual({ row: 0, col: 0 });
  });

  it('skips over black squares', () => {
    expect(findArrowTarget(mockGridMeta, { row: 0, col: 1 }, 'ArrowDown')).toEqual({ row: 2, col: 1 });
    expect(findArrowTarget(mockGridMeta, { row: 2, col: 1 }, 'ArrowUp')).toEqual({ row: 0, col: 1 });
    expect(findArrowTarget(mockGridMeta, { row: 1, col: 0 }, 'ArrowRight')).toEqual({ row: 1, col: 2 });
  });

  it('stays put at the edge of the grid', () => {
    expect(findArrowTarget(mockGridMeta, { row: 0, col: 2 }, 'ArrowRight')).toBeNull();
    expect(findArrowTarget(mockGridMeta, { row: 0, col: 0 }, 'ArrowUp')).toBeNull();
  });
});
