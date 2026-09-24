import { formatTime } from '@crossword/shared';
import { Award, CheckCircle2, Copy, Trophy, X } from 'lucide-react';
import React, { useState } from 'react';

interface CompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenLeaderboard: () => void;
  puzzleDate: string;
  elapsedSeconds: number;
  penaltySeconds: number;
  totalScoreSeconds: number;
}

export const CompletionModal: React.FC<CompletionModalProps> = ({
  isOpen,
  onClose,
  onOpenLeaderboard,
  puzzleDate,
  elapsedSeconds,
  penaltySeconds,
  totalScoreSeconds,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleShare = () => {
    const text = `📰 Discord Daily Crossword (${puzzleDate})\n⏱️ Final Score: ${formatTime(totalScoreSeconds)}${
      penaltySeconds > 0 ? ` (+${penaltySeconds}s penalties)` : ' (Flawless Solve!)'
    }\nPlay today's puzzle in Discord!`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs select-none animate-in fade-in zoom-in-95">
      <div className="bg-[#2b2d31] w-full max-w-md rounded-2xl border border-[#383a40] shadow-2xl overflow-hidden flex flex-col text-center">
        {/* Banner */}
        <div className="bg-linear-to-b from-[#5865f2] to-[#4752c4] p-6 text-white flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-3 shadow-inner">
            <Trophy className="w-9 h-9 text-[#ffeaa7]" />
          </div>
          <h2 className="text-2xl font-black">Puzzle Completed!</h2>
          <p className="text-xs text-white/80 mt-1">
            You solved the 15x15 daily crossword for {puzzleDate}
          </p>
        </div>

        {/* Stats Breakdown */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 bg-[#1e1f22] p-4 rounded-xl border border-[#313338]">
            <div className="flex flex-col items-center border-r border-[#313338] pr-2">
              <span className="text-xs text-[#949ba4] uppercase font-bold">Elapsed Time</span>
              <span className="text-xl font-bold font-mono text-white mt-1">
                {formatTime(elapsedSeconds)}
              </span>
            </div>
            <div className="flex flex-col items-center pl-2">
              <span className="text-xs text-[#949ba4] uppercase font-bold">Penalties</span>
              <span className="text-xl font-bold font-mono text-[#f23f43] mt-1">
                +{penaltySeconds}s
              </span>
            </div>
          </div>

          <div className="bg-[#5865f2]/10 border border-[#5865f2]/30 p-3 rounded-xl">
            <span className="text-xs text-[#dbdee1] uppercase tracking-wider font-semibold">
              Official Leaderboard Time
            </span>
            <div className="text-3xl font-black font-mono text-white mt-0.5">
              {formatTime(totalScoreSeconds)}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={handleShare}
              className="w-full py-2.5 px-4 rounded-xl bg-[#23a55a] hover:bg-[#1f9250] text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow active:scale-98"
            >
              {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Score Copied to Clipboard!' : 'Share Spoiler-Free Score'}</span>
            </button>

            <button
              onClick={() => {
                onClose();
                onOpenLeaderboard();
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-[#313338] hover:bg-[#383a40] text-white font-bold text-sm flex items-center justify-center gap-2 transition-all border border-[#3f4147]"
            >
              <Award className="w-4 h-4 text-[#f0b232]" />
              <span>View Server Leaderboard</span>
            </button>

            <button
              onClick={onClose}
              className="py-2 text-xs text-[#949ba4] hover:text-white transition-colors mt-1"
            >
              Close and Review Completed Grid
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
