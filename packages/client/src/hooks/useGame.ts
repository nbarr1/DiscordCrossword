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
import { apiFetch } from '../discord.js';

/** True when every white cell of the puzzle has a letter. */
function isGridFilled(grid: string[][], puzzle: ClientPuzzlePayload): boolean {
  for (let r = 0; r < puzzle.height; r++) {
    for (let c = 0; c < puzzle.width; c++) {
      if (!puzzle.grid[r][c].isBlack && !grid[r]?.[c]) {
        return false;
      }
    }
  }
  return true;
}

export function useGame(ready: boolean = true) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<ClientPuzzlePayload | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [solution, setSolution] = useState<string[][] | null>(null);

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [direction, setDirection] = useState<Direction>('across');
  const [gridState, setGridState] = useState<string[][]>(() =>
    Array.from({ length: 15 }, () => Array(15).fill(''))
  );
  const [lockedCells, setLockedCells] = useState<Set<string>>(new Set());
  const [wrongEntries, setWrongEntries] = useState<Set<string>>(new Set());
  const [penaltySeconds, setPenaltySeconds] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Client clock minus server clock, so the displayed timer matches the server-authoritative one.
  const clockOffsetMsRef = useRef(0);
  // Latest grid for async callbacks (reveal) that resolve after further typing.
  const gridStateRef = useRef<string[][]>([]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  // Fetch puzzle and attempt on startup
  const loadPuzzle = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
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
      setPenaltySeconds(data.attempt.penaltySeconds);
      setElapsedSeconds(data.attempt.elapsedSeconds);
      setIsCompleted(data.attempt.isCompleted);
      if (data.solution) {
        setSolution(data.solution);
      }

      const locked = new Set<string>();
      for (const c of data.attempt.lockedCells) {
        locked.add(`${c.row},${c.col}`);
      }
      setLockedCells(locked);

      // Find first playable white cell
      let foundFirst = false;
      for (let r = 0; r < data.puzzle.height; r++) {
        for (let c = 0; c < data.puzzle.width; c++) {
          if (!data.puzzle.grid[r][c].isBlack) {
            setSelectedCell({ row: r, col: c });
            foundFirst = true;
            break;
          }
        }
        if (foundFirst) break;
      }
    } catch (err: any) {
      console.error('Failed to load puzzle:', err);
      setError(err.message || 'Failed to load daily puzzle');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      loadPuzzle();
    }
  }, [loadPuzzle, ready]);

  // Wall-clock elapsed timer
  useEffect(() => {
    if (!attempt || isCompleted) return;

    const interval = setInterval(() => {
      const start = new Date(attempt.startTime).getTime();
      const serverNow = Date.now() - clockOffsetMsRef.current;
      setElapsedSeconds(Math.floor(Math.max(0, serverNow - start) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [attempt, isCompleted]);

  useEffect(() => {
    gridStateRef.current = gridState;
  }, [gridState]);

  // Auto-save grid state to server
  const triggerAutoSave = useCallback((newGrid: string[][]) => {
    if (isCompleted) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(async () => {
      try {
        await apiFetch('/api/attempt/save', {
          method: 'POST',
          body: JSON.stringify({ gridState: newGrid }),
        });
      } catch (err) {
        console.warn('Auto-save failed:', err);
      }
    }, GAME_CONFIG.AUTO_SAVE_DEBOUNCE_MS);
  }, [isCompleted]);

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
    return activeEntryCells.map((c) => gridState[c.row][c.col] || ' ').join('');
  }, [activeEntryCells, gridState]);

  const isActiveEntryFull = useMemo(() => {
    return activeEntryWord.length > 0 && !activeEntryWord.includes(' ');
  }, [activeEntryWord]);

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
    if (isCompleted) return;

    try {
      const res = await apiFetch<SubmitGridResponse>('/api/attempt/submit', {
        method: 'POST',
        body: JSON.stringify({ gridState: currentGrid }),
      });

      setPenaltySeconds(res.totalPenaltySeconds);

      if (res.success) {
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
        showToast(`❌ ${res.message || 'Grid has errors (+30s penalty)'}`);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to submit grid');
    }
  }, [isCompleted, showToast]);

  // Check word action
  const checkWord = useCallback(async () => {
    if (!activeClueInfo || !isActiveEntryFull || isCompleted) return;

    const entryKey = `${activeClueInfo.number}-${direction}`;
    try {
      const res = await apiFetch<CheckWordResponse>('/api/attempt/check-word', {
        method: 'POST',
        body: JSON.stringify({
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
    } catch (err: any) {
      showToast(err.message || 'Check word failed');
    }
  }, [activeClueInfo, activeEntryWord, direction, isActiveEntryFull, isCompleted, showToast]);

  // Reveal letter action
  const revealLetter = useCallback(async () => {
    if (isCompleted || !puzzle) return;
    const { row, col } = selectedCell;
    if (lockedCells.has(`${row},${col}`)) {
      showToast('This cell is already locked / revealed!');
      return;
    }

    try {
      const res = await apiFetch<RevealLetterResponse>('/api/attempt/reveal-letter', {
        method: 'POST',
        body: JSON.stringify({ row, col }),
      });

      setPenaltySeconds(res.totalPenaltySeconds);
      setLockedCells((prev) => new Set(prev).add(`${row},${col}`));

      const next = gridStateRef.current.map((r) => [...r]);
      next[row][col] = res.letter;
      gridStateRef.current = next;
      setGridState(next);
      triggerAutoSave(next);

      showToast(`🔍 Letter revealed! (+${res.penaltyAdded}s penalty)`);
      // Revealing the last empty square completes the grid, same as typing it.
      if (isGridFilled(next, puzzle)) {
        submitGrid(next);
      } else {
        moveToNextCell();
      }
    } catch (err: any) {
      showToast(err.message || 'Reveal letter failed');
    }
  }, [isCompleted, lockedCells, moveToNextCell, puzzle, selectedCell, showToast, submitGrid, triggerAutoSave]);

  // Type letter into current cell
  const enterLetter = useCallback((char: string) => {
    if (isCompleted || !puzzle) return;
    const { row, col } = selectedCell;

    if (lockedCells.has(`${row},${col}`)) {
      moveToNextCell();
      return;
    }

    const upper = char.toUpperCase();
    const newGrid = gridState.map((r) => [...r]);
    newGrid[row][col] = upper;

    setGridState(newGrid);
    triggerAutoSave(newGrid);

    // Auto-check if entire grid is filled now!
    if (isGridFilled(newGrid, puzzle)) {
      submitGrid(newGrid);
    } else {
      moveToNextCell();
    }
  }, [gridState, isCompleted, lockedCells, moveToNextCell, puzzle, selectedCell, submitGrid, triggerAutoSave]);

  // Backspace key
  const handleBackspace = useCallback(() => {
    if (isCompleted) return;
    const { row, col } = selectedCell;

    if (!lockedCells.has(`${row},${col}`) && gridState[row][col]) {
      const newGrid = gridState.map((r) => [...r]);
      newGrid[row][col] = '';
      setGridState(newGrid);
      triggerAutoSave(newGrid);
    } else {
      moveToPrevCell();
    }
  }, [gridState, isCompleted, lockedCells, moveToPrevCell, selectedCell, triggerAutoSave]);

  // Global keydown listeners (typing & backspace)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore when focusing input or modal
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }

      if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        enterLetter(e.key);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterLetter, handleBackspace]);

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
