import React, { useEffect, useRef, useState } from 'react';
import { ClueList } from './components/ClueList.js';
import { CompletionModal } from './components/CompletionModal.js';
import { CrosswordGrid, CrosswordGridHandle } from './components/CrosswordGrid.js';
import { HeaderBar } from './components/HeaderBar.js';
import { HowToPlayModal } from './components/HowToPlayModal.js';
import { LeaderboardModal } from './components/LeaderboardModal.js';
import { ClientSession, initializeDiscordAuth } from './discord.js';
import { useGame } from './hooks/useGame.js';

export default function App() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const gridRef = useRef<CrosswordGridHandle>(null);

  useEffect(() => {
    initializeDiscordAuth()
      .then((sess) => {
        setSession(sess);
      })
      .catch((err) => {
        console.error('Discord Auth initialization error:', err);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, []);

  const game = useGame(!authLoading);

  // Latest game state for the key listener, which is registered once.
  const gameRef = useRef(game);
  gameRef.current = game;
  const modalOpen = showLeaderboard || showHelp || showCompletion;

  // The app's only keyboard listener: typing, Backspace, arrow keys, and Tab / Shift+Tab.
  // Keys are ignored while a modal is open, while a text field has focus, and when Ctrl, Cmd,
  // or Alt is held, so browser and Discord shortcuts keep working.
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        modalOpen ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
        gridRef.current?.handleKeyDown(e);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        gameRef.current.handleBackspace();
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        gameRef.current.enterLetter(e.key);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [modalOpen]);

  // Automatically show completion modal when solved
  useEffect(() => {
    if (game.isCompleted) {
      setShowCompletion((prev) => (prev ? prev : true));
    }
  }, [game.isCompleted]);

  if (authLoading || game.loading) {
    return (
      <div className="min-h-screen bg-[#1e1f22] flex flex-col items-center justify-center p-6 select-none">
        <div className="w-16 h-16 rounded-2xl bg-[#5865f2] flex items-center justify-center text-3xl shadow-xl animate-bounce mb-4">
          📰
        </div>
        <h1 className="text-xl font-bold text-white tracking-wide">Daily Crossword</h1>
        <p className="text-sm text-[#949ba4] mt-1">Connecting to Discord & Loading Today’s Puzzle...</p>
        <div className="w-48 h-1.5 bg-[#2b2d31] rounded-full overflow-hidden mt-6">
          <div className="h-full bg-[#5865f2] w-2/3 animate-pulse rounded-full"></div>
        </div>
      </div>
    );
  }

  if (game.error || !game.puzzle) {
    return (
      <div className="min-h-screen bg-[#1e1f22] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="text-lg font-bold text-white">Unable to Load Daily Crossword</h2>
        <p className="text-sm text-[#949ba4] max-w-sm mt-1 mb-4">
          {game.error || 'The daily puzzle could not be loaded.'}
        </p>
        <button
          onClick={() => {
            initializeDiscordAuth()
              .then((sess) => {
                setSession(sess);
                game.reload();
              })
              .catch(() => {
                game.reload();
              });
          }}
          className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold transition-all shadow"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const isWrongEntryActive = game.activeClueInfo
    ? game.wrongEntries.has(`${game.activeClueInfo.number}-${game.direction}`)
    : false;

  return (
    <div className="min-h-screen bg-[#1e1f22] text-[#dbdee1] flex flex-col font-sans overflow-x-hidden">
      {/* Top Header */}
      <HeaderBar
        session={session}
        puzzleTitle={game.puzzle.title}
        puzzleDate={game.puzzle.date}
        elapsedSeconds={game.elapsedSeconds}
        penaltySeconds={game.penaltySeconds}
        totalScoreSeconds={game.totalScoreSeconds}
        isCompleted={game.isCompleted}
        isClosed={game.isClosed}
        isActiveEntryFull={game.isActiveEntryFull}
        isGridFull={game.isGridFull}
        onCheckWord={game.checkWord}
        onRevealLetter={game.revealLetter}
        onSubmit={game.submitGrid}
        onOpenLeaderboard={() => setShowLeaderboard(true)}
        onOpenHelp={() => setShowHelp(true)}
      />

      {game.isClosed && (
        <div
          role="status"
          className="bg-[#f0b232]/15 border-b border-[#f0b232]/40 px-4 py-2.5 flex flex-wrap items-center justify-center gap-3 text-sm text-[#f2f3f5]"
        >
          <span>
            {game.isCompleted
              ? 'This puzzle has closed. A new crossword is out.'
              : 'This puzzle closed before you finished. A new crossword is out.'}
          </span>
          <button
            onClick={() => {
              setShowCompletion(false);
              game.reload();
            }}
            className="px-3 py-1 rounded-md bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold"
          >
            Load Today’s Puzzle
          </button>
        </div>
      )}

      {/* Floating Toast notification */}
      {game.toastMessage && (
        <div className={`fixed ${game.isClosed ? 'top-28' : 'top-16'} left-1/2 -translate-x-1/2 z-50 bg-[#2b2d31] text-white border border-[#383a40] px-4 py-2 rounded-xl shadow-xl text-xs font-semibold animate-in fade-in slide-in-from-top-2 flex items-center gap-2`}>
          <span>{game.toastMessage}</span>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row p-3 md:p-5 gap-4 max-w-[1440px] w-full mx-auto overflow-hidden">
        {/* Left / Top: Crossword Grid */}
        <div className="flex-1 flex flex-col items-center justify-start shrink-0">
          <CrosswordGrid
            ref={gridRef}
            gridMeta={game.puzzle.grid}
            gridState={game.gridState}
            solution={game.solution}
            selectedCell={game.selectedCell}
            activeEntryCells={game.activeEntryCells}
            lockedCells={game.lockedCells}
            isWrongEntryActive={isWrongEntryActive}
            onSelectCell={game.selectCell}
            onEnterLetter={game.enterLetter}
            onBackspace={game.handleBackspace}
            onNextClue={game.moveToNextClue}
            onPrevClue={game.moveToPrevClue}
          />
        </div>

        {/* Right / Bottom: Clue Lists */}
        <div className="flex-1 min-h-[360px] lg:min-h-[540px] flex flex-col">
          <ClueList
            acrossClues={game.puzzle.clues.across}
            downClues={game.puzzle.clues.down}
            activeClue={game.activeClueInfo}
            activeDirection={game.direction}
            wrongEntries={game.wrongEntries}
            onSelectClue={game.jumpToClue}
          />
        </div>
      </main>

      {/* Modals */}
      <LeaderboardModal
        isOpen={showLeaderboard}
        onClose={() => setShowLeaderboard(false)}
        guildId={session?.guildId || null}
      />

      <HowToPlayModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
      />

      <CompletionModal
        isOpen={showCompletion}
        onClose={() => setShowCompletion(false)}
        onOpenLeaderboard={() => setShowLeaderboard(true)}
        puzzleDate={game.puzzle.date}
        elapsedSeconds={game.elapsedSeconds}
        penaltySeconds={game.penaltySeconds}
        totalScoreSeconds={game.totalScoreSeconds}
      />
    </div>
  );
}
