// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../packages/client/src/App.js';
import { CrosswordGrid, CrosswordGridHandle } from '../packages/client/src/components/CrosswordGrid.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// 3x3 puzzle with a black center square.
const W = (number: number | null = null) => ({ isBlack: false, number });
const PUZZLE = {
  id: 'puzzle-test',
  date: '2030-01-01',
  title: 'Test Puzzle',
  author: 'Tests',
  width: 3,
  height: 3,
  grid: [
    [W(1), W(), W(2)],
    [W(), { isBlack: true, number: null }, W()],
    [W(3), W(), W()],
  ],
  clues: {
    across: [
      { number: 1, direction: 'across', text: 'Top row', row: 0, col: 0, length: 3 },
      { number: 3, direction: 'across', text: 'Bottom row', row: 2, col: 0, length: 3 },
    ],
    down: [
      { number: 1, direction: 'down', text: 'Left column', row: 0, col: 0, length: 3 },
      { number: 2, direction: 'down', text: 'Right column', row: 0, col: 2, length: 3 },
    ],
  },
  expiresAt: '2999-01-01T00:00:00.000Z',
  isClosed: false,
};

let savedGrid: string[][];
let submitCalls: number;
let closed: boolean;

function reply(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

beforeEach(() => {
  savedGrid = [
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
  ];
  submitCalls = 0;
  closed = false;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (closed && url.startsWith('/api/attempt/')) {
        return reply(409, { error: 'This puzzle has closed.', code: 'PUZZLE_CLOSED' });
      }
      if (url === '/api/auth/token') {
        return reply(200, { token: 't', user: { id: 'u', username: 'u', displayName: 'U', avatar: null }, guildId: null });
      }
      if (url === '/api/puzzle/today') {
        return reply(200, {
          puzzle: PUZZLE,
          attempt: {
            id: 'a',
            puzzleId: PUZZLE.id,
            userId: 'u',
            guildId: null,
            startTime: new Date().toISOString(),
            finishTime: null,
            elapsedSeconds: 0,
            penaltySeconds: 0,
            totalScoreSeconds: 0,
            isCompleted: false,
            gridState: savedGrid,
            lockedCells: [],
            wrongAnswersPerEntry: {},
          },
        });
      }
      if (url === '/api/attempt/submit') {
        submitCalls++;
        return reply(200, { success: false, penaltyAdded: 30, totalPenaltySeconds: 30 * submitCalls, message: 'Wrong' });
      }
      return reply(200, { success: true });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderGame() {
  const view = render(<App />);
  await screen.findByText('Test Puzzle');
  const cells = () => [...view.container.querySelector('div.grid.w-full.h-full')!.children] as HTMLElement[];
  const selectedIndex = () => cells().findIndex((c) => c.className.includes('ring-2'));
  const letters = () => cells().map((c) => (c.tagName === 'BUTTON' ? c.textContent!.replace(/\d/g, '').trim() || '.' : '#')).join('');
  return { cells, selectedIndex, letters };
}

const key = (target: Element | Window, k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(target, { key: k, ...init });
  });

describe('Keyboard handling', () => {
  it('moves one square per arrow key, even while a grid square has focus', async () => {
    const { cells, selectedIndex } = await renderGame();
    fireEvent.click(cells()[0]);
    cells()[0].focus();

    await key(cells()[0], 'ArrowRight');
    expect(selectedIndex()).toBe(1);
  });

  it('ignores typing while a modal is open', async () => {
    const { letters } = await renderGame();
    fireEvent.click(screen.getByTitle('Rules & How To Play'));
    await key(window, 'q');
    expect(letters()).toBe('...' + '.#.' + '...');
  });

  it('leaves Ctrl, Cmd, and Alt shortcuts to the browser', async () => {
    const { letters } = await renderGame();
    await key(window, 'r', { ctrlKey: true });
    await key(window, 'c', { metaKey: true });
    await key(window, 'x', { altKey: true });
    expect(letters()).toBe('...' + '.#.' + '...');
  });
});

describe('CrosswordGrid', () => {
  // In a browser, React re-renders between two key listeners, so a second listener would move the
  // selection again (jsdom can't reproduce that timing). The grid must leave keys to the app's
  // single window listener and only act when that listener calls handleKeyDown.
  it('does not handle key presses itself', () => {
    const onSelectCell = vi.fn();
    const ref = React.createRef<CrosswordGridHandle>();
    const view = render(
      <CrosswordGrid
        ref={ref}
        gridMeta={PUZZLE.grid}
        gridState={[['', '', ''], ['', '', ''], ['', '', '']]}
        selectedCell={{ row: 0, col: 0 }}
        activeEntryCells={[]}
        lockedCells={new Set()}
        isWrongEntryActive={false}
        onSelectCell={onSelectCell}
        onEnterLetter={vi.fn()}
        onBackspace={vi.fn()}
      />
    );
    const firstCell = view.container.querySelector('div.grid.w-full.h-full button')!;

    fireEvent.keyDown(firstCell, { key: 'ArrowRight' });
    expect(onSelectCell).not.toHaveBeenCalled();

    ref.current!.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(onSelectCell).toHaveBeenCalledTimes(1);
    expect(onSelectCell).toHaveBeenCalledWith(0, 1);
  });
});

describe('Submitting', () => {
  it('auto-submits once when the grid fills, not on every later keystroke', async () => {
    savedGrid = [
      ['A', 'A', 'A'],
      ['A', '', 'A'],
      ['A', 'A', ''],
    ];
    const { cells } = await renderGame();
    fireEvent.click(cells()[8]);

    await key(window, 'b');
    await waitFor(() => expect(submitCalls).toBe(1));

    await key(window, 'c');
    await key(window, 'd');
    expect(submitCalls).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitCalls).toBe(2));
  });

  it('switches to a closed state when the server says the puzzle has closed', async () => {
    const { cells, letters } = await renderGame();
    closed = true;
    fireEvent.click(cells()[0]);
    await key(window, 'a');
    await key(window, 'b');
    await key(window, 'c');
    fireEvent.click(screen.getByRole('button', { name: /Word/ }));

    await screen.findByText(/This puzzle closed before you finished/);
    const before = letters();
    await key(window, 'z');
    expect(letters()).toBe(before);
  });
});
