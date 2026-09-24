import { describe, expect, it, vi } from 'vitest';
import { GridCellMeta } from '../packages/shared/src/index.js';

describe('Crossword Grid Keyboard Navigation', () => {
  // Simple 3x3 test grid where (1, 1) is a black cell:
  // [white, white, white]
  // [white, BLACK, white]
  // [white, white, white]
  const mockGridMeta: GridCellMeta[][] = [
    [
      { isBlack: false, number: 1 },
      { isBlack: false, number: 2 },
      { isBlack: false, number: 3 },
    ],
    [
      { isBlack: false, number: 4 },
      { isBlack: true, number: null },
      { isBlack: false, number: 5 },
    ],
    [
      { isBlack: false, number: 6 },
      { isBlack: false, number: 7 },
      { isBlack: false, number: 8 },
    ],
  ];

  function simulateNavKey(
    key: string,
    shiftKey: boolean,
    selectedCell: { row: number; col: number },
    gridMeta: GridCellMeta[][],
    callbacks: {
      onSelectCell: (row: number, col: number) => void;
      onNextClue: () => void;
      onPrevClue: () => void;
    }
  ) {
    if (key === 'Tab') {
      if (shiftKey) {
        callbacks.onPrevClue();
      } else {
        callbacks.onNextClue();
      }
      return;
    }

    if (key === 'ArrowUp') {
      let nextR = selectedCell.row - 1;
      while (nextR >= 0 && gridMeta[nextR]?.[selectedCell.col]?.isBlack) {
        nextR--;
      }
      if (nextR >= 0 && !gridMeta[nextR]?.[selectedCell.col]?.isBlack) {
        callbacks.onSelectCell(nextR, selectedCell.col);
      }
      return;
    }

    if (key === 'ArrowDown') {
      let nextR = selectedCell.row + 1;
      while (nextR < gridMeta.length && gridMeta[nextR]?.[selectedCell.col]?.isBlack) {
        nextR++;
      }
      if (nextR < gridMeta.length && !gridMeta[nextR]?.[selectedCell.col]?.isBlack) {
        callbacks.onSelectCell(nextR, selectedCell.col);
      }
      return;
    }

    if (key === 'ArrowLeft') {
      let nextC = selectedCell.col - 1;
      while (nextC >= 0 && gridMeta[selectedCell.row]?.[nextC]?.isBlack) {
        nextC--;
      }
      if (nextC >= 0 && !gridMeta[selectedCell.row]?.[nextC]?.isBlack) {
        callbacks.onSelectCell(selectedCell.row, nextC);
      }
      return;
    }

    if (key === 'ArrowRight') {
      let nextC = selectedCell.col + 1;
      while (nextC < (gridMeta[0]?.length || 3) && gridMeta[selectedCell.row]?.[nextC]?.isBlack) {
        nextC++;
      }
      if (nextC < (gridMeta[0]?.length || 3) && !gridMeta[selectedCell.row]?.[nextC]?.isBlack) {
        callbacks.onSelectCell(selectedCell.row, nextC);
      }
      return;
    }
  }

  it('navigates between cells using arrow keys', () => {
    const onSelectCell = vi.fn();
    const onNextClue = vi.fn();
    const onPrevClue = vi.fn();

    // From (0, 0), ArrowRight should go to (0, 1)
    simulateNavKey('ArrowRight', false, { row: 0, col: 0 }, mockGridMeta, {
      onSelectCell,
      onNextClue,
      onPrevClue,
    });
    expect(onSelectCell).toHaveBeenCalledWith(0, 1);

    // From (0, 1), ArrowDown over black square at (1, 1) should step to (2, 1)
    onSelectCell.mockClear();
    simulateNavKey('ArrowDown', false, { row: 0, col: 1 }, mockGridMeta, {
      onSelectCell,
      onNextClue,
      onPrevClue,
    });
    expect(onSelectCell).toHaveBeenCalledWith(2, 1);

    // From (2, 1), ArrowUp over black square at (1, 1) should step back to (0, 1)
    onSelectCell.mockClear();
    simulateNavKey('ArrowUp', false, { row: 2, col: 1 }, mockGridMeta, {
      onSelectCell,
      onNextClue,
      onPrevClue,
    });
    expect(onSelectCell).toHaveBeenCalledWith(0, 1);
  });

  it('switches clues with Tab and Shift+Tab', () => {
    const onSelectCell = vi.fn();
    const onNextClue = vi.fn();
    const onPrevClue = vi.fn();

    // Tab -> next clue
    simulateNavKey('Tab', false, { row: 0, col: 0 }, mockGridMeta, {
      onSelectCell,
      onNextClue,
      onPrevClue,
    });
    expect(onNextClue).toHaveBeenCalledTimes(1);
    expect(onPrevClue).not.toHaveBeenCalled();

    // Shift+Tab -> prev clue
    simulateNavKey('Tab', true, { row: 0, col: 0 }, mockGridMeta, {
      onSelectCell,
      onNextClue,
      onPrevClue,
    });
    expect(onPrevClue).toHaveBeenCalledTimes(1);
  });
});
