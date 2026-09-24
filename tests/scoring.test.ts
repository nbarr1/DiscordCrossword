import { describe, expect, it } from 'vitest';
import {
  calculateElapsedSeconds,
  calculateTotalScore,
  compareLeaderboardEntries,
  evaluateCheckWordPenalty,
  formatTime,
  GAME_CONFIG,
  LeaderboardEntry,
} from '../packages/shared/src/index.js';

describe('Scoring & Penalties', () => {
  it('computes wall-clock elapsed seconds and formatting accurately', () => {
    const start = '2026-09-24T12:00:00.000Z';
    const finish = '2026-09-24T12:04:45.000Z';
    const elapsed = calculateElapsedSeconds(start, finish);
    expect(elapsed).toBe(285);
    expect(formatTime(elapsed)).toBe('04:45');
    expect(formatTime(3665)).toBe('1:01:05');
  });

  it('calculates total score combining elapsed time and penalties', () => {
    const elapsed = 200;
    const penalties = 90;
    expect(calculateTotalScore(elapsed, penalties)).toBe(290);
  });

  it('penalizes distinct wrong answers for an entry only once', () => {
    const entryKey = '1-across';
    const correctAnswer = 'TIGER';
    let wrongAnswers: Record<string, string[]> = {};

    // 1st wrong attempt
    const res1 = evaluateCheckWordPenalty(entryKey, 'LIONS', correctAnswer, wrongAnswers);
    expect(res1.isCorrect).toBe(false);
    expect(res1.penaltyAdded).toBe(GAME_CONFIG.CHECK_WORD_PENALTY_SECONDS); // +30s
    expect(res1.isFirstTimeWrong).toBe(true);
    wrongAnswers = res1.updatedWrongAnswers;

    // 2nd wrong attempt with the SAME wrong word -> FREE!
    const res2 = evaluateCheckWordPenalty(entryKey, 'LIONS', correctAnswer, wrongAnswers);
    expect(res2.isCorrect).toBe(false);
    expect(res2.penaltyAdded).toBe(0); // 0s penalty!
    expect(res2.isFirstTimeWrong).toBe(false);

    // 3rd wrong attempt with a DIFFERENT wrong word -> +30s
    const res3 = evaluateCheckWordPenalty(entryKey, 'BEARS', correctAnswer, wrongAnswers);
    expect(res3.isCorrect).toBe(false);
    expect(res3.penaltyAdded).toBe(GAME_CONFIG.CHECK_WORD_PENALTY_SECONDS); // +30s
    expect(res3.isFirstTimeWrong).toBe(true);

    // Correct attempt -> 0s penalty, marks correct
    const res4 = evaluateCheckWordPenalty(entryKey, 'TIGER', correctAnswer, wrongAnswers);
    expect(res4.isCorrect).toBe(true);
    expect(res4.penaltyAdded).toBe(0);
  });

  it('sorts leaderboard by lowest total score and breaks ties by earlier finish time', () => {
    const entries: LeaderboardEntry[] = [
      {
        rank: 0,
        userId: 'user-3',
        username: 'alice',
        displayName: 'Alice',
        finishTime: '2026-09-24T12:30:00.000Z',
        elapsedSeconds: 300,
        penaltySeconds: 60,
        totalScoreSeconds: 360,
      },
      {
        rank: 0,
        userId: 'user-1',
        username: 'bob',
        displayName: 'Bob',
        finishTime: '2026-09-24T12:15:00.000Z', // earlier finish
        elapsedSeconds: 360,
        penaltySeconds: 0,
        totalScoreSeconds: 360,
      },
      {
        rank: 0,
        userId: 'user-2',
        username: 'charlie',
        displayName: 'Charlie',
        finishTime: '2026-09-24T12:45:00.000Z',
        elapsedSeconds: 200,
        penaltySeconds: 0,
        totalScoreSeconds: 200, // fastest
      },
    ];

    entries.sort(compareLeaderboardEntries);

    // Charlie: 200s (Rank 1)
    expect(entries[0].userId).toBe('user-2');
    // Bob: 360s, finished 12:15 (Rank 2)
    expect(entries[1].userId).toBe('user-1');
    // Alice: 360s, finished 12:30 (Rank 3)
    expect(entries[2].userId).toBe('user-3');
  });
});
