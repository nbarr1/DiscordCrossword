import { GAME_CONFIG } from './config.js';

export interface ScoreBreakdown {
  elapsedSeconds: number;
  penaltySeconds: number;
  totalScoreSeconds: number;
  formattedScore: string;
}

/**
 * Calculates total elapsed wall clock seconds from ISO start to ISO finish/now.
 */
export function calculateElapsedSeconds(startTimeIso: string, endTimeIso?: string | null): number {
  const start = new Date(startTimeIso).getTime();
  const end = endTimeIso ? new Date(endTimeIso).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  return Math.floor(diffMs / 1000);
}

/**
 * Computes the final total score (elapsed + penalty).
 */
export function calculateTotalScore(elapsedSeconds: number, penaltySeconds: number): number {
  return elapsedSeconds + penaltySeconds;
}

/**
 * Formats seconds into MM:SS or HH:MM:SS.
 */
export function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Evaluates penalty for a check word attempt.
 * "Penalize each distinct wrong answer for an entry only once, so re-checking the same wrong answer is free."
 */
export function evaluateCheckWordPenalty(
  entryKey: string,
  submittedWord: string,
  correctWord: string,
  existingWrongAnswers: Record<string, string[]>
): {
  isCorrect: boolean;
  penaltyAdded: number;
  isFirstTimeWrong: boolean;
  updatedWrongAnswers: Record<string, string[]>;
} {
  const cleanSubmitted = submittedWord.trim().toUpperCase();
  const cleanCorrect = correctWord.trim().toUpperCase();

  if (cleanSubmitted === cleanCorrect) {
    return {
      isCorrect: true,
      penaltyAdded: 0,
      isFirstTimeWrong: false,
      updatedWrongAnswers: existingWrongAnswers,
    };
  }

  const prevWrongs = existingWrongAnswers[entryKey] || [];
  const alreadySubmitted = prevWrongs.includes(cleanSubmitted);

  if (alreadySubmitted) {
    // Free to re-check the same wrong answer!
    return {
      isCorrect: false,
      penaltyAdded: 0,
      isFirstTimeWrong: false,
      updatedWrongAnswers: existingWrongAnswers,
    };
  }

  const updatedWrongs = {
    ...existingWrongAnswers,
    [entryKey]: [...prevWrongs, cleanSubmitted],
  };

  return {
    isCorrect: false,
    penaltyAdded: GAME_CONFIG.CHECK_WORD_PENALTY_SECONDS,
    isFirstTimeWrong: true,
    updatedWrongAnswers: updatedWrongs,
  };
}

/**
 * Tie-breaking leaderboard comparator:
 * Lower total score (elapsed + penalty) wins.
 * Ties broken by earlier finish timestamp.
 */
export function compareLeaderboardEntries(
  a: { totalScoreSeconds: number; finishTime: string },
  b: { totalScoreSeconds: number; finishTime: string }
): number {
  if (a.totalScoreSeconds !== b.totalScoreSeconds) {
    return a.totalScoreSeconds - b.totalScoreSeconds;
  }
  return new Date(a.finishTime).getTime() - new Date(b.finishTime).getTime();
}
