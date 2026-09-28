import {
  AttemptState,
  CheckWordResponse,
  ClientPuzzlePayload,
  ClueInfo,
  Direction,
  GAME_CONFIG,
  RevealLetterResponse,
  SubmitGridResponse,
} from '@crossword/shared';
import confetti from 'canvas-confetti';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, isPuzzleClosedError } from '../discord.js';

/** True when every white cell of the puzzle has a letter. */
export function isGridFilled(grid: string[][], puzzle: ClientPuzzlePayload): boolean {
  for (let r = 0; r < puzzle.height; r++) {
    for (let c = 0; c < puzzle.width; c++) {
      if (!puzzle.grid[r][c].isBlack && !grid[r]?.[c]) {
        return false;
      }
    }
  }
  return true;
}

// setTimeout can't wait longer than about 24.8 days; puzzles close well within that.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function useGame(ready: boolean = true) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<ClientPuzzlePayload | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [solution, setSolution] = useState<string[][] | null>(null);

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [direction, setDirection] = useState<Direction>('across');
  const [gridState, setGridState] = useState<string[][]>([]);
  const [lockedCells, setLockedCells] = useState<Set<string>>(new Set());
  const [wrongEntries, setWrongEntries] = useState<Set<string>>(new Set());
  const [penaltySeconds, setPenaltySeconds] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  // The daily release replaced this puzzle; the player can't act on it any more.
  const [isClosed, setIsClosed] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Client clock minus server clock, so the displayed timer matches the server-authoritative one.
  const clockOffsetMsRef = useRef(0);
  // Latest grid for async callbacks (reveal) that resolve after further typing.
  const gridStateRef = useRef<string[][]>([]);

  const puzzleId = puzzle?.id;
  const canPlay = !!puzzle && !isCompleted && !isClosed;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  /** Shared handling for a failed attempt request: a closed puzzle switches the game to its closed state. */
  const handleRequestError = useCallback(
    (err: unknown, fallbackMessage: string) => {
      if (isPuzzleClosedError(err)) {
        cancelPendingSave();
        setIsClosed(true);
        return;
      }
      showToast((err as Error)?.message || fallbackMessage);
    },
    [cancelPendingSave, showToast]
  );

  // Fetch puzzle and attempt on startup
  const loadPuzzle = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      cancelPendingSave();
      const data = await apiFetch<{
        puzzle: ClientPuzzlePayload;
        attempt: AttemptState;
        solution?: string[][];
      }>('/api/puzzle/today');

      clockOffsetMsRef.current =
        Date.now() - (new Date(data.attempt.startTime).getTime() + data.attempt.elapsedSeconds * 1000);
      setPuzzle(data.puzzle);
      setAttempt(data.attempt);
      setGridState(data.attempt.gridState);
      gridStateRef.current = data.attempt.gridState;
      setPenaltySeconds(data.attempt.penaltySeconds);
      setElapsedSeconds(data.attempt.elapsedSeconds);
      setIsCompleted(data.attempt.isCompleted);
      setIsClosed(false);
      setSolution(data.solution ?? null);
      setWrongEntries(new Set());
      setLockedCells(new Set(data.attempt.lockedCells.map((c) => `${c.row},${c.col}`)));
      setDirection('across');

      // Find first playable white cell
      let foundFirst = false;
      for (let r = 0; r < data.puzzle.height && !foundFirst; r++) {
        for (let c = 0; c < data.puzzle.width; c++) {
          if (!data.puzzle.grid[r][c].isBlack) {
            setSelectedCell({ row: r, col: c });
            foundFirst = true;
            break;
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load puzzle:', err);
      setError(err.message || 'Failed to load daily puzzle');
    } finally {
      setLoading(false);
    }
  }, [cancelPendingSave]);

  useEffect(() => {
    if (ready) {
      loadPuzzle();
    }
  }, [loadPuzzle, ready]);

  // Wall-clock elapsed timer
  useEffect(() => {
    if (!attempt || isCompleted || isClosed) return;

    const interval = setInterval(() => {
      const start = new Date(attempt.startTime).getTime();
      const serverNow = Date.now() - clockOffsetMsRef.current;
      setElapsedSeconds(Math.floor(Math.max(0, serverNow - start) / 1000));
    }, GAME_CONFIG.TIMER_SYNC_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [attempt, isCompleted, isClosed]);

  // Close the puzzle on screen when its day ends, even if the player isn't typing.
  useEffect(() => {
    if (!puzzle || isClosed) return;
    const msUntilClose = new Date(puzzle.expiresAt).getTime() - (Date.now() - clockOffsetMsRef.current);
    if (msUntilClose <= 0) {
      setIsClosed(true);
      return;
    }
    const timer = setTimeout(() => setIsClosed(true), Math.min(msUntilClose, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [puzzle, isClosed]);

  useEffect(() => {
    gridStateRef.current = gridState;
  }, [gridState]);

  // Auto-save grid state to server
  const triggerAutoSave = useCallback(
    (newGrid: string[][]) => {
      if (!puzzleId || isCompleted || isClosed) return;
      cancelPendingSave();

      saveTimerRef.current = setTimeout(async () => {
        saveTimerRef.current = null;
        try {
          await apiFetch('/api/attempt/save', {
            method: 'POST',
            body: JSON.stringify({ puzzleId, gridState: newGrid }),
          });
        } catch (err) {
          if (isPuzzleClosedError(err)) {
            setIsClosed(true);
          } else {
            console.warn('Auto-save failed:', err);
          }
        }
      }, GAME_CONFIG.AUTO_SAVE_DEBOUNCE_MS);
    },
    [cancelPendingSave, isClosed, isCompleted, puzzleId]
  );

  // Active clue determination
  const activeClueInfo = useMemo((): ClueInfo | null => {
    if (!puzzle) return null;
    const { row, col } = selectedCell;
    const isAcross = direction === 'across';
    const clues = isAcross ? puzzle.clues.across : puzzle.clues.down;

    for (const clue of clues) {
      if (isAcross) {
        if (clue.row === row && col >= clue.col && col < clue.col + clue.length) {
          return clue;
        }
      } else {
        if (clue.col === col && row >= clue.row && row < clue.row + clue.length) {
          return clue;
        }
      }
    }
    return null;
  }, [puzzle, selectedCell, direction]);

  // Active entry cells
  const activeEntryCells = useMemo(() => {
    if (!activeClueInfo) return [];
    const cells: { row: number; col: number }[] = [];
    const isAcross = direction === 'across';
    for (let i = 0; i < activeClueInfo.length; i++) {
      cells.push({
        row: isAcross ? activeClueInfo.row : activeClueInfo.row + i,
        col: isAcross ? activeClueInfo.col + i : activeClueInfo.col,
      });
    }
    return cells;
  }, [activeClueInfo, direction]);

  // Check if active entry is full
  const activeEntryWord = useMemo(() => {
    return activeEntryCells.map((c) => gridState[c.row]?.[c.col] || ' ').join('');
  }, [activeEntryCells, gridState]);

  const isActiveEntryFull = useMemo(() => {
    return activeEntryWord.length > 0 && !activeEntryWord.includes(' ');
  }, [activeEntryWord]);

  const isGridFull = useMemo(() => (puzzle ? isGridFilled(gridState, puzzle) : false), [gridState, puzzle]);

  // Cell selection & direction toggle
  const selectCell = useCallback((r: number, c: number) => {
    if (!puzzle || puzzle.grid[r][c].isBlack) return;

    if (selectedCell.row === r && selectedCell.col === c) {
      // Toggle direction when clicking the selected cell again
      setDirection((prev) => (prev === 'across' ? 'down' : 'across'));
    } else {
      setSelectedCell({ row: r, col: c });
    }
  }, [puzzle, selectedCell]);

  // Jump to specific clue
  const jumpToClue = useCallback((clue: ClueInfo) => {
    setDirection(clue.direction);
    setSelectedCell({ row: clue.row, col: clue.col });
  }, []);

  // Navigation helpers
  const moveToNextCell = useCallback(() => {
    if (!puzzle) return;
    const isAcross = direction === 'across';
    let nextR = selectedCell.row;
    let nextC = selectedCell.col;

    if (isAcross) {
      nextC++;
      while (nextC < puzzle.width && puzzle.grid[nextR][nextC].isBlack) {
        nextC++;
      }
    } else {
      nextR++;
      while (nextR < puzzle.height && puzzle.grid[nextR][nextC].isBlack) {
        nextR++;
      }
    }

    if (nextR < puzzle.height && nextC < puzzle.width) {
      setSelectedCell({ row: nextR, col: nextC });
    }
  }, [direction, puzzle, selectedCell]);

  const moveToPrevCell = useCallback(() => {
    if (!puzzle) return;
    const isAcross = direction === 'across';
    let prevR = selectedCell.row;
    let prevC = selectedCell.col;

    if (isAcross) {
      prevC--;
      while (prevC >= 0 && puzzle.grid[prevR][prevC].isBlack) {
        prevC--;
      }
    } else {
      prevR--;
      while (prevR >= 0 && puzzle.grid[prevR][prevC].isBlack) {
        prevR--;
      }
    }

    if (prevR >= 0 && prevC >= 0) {
      setSelectedCell({ row: prevR, col: prevC });
    }
  }, [direction, puzzle, selectedCell]);

  const moveToNextClue = useCallback(() => {
    if (!puzzle || !activeClueInfo) return;
    const list = direction === 'across' ? puzzle.clues.across : puzzle.clues.down;
    const currentIndex = list.findIndex((c) => c.number === activeClueInfo.number);

    if (currentIndex >= 0 && currentIndex < list.length - 1) {
      jumpToClue(list[currentIndex + 1]);
    } else {
      // Wrap to other direction
      const nextDir = direction === 'across' ? 'down' : 'across';
      const otherList = nextDir === 'across' ? puzzle.clues.across : puzzle.clues.down;
      if (otherList.length > 0) {
        jumpToClue(otherList[0]);
      }
    }
  }, [activeClueInfo, direction, jumpToClue, puzzle]);

  const moveToPrevClue = useCallback(() => {
    if (!puzzle || !activeClueInfo) return;
    const list = direction === 'across' ? puzzle.clues.across : puzzle.clues.down;
    const currentIndex = list.findIndex((c) => c.number === activeClueInfo.number);

    if (currentIndex > 0) {
      jumpToClue(list[currentIndex - 1]);
    } else {
      const prevDir = direction === 'across' ? 'down' : 'across';
      const otherList = prevDir === 'across' ? puzzle.clues.across : puzzle.clues.down;
      if (otherList.length > 0) {
        jumpToClue(otherList[otherList.length - 1]);
      }
    }
  }, [activeClueInfo, direction, jumpToClue, puzzle]);

  // Submit grid
  const submitGrid = useCallback(async (currentGrid: string[][]) => {
    if (!puzzleId || isCompleted || isClosed) return;

    try {
      const res = await apiFetch<SubmitGridResponse>('/api/attempt/submit', {
        method: 'POST',
        body: JSON.stringify({ puzzleId, gridState: currentGrid }),
      });

      setPenaltySeconds(res.totalPenaltySeconds);

      if (res.success) {
        // The submission saved the grid; a pending autosave would only be refused.
        cancelPendingSave();
        setIsCompleted(true);
        // Show the server's official time rather than the local ticker.
        if (res.totalScoreSeconds !== undefined) {
          setElapsedSeconds(res.totalScoreSeconds - res.totalPenaltySeconds);
        }
        if (res.solution) {
          setSolution(res.solution);
        }
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
        });
        showToast('🎉 Congratulations! You solved today’s crossword!');
      } else {
        showToast(`❌ ${res.message || 'Grid has errors'} (+${res.penaltyAdded}s). Fix the errors, then press Submit.`);
      }
    } catch (err) {
      handleRequestError(err, 'Failed to submit grid');
    }
  }, [cancelPendingSave, handleRequestError, isClosed, isCompleted, puzzleId, showToast]);

  // Check word action
  const checkWord = useCallback(async () => {
    if (!puzzleId || !activeClueInfo || !isActiveEntryFull || !canPlay) return;

    const entryKey = `${activeClueInfo.number}-${direction}`;
    try {
      const res = await apiFetch<CheckWordResponse>('/api/attempt/check-word', {
        method: 'POST',
        body: JSON.stringify({
          puzzleId,
          entryNumber: activeClueInfo.number,
          direction,
          word: activeEntryWord,
        }),
      });

      setPenaltySeconds(res.totalPenaltySeconds);

      if (res.correct) {
        setWrongEntries((prev) => {
          const next = new Set(prev);
          next.delete(entryKey);
          return next;
        });

        if (res.lockedCells) {
          setLockedCells((prev) => {
            const next = new Set(prev);
            for (const c of res.lockedCells!) {
              next.add(`${c.row},${c.col}`);
            }
            return next;
          });
        }
        showToast(`✅ ${activeClueInfo.number}-${direction.toUpperCase()} is correct!`);
      } else {
        setWrongEntries((prev) => new Set(prev).add(entryKey));
        const penaltyNotice = res.penaltyAdded > 0 ? ` (+${res.penaltyAdded}s penalty)` : ' (already penalized)';
        showToast(`❌ ${activeClueInfo.number}-${direction.toUpperCase()} is incorrect${penaltyNotice}`);
      }
    } catch (err) {
      handleRequestError(err, 'Check word failed');
    }
  }, [activeClueInfo, activeEntryWord, canPlay, direction, handleRequestError, isActiveEntryFull, puzzleId, showToast]);

  // Reveal letter action
  const revealLetter = useCallback(async () => {
    if (!puzzle || !canPlay) return;
    const { row, col } = selectedCell;
    if (lockedCells.has(`${row},${col}`)) {
      showToast('This cell is already locked / revealed!');
      return;
    }

    try {
      const res = await apiFetch<RevealLetterResponse>('/api/attempt/reveal-letter', {
        method: 'POST',
        body: JSON.stringify({ puzzleId: puzzle.id, row, col }),
      });

      setPenaltySeconds(res.totalPenaltySeconds);
      setLockedCells((prev) => new Set(prev).add(`${row},${col}`));

      const wasFull = isGridFilled(gridStateRef.current, puzzle);
      const next = gridStateRef.current.map((r) => [...r]);
      next[row][col] = res.letter;
      gridStateRef.current = next;
      setGridState(next);
      triggerAutoSave(next);

      showToast(`🔍 Letter revealed! (+${res.penaltyAdded}s penalty)`);
      // Revealing the last empty square completes the grid, same as typing it.
      if (!wasFull && isGridFilled(next, puzzle)) {
        submitGrid(next);
      } else {
        moveToNextCell();
      }
    } catch (err) {
      handleRequestError(err, 'Reveal letter failed');
    }
  }, [canPlay, handleRequestError, lockedCells, moveToNextCell, puzzle, selectedCell, showToast, submitGrid, triggerAutoSave]);

  // Type letter into current cell
  const enterLetter = useCallback((char: string) => {
    if (!puzzle || !canPlay) return;
    const { row, col } = selectedCell;

    if (lockedCells.has(`${row},${col}`)) {
      moveToNextCell();
      return;
    }

    const newGrid = gridState.map((r) => [...r]);
    newGrid[row][col] = char.toUpperCase();

    setGridState(newGrid);
    triggerAutoSave(newGrid);

    // Submit automatically only when this letter fills the last empty square. Typing over a
    // letter in an already-full grid doesn't resubmit (each wrong submission costs time);
    // the player presses Submit when ready.
    if (!isGridFilled(gridState, puzzle) && isGridFilled(newGrid, puzzle)) {
      submitGrid(newGrid);
    } else {
      moveToNextCell();
    }
  }, [canPlay, gridState, lockedCells, moveToNextCell, puzzle, selectedCell, submitGrid, triggerAutoSave]);

  // Backspace key
  const handleBackspace = useCallback(() => {
    if (!canPlay) return;
    const { row, col } = selectedCell;

    if (!lockedCells.has(`${row},${col}`) && gridState[row]?.[col]) {
      const newGrid = gridState.map((r) => [...r]);
      newGrid[row][col] = '';
      setGridState(newGrid);
      triggerAutoSave(newGrid);
    } else {
      moveToPrevCell();
    }
  }, [canPlay, gridState, lockedCells, moveToPrevCell, selectedCell, triggerAutoSave]);

  return {
    loading,
    error,
    puzzle,
    attempt,
    solution,
    selectedCell,
    direction,
    gridState,
    lockedCells,
    wrongEntries,
    penaltySeconds,
    elapsedSeconds,
    totalScoreSeconds: elapsedSeconds + penaltySeconds,
    isCompleted,
    isClosed,
    isGridFull,
    activeClueInfo,
    activeEntryCells,
    isActiveEntryFull,
    toastMessage,
    selectCell,
    jumpToClue,
    moveToNextClue,
    moveToPrevClue,
    checkWord,
    revealLetter,
    submitGrid: () => submitGrid(gridState),
    enterLetter,
    handleBackspace,
    reload: loadPuzzle,
  };
}
