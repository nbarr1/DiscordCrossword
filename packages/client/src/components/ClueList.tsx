import { ClueInfo, Direction } from '@crossword/shared';
import React, { useEffect, useRef, useState } from 'react';

interface ClueListProps {
  acrossClues: ClueInfo[];
  downClues: ClueInfo[];
  activeClue: ClueInfo | null;
  activeDirection: Direction;
  wrongEntries: Set<string>;
  onSelectClue: (clue: ClueInfo) => void;
}

export const ClueList: React.FC<ClueListProps> = ({
  acrossClues,
  downClues,
  activeClue,
  activeDirection,
  wrongEntries,
  onSelectClue,
}) => {
  const [prevActiveDirection, setPrevActiveDirection] = useState(activeDirection);
  const [mobileTab, setMobileTab] = useState<Direction>(activeDirection);
  const activeClueRef = useRef<HTMLLIElement | null>(null);

  // Sync mobile tab with active direction changes during render
  if (prevActiveDirection !== activeDirection) {
    setPrevActiveDirection(activeDirection);
    setMobileTab(activeDirection);
  }

  // Scroll active clue into view
  useEffect(() => {
    if (activeClueRef.current) {
      activeClueRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeClue]);

  const renderClueItem = (clue: ClueInfo) => {
    const isCurrent = activeClue?.number === clue.number && activeClue?.direction === clue.direction;
    const isWrong = wrongEntries.has(`${clue.number}-${clue.direction}`);

    return (
      <li
        key={`${clue.direction}-${clue.number}`}
        ref={isCurrent ? activeClueRef : null}
        onClick={() => onSelectClue(clue)}
        className={`px-3 py-2 rounded-lg cursor-pointer text-xs md:text-sm transition-all flex items-start gap-2.5 ${
          isCurrent
            ? 'bg-[#5865f2] text-white font-medium shadow-md'
            : isWrong
            ? 'bg-[#f23f43]/15 text-[#ff7675] hover:bg-[#f23f43]/25'
            : 'hover:bg-[#35373c] text-[#dbdee1]'
        }`}
      >
        <span
          className={`font-mono font-bold shrink-0 ${
            isCurrent ? 'text-[#ffeaa7]' : 'text-[#949ba4]'
          }`}
        >
          {clue.number}.
        </span>
        <span className="leading-snug flex-1">{clue.text}</span>
      </li>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#2b2d31] rounded-xl border border-[#1f2023] overflow-hidden shadow-lg">
      {/* Active Clue Banner */}
      <div className="bg-[#1e1f22] p-3 border-b border-[#1f2023] flex items-center gap-3">
        <span className="px-2 py-0.5 rounded bg-[#5865f2] text-white font-bold text-xs uppercase tracking-wider shrink-0">
          {activeClue ? `${activeClue.number} ${activeClue.direction}` : 'Select Cell'}
        </span>
        <p className="text-sm font-semibold text-white truncate">
          {activeClue?.text || 'Click any white square to begin solving'}
        </p>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden border-b border-[#1f2023] bg-[#232428]">
        <button
          onClick={() => setMobileTab('across')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
            mobileTab === 'across'
              ? 'text-white border-b-2 border-[#5865f2] bg-[#2b2d31]'
              : 'text-[#949ba4] hover:text-white'
          }`}
        >
          Across ({acrossClues.length})
        </button>
        <button
          onClick={() => setMobileTab('down')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
            mobileTab === 'down'
              ? 'text-white border-b-2 border-[#5865f2] bg-[#2b2d31]'
              : 'text-[#949ba4] hover:text-white'
          }`}
        >
          Down ({downClues.length})
        </button>
      </div>

      {/* Desktop Side-by-side or Mobile Tabbed Clue Lists */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#1f2023] overflow-hidden">
        {/* Across Section */}
        <div
          className={`flex-col h-full overflow-hidden ${
            mobileTab === 'across' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <div className="px-3 py-2 bg-[#232428] font-bold text-xs text-[#949ba4] uppercase tracking-wider flex items-center justify-between">
            <span>Across</span>
            <span className="text-[10px] bg-[#313338] px-1.5 py-0.5 rounded">{acrossClues.length}</span>
          </div>
          <ul className="flex-1 overflow-y-auto p-2 space-y-1">
            {acrossClues.map(renderClueItem)}
          </ul>
        </div>

        {/* Down Section */}
        <div
          className={`flex-col h-full overflow-hidden ${
            mobileTab === 'down' ? 'flex' : 'hidden md:flex'
          }`}
        >
          <div className="px-3 py-2 bg-[#232428] font-bold text-xs text-[#949ba4] uppercase tracking-wider flex items-center justify-between">
            <span>Down</span>
            <span className="text-[10px] bg-[#313338] px-1.5 py-0.5 rounded">{downClues.length}</span>
          </div>
          <ul className="flex-1 overflow-y-auto p-2 space-y-1">
            {downClues.map(renderClueItem)}
          </ul>
        </div>
      </div>
    </div>
  );
};
