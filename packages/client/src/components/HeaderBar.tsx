import { formatTime } from '@crossword/shared';
import { Award, Clock, HelpCircle, KeyRound, ShieldAlert, Sparkles } from 'lucide-react';
import React from 'react';
import { ClientSession } from '../discord.js';

interface HeaderBarProps {
  session: ClientSession | null;
  puzzleTitle: string;
  puzzleDate: string;
  elapsedSeconds: number;
  penaltySeconds: number;
  totalScoreSeconds: number;
  isCompleted: boolean;
  isActiveEntryFull: boolean;
  onCheckWord: () => void;
  onRevealLetter: () => void;
  onOpenLeaderboard: () => void;
  onOpenHelp: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  session,
  puzzleTitle,
  puzzleDate,
  elapsedSeconds,
  penaltySeconds,
  totalScoreSeconds,
  isCompleted,
  isActiveEntryFull,
  onCheckWord,
  onRevealLetter,
  onOpenLeaderboard,
  onOpenHelp,
}) => {
  return (
    <header className="bg-[#2b2d31] border-b border-[#1f2023] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-md select-none">
      {/* Left: Brand & Puzzle info */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#5865f2] flex items-center justify-center font-black text-xl text-white shadow-inner">
          📰
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-base md:text-lg text-white leading-tight">
              {puzzleTitle || 'Daily Crossword'}
            </h1>
            <span className="text-xs px-2 py-0.5 rounded bg-[#1e1f22] text-[#949ba4] font-medium">
              {puzzleDate}
            </span>
          </div>
          <div className="text-xs text-[#949ba4] flex items-center gap-1.5 mt-0.5">
            {session?.guildId ? (
              <span className="flex items-center gap-1 text-[#5865f2]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#23a55a]"></span> Server Ranked Play
              </span>
            ) : (
              <span className="text-[#dbdee1]">Unranked DM Practice</span>
            )}
            <span>•</span>
            <span>{session?.user.displayName || 'Player'}</span>
          </div>
        </div>
      </div>

      {/* Center: Live wall-clock Timer & Score */}
      <div className="flex items-center gap-3 bg-[#1e1f22] px-3.5 py-1.5 rounded-lg border border-[#313338]">
        <Clock className={`w-4 h-4 ${isCompleted ? 'text-[#23a55a]' : 'text-[#f0b232] animate-pulse'}`} />
        <div className="flex flex-col items-center">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono font-bold text-lg text-white">
              {formatTime(isCompleted ? totalScoreSeconds : elapsedSeconds)}
            </span>
            {penaltySeconds > 0 && (
              <span className="text-xs font-mono font-semibold text-[#f23f43] bg-[#f23f43]/10 px-1.5 py-0.5 rounded">
                +{penaltySeconds}s
              </span>
            )}
          </div>
          <span className="text-[10px] text-[#949ba4] uppercase tracking-wider font-semibold">
            {isCompleted ? 'Final Time' : 'Wall Clock'}
          </span>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onCheckWord}
          disabled={!isActiveEntryFull || isCompleted}
          title={isActiveEntryFull ? 'Check active word (+30s penalty if incorrect)' : 'Fill the active word to check'}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all shadow-sm ${
            isActiveEntryFull && !isCompleted
              ? 'bg-[#5865f2] hover:bg-[#4752c4] text-white active:scale-95'
              : 'bg-[#313338] text-[#80848e] cursor-not-allowed opacity-60'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Check</span> Word
        </button>

        <button
          onClick={onRevealLetter}
          disabled={isCompleted}
          title="Reveal selected letter (+60s penalty)"
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            !isCompleted
              ? 'bg-[#e0a82e] hover:bg-[#c99525] text-black active:scale-95'
              : 'bg-[#313338] text-[#80848e] cursor-not-allowed opacity-60'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Reveal</span> (+60s)
        </button>

        <button
          onClick={onOpenLeaderboard}
          title="View Server Leaderboard"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#313338] hover:bg-[#383a40] text-[#dbdee1] hover:text-white transition-all border border-[#3f4147]"
        >
          <Award className="w-3.5 h-3.5 text-[#f0b232]" />
          <span className="hidden md:inline">Leaderboard</span>
        </button>

        <button
          onClick={onOpenHelp}
          title="Rules & How To Play"
          className="p-1.5 rounded-md text-[#949ba4] hover:text-white hover:bg-[#313338] transition-all"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
