import { formatTime, LeaderboardEntry } from '@crossword/shared';
import { Award, Medal, Trophy, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../discord.js';

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  guildId: string | null;
}

export const LeaderboardModal: React.FC<LeaderboardModalProps> = ({ isOpen, onClose, guildId }) => {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);

    apiFetch<{ leaderboard: LeaderboardEntry[]; message?: string }>('/api/leaderboard')
      .then((data) => {
        if (!isMounted) return;
        setEntries(data.leaderboard || []);
        setMessage(data.message || null);
      })
      .catch((err) => {
        if (!isMounted) return;
        setMessage('Failed to load leaderboard data.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs animate-in fade-in select-none">
      <div className="bg-[#2b2d31] w-full max-w-md rounded-2xl border border-[#383a40] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-[#1e1f22] px-5 py-4 border-b border-[#1f2023] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-[#f0b232]" />
            <h2 className="text-lg font-bold text-white">Daily Server Standings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#949ba4] hover:text-white hover:bg-[#313338] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {guildId ? (
            <p className="text-xs text-[#949ba4]">
              Rankings for today’s puzzle. Ties broken by earliest completion timestamp.
            </p>
          ) : (
            <div className="bg-[#5865f2]/10 border border-[#5865f2]/30 p-3 rounded-lg text-xs text-[#dbdee1]">
              ℹ️ <strong>Note:</strong> You are currently playing in DMs. To appear on a server leaderboard, launch the Activity inside a Discord server text channel.
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-3 border-[#5865f2] border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-[#949ba4]">Loading standings...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#949ba4]">
              No solvers have completed today’s puzzle yet in this server.
            </div>
          ) : (
            <div className="space-y-1.5">
              {entries.map((entry, idx) => {
                const isFirst = idx === 0;
                const isSecond = idx === 1;
                const isThird = idx === 2;

                return (
                  <div
                    key={entry.userId}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      isFirst
                        ? 'bg-[#f0b232]/10 border-[#f0b232]/40 text-white'
                        : 'bg-[#1e1f22] border-[#2b2d31] text-[#dbdee1]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 text-center font-bold font-mono">
                        {isFirst ? '🥇' : isSecond ? '🥈' : isThird ? '🥉' : `#${entry.rank}`}
                      </span>

                      {entry.avatarUrl ? (
                        <img
                          src={entry.avatarUrl}
                          alt={entry.displayName}
                          className="w-8 h-8 rounded-full bg-[#313338]"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#5865f2] flex items-center justify-center font-bold text-xs text-white">
                          {entry.displayName[0]?.toUpperCase()}
                        </div>
                      )}

                      <div className="flex flex-col">
                        <span className="font-semibold text-sm leading-tight text-white">
                          {entry.displayName}
                        </span>
                        <span className="text-[11px] text-[#949ba4]">@{entry.username}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className="font-mono font-bold text-sm text-white">
                        {formatTime(entry.totalScoreSeconds)}
                      </span>
                      {entry.penaltySeconds > 0 && (
                        <span className="text-[10px] font-mono text-[#f23f43]">
                          +{entry.penaltySeconds}s pen
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
