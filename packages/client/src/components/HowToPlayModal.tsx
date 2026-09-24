import { Clock, HelpCircle, KeyRound, ShieldAlert, Sparkles, Trophy, X } from 'lucide-react';
import React from 'react';

interface HowToPlayModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="bg-[#2b2d31] w-full max-w-lg rounded-2xl border border-[#383a40] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-[#1e1f22] px-5 py-4 border-b border-[#1f2023] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HelpCircle className="w-5 h-5 text-[#5865f2]" />
            <h2 className="text-lg font-bold text-white">How to Play Daily Crossword</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#949ba4] hover:text-white hover:bg-[#313338] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-sm text-[#dbdee1]">
          {/* Rule 1: Daily Puzzle */}
          <div className="flex gap-3 items-start">
            <div className="p-2 rounded-lg bg-[#5865f2]/10 text-[#5865f2] shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white">One Daily Puzzle (24h Window)</h3>
              <p className="text-xs text-[#949ba4] mt-0.5">
                A new crossword drops daily at <strong>00:00 UTC</strong>. The puzzle is open for 24 hours of ranked play.
              </p>
            </div>
          </div>

          {/* Rule 2: Wall Clock */}
          <div className="flex gap-3 items-start">
            <div className="p-2 rounded-lg bg-[#f0b232]/10 text-[#f0b232] shrink-0">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white">Wall Clock Timer</h3>
              <p className="text-xs text-[#949ba4] mt-0.5">
                Your official timer starts the moment you first open the day’s puzzle and runs continuously in real time. Closing Discord does not pause your timer.
              </p>
            </div>
          </div>

          {/* Rule 3: Check Word Penalty */}
          <div className="flex gap-3 items-start">
            <div className="p-2 rounded-lg bg-[#5865f2]/10 text-[#5865f2] shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white">Check Word (+30s penalty)</h3>
              <p className="text-xs text-[#949ba4] mt-0.5">
                When an active entry is full, click Check Word. If correct, its cells lock in place. If wrong, 30 seconds are added. Re-checking the <em>same</em> incorrect guess is free!
              </p>
            </div>
          </div>

          {/* Rule 4: Reveal Letter */}
          <div className="flex gap-3 items-start">
            <div className="p-2 rounded-lg bg-[#e0a82e]/10 text-[#e0a82e] shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white">Reveal Letter (+60s penalty)</h3>
              <p className="text-xs text-[#949ba4] mt-0.5">
                Stuck on a tricky crossing? Reveal the selected square for a 60-second penalty. The letter is permanently locked in.
              </p>
            </div>
          </div>

          {/* Rule 5: Auto Submission */}
          <div className="flex gap-3 items-start">
            <div className="p-2 rounded-lg bg-[#f23f43]/10 text-[#f23f43] shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white">Automatic Submission (+30s if wrong)</h3>
              <p className="text-xs text-[#949ba4] mt-0.5">
                As soon as every square is filled, your grid is verified automatically. If 100% correct, your attempt finishes! If any letters are incorrect, a 30-second penalty is added.
              </p>
            </div>
          </div>

          {/* Rule 6: Navigation */}
          <div className="bg-[#1e1f22] p-3 rounded-xl border border-[#313338] text-xs space-y-1">
            <p className="font-semibold text-white">Keyboard & Touch Shortcuts:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-[#949ba4]">
              <li>Click selected cell again to toggle direction (Across / Down)</li>
              <li>Use arrow keys to navigate the grid</li>
              <li>Press <strong>Tab</strong> / <strong>Shift+Tab</strong> to jump between clues</li>
              <li>Backspace clears letters and moves backward</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#1e1f22] px-5 py-3 border-t border-[#1f2023] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-bold transition-all shadow"
          >
            Got It, Let’s Solve!
          </button>
        </div>
      </div>
    </div>
  );
};
