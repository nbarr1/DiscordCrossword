import { GridCellMeta } from '@crossword/shared';
import { Delete, Keyboard as KeyboardIcon, Lock } from 'lucide-react';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

export interface CrosswordGridHandle {
  handleKeyDown: (e: KeyboardEvent | React.KeyboardEvent) => void;
}

export interface CrosswordGridProps {
  gridMeta: GridCellMeta[][];
  gridState: string[][];
  solution?: string[][] | null;
  selectedCell: { row: number; col: number };
  activeEntryCells: { row: number; col: number }[];
  lockedCells: Set<string>;
  isWrongEntryActive: boolean;
  onSelectCell: (row: number, col: number) => void;
  onEnterLetter: (char: string) => void;
  onBackspace: () => void;
  onNextClue?: () => void;
  onPrevClue?: () => void;
  onKeyDown?: (e: KeyboardEvent | React.KeyboardEvent) => void;
}

const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

export const CrosswordGrid = forwardRef<CrosswordGridHandle, CrosswordGridProps>(
  (
    {
      gridMeta,
      gridState,
      solution,
      selectedCell,
      activeEntryCells,
      lockedCells,
      isWrongEntryActive,
      onSelectCell,
      onEnterLetter,
      onBackspace,
      onNextClue,
      onPrevClue,
      onKeyDown,
    },
    ref
  ) => {
    const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);

    const activeEntrySet = useMemo(() => {
      const s = new Set<string>();
      for (const c of activeEntryCells) {
        s.add(`${c.row},${c.col}`);
      }
      return s;
    }, [activeEntryCells]);

    // Keep freshest state & callbacks in ref to keep handleKeyDown stable
    const stateRef = useRef({
      selectedCell,
      gridMeta,
      onSelectCell,
      onNextClue,
      onPrevClue,
      onKeyDown,
    });
    stateRef.current = {
      selectedCell,
      gridMeta,
      onSelectCell,
      onNextClue,
      onPrevClue,
      onKeyDown,
    };

    // Handle arrow keys navigation and Tab / Shift+Tab clue switching
    const handleKeyDown = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
      const {
        selectedCell: curCell,
        gridMeta: curMeta,
        onSelectCell: curSelect,
        onNextClue: curNext,
        onPrevClue: curPrev,
        onKeyDown: curKeyDown,
      } = stateRef.current;

      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          curPrev?.();
        } else {
          curNext?.();
        }
        curKeyDown?.(e);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        let nextR = curCell.row - 1;
        while (nextR >= 0 && curMeta[nextR]?.[curCell.col]?.isBlack) {
          nextR--;
        }
        if (nextR >= 0 && !curMeta[nextR]?.[curCell.col]?.isBlack) {
          curSelect(nextR, curCell.col);
        }
        curKeyDown?.(e);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        let nextR = curCell.row + 1;
        while (nextR < curMeta.length && curMeta[nextR]?.[curCell.col]?.isBlack) {
          nextR++;
        }
        if (nextR < curMeta.length && !curMeta[nextR]?.[curCell.col]?.isBlack) {
          curSelect(nextR, curCell.col);
        }
        curKeyDown?.(e);
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        let nextC = curCell.col - 1;
        while (nextC >= 0 && curMeta[curCell.row]?.[nextC]?.isBlack) {
          nextC--;
        }
        if (nextC >= 0 && !curMeta[curCell.row]?.[nextC]?.isBlack) {
          curSelect(curCell.row, nextC);
        }
        curKeyDown?.(e);
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        let nextC = curCell.col + 1;
        while (nextC < (curMeta[0]?.length || 0) && curMeta[curCell.row]?.[nextC]?.isBlack) {
          nextC++;
        }
        if (nextC < (curMeta[0]?.length || 0) && !curMeta[curCell.row]?.[nextC]?.isBlack) {
          curSelect(curCell.row, nextC);
        }
        curKeyDown?.(e);
        return;
      }

      curKeyDown?.(e);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown,
      }),
      [handleKeyDown]
    );

    return (
      <div
        tabIndex={0}
        onKeyDown={(e) => handleKeyDown(e)}
        className="flex flex-col items-center select-none w-full max-w-[540px] focus:outline-none"
      >
        {/* Crossword Table (sized from the puzzle, which may not be 15x15) */}
        <div className="w-full aspect-square bg-[#111214] p-1 sm:p-2 rounded-xl shadow-2xl border border-[#2b2d31]">
          <div
            className="grid w-full h-full gap-[1px] sm:gap-[1.5px] bg-[#232428] rounded-lg overflow-hidden border border-[#1f2023]"
            style={{
              gridTemplateColumns: `repeat(${gridMeta[0]?.length || 1}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridMeta.length || 1}, minmax(0, 1fr))`,
            }}
          >
            {gridMeta.map((row, r) =>
              row.map((cell, c) => {
                const isSelected = selectedCell.row === r && selectedCell.col === c;
                const isInActiveEntry = activeEntrySet.has(`${r},${c}`);
                const isLocked = lockedCells.has(`${r},${c}`);
                const letter = gridState[r]?.[c] || '';
                const hasLetter = letter.trim().length > 0;
                const expected = solution?.[r]?.[c]?.toUpperCase();
                const isCorrect = hasLetter && expected ? letter.toUpperCase() === expected : false;
                const isIncorrect = hasLetter && expected ? letter.toUpperCase() !== expected : false;

                if (cell.isBlack) {
                  return (
                    <div
                      key={`cell-${r}-${c}`}
                      className="bg-[#111214] w-full h-full"
                    />
                  );
                }

                // Determine cell styling with realtime feedback
                let cellBg = 'bg-[#ffffff] text-slate-900';
                if (isSelected) {
                  if (isCorrect) {
                    cellBg = 'bg-[#d1fae5] ring-2 ring-[#10b981] text-[#065f46] font-extrabold z-10 shadow-sm';
                  } else if (isIncorrect) {
                    cellBg = 'bg-[#fee2e2] ring-2 ring-[#ef4444] text-[#991b1b] font-extrabold z-10 shadow-sm';
                  } else {
                    cellBg = 'bg-[#ffeaa7] text-black font-extrabold ring-2 ring-[#5865f2] z-10 shadow-sm';
                  }
                } else if (isInActiveEntry) {
                  if (isCorrect) {
                    cellBg = 'bg-[#dcfce7] text-[#14532d] font-bold ring-1 ring-[#86efac]/80';
                  } else if (isIncorrect) {
                    cellBg = 'bg-[#ffe4e6] text-[#9f1239] font-bold ring-1 ring-[#fca5a5]/80';
                  } else {
                    cellBg = isWrongEntryActive
                      ? 'bg-[#ff7675]/30 text-black font-bold'
                      : 'bg-[#dff9fb] text-black font-bold';
                  }
                } else {
                  if (isCorrect) {
                    cellBg = 'bg-[#ecfdf5] text-[#15803d] font-bold';
                  } else if (isIncorrect) {
                    cellBg = 'bg-[#fff1f2] text-[#b91c1c] font-bold';
                  }
                }

                return (
                  <button
                    key={`cell-${r}-${c}`}
                    onClick={() => onSelectCell(r, c)}
                    type="button"
                    className={`relative w-full h-full flex items-center justify-center transition-colors cursor-pointer outline-none ${cellBg}`}
                  >
                    {/* Clue Number */}
                    {cell.number && (
                      <span className="absolute top-[1px] left-[2px] text-[8px] sm:text-[9.5px] leading-none text-slate-500 font-semibold pointer-events-none">
                        {cell.number}
                      </span>
                    )}

                    {/* Realtime Status Indicator Pip */}
                    {hasLetter && expected && (
                      <span
                        className={`absolute top-[2px] right-[2px] w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full pointer-events-none transition-all ${
                          isCorrect ? 'bg-[#10b981]' : 'bg-[#ef4444] animate-pulse'
                        }`}
                        title={isCorrect ? 'Correct letter' : 'Incorrect letter'}
                      />
                    )}

                    {/* Letter */}
                    <span className="text-sm sm:text-lg md:text-xl font-bold uppercase mt-1 leading-none">
                      {letter}
                    </span>

                    {/* Locked Badge */}
                    {isLocked && (
                      <span className="absolute bottom-[1px] right-[1px] text-[#23a55a] pointer-events-none opacity-80">
                        <Lock className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Virtual On-Screen Keyboard Toggle & Realtime Feedback Status */}
        <div className="w-full flex flex-wrap items-center justify-between mt-2.5 px-1 gap-2">
          {/* The solution only reaches the client after the puzzle is finished (or closed). */}
          {solution ? (
          <div className="flex items-center gap-2 text-[11px] sm:text-xs">
            <span className="text-[#949ba4] hidden sm:inline">Answer check:</span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#ecfdf5] border border-[#a7f3d0] text-[#065f46] font-semibold text-[10px] sm:text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>
              Correct
            </span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#fff1f2] border border-[#fecdd3] text-[#9f1239] font-semibold text-[10px] sm:text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]"></span>
              Incorrect
            </span>
          </div>
          ) : (
            <span />
          )}
          <button
            onClick={() => setShowVirtualKeyboard((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-[#2b2d31] hover:bg-[#313338] text-[#dbdee1] border border-[#383a40] transition-colors"
          >
            <KeyboardIcon className="w-3.5 h-3.5 text-[#5865f2]" />
            <span>{showVirtualKeyboard ? 'Hide Keypad' : 'Mobile Keypad'}</span>
          </button>
        </div>

        {/* Virtual Keypad for Mobile Viewports */}
        {showVirtualKeyboard && (
          <div className="w-full mt-2 p-2 bg-[#2b2d31] rounded-xl border border-[#313338] shadow-lg flex flex-col gap-1.5">
            {KEYBOARD_ROWS.map((row, rowIdx) => (
              <div key={`krow-${rowIdx}`} className="flex justify-center gap-1">
                {row.map((char) => (
                  <button
                    key={char}
                    onClick={() => onEnterLetter(char)}
                    className="flex-1 max-w-[36px] h-10 rounded bg-[#383a40] hover:bg-[#4e5058] active:bg-[#5865f2] text-white font-bold text-sm flex items-center justify-center shadow transition-transform active:scale-95"
                  >
                    {char}
                  </button>
                ))}
                {rowIdx === 2 && (
                  <button
                    onClick={onBackspace}
                    title="Backspace"
                    className="px-3 h-10 rounded bg-[#4e5058] hover:bg-[#5865f2] text-white flex items-center justify-center shadow transition-transform active:scale-95"
                  >
                    <Delete className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);

CrosswordGrid.displayName = 'CrosswordGrid';
