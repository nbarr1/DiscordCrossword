/**
 * Shared crossword data types and interfaces.
 */

export type Direction = 'across' | 'down';

export interface GridCellMeta {
  number: number | null;
  isBlack: boolean;
}

export interface ClueInfo {
  number: number;
  direction: Direction;
  text: string;
  row: number;
  col: number;
  length: number;
}

export interface ClueWithAnswer extends ClueInfo {
  answer: string;
}

export interface ClientPuzzlePayload {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  author: string;
  theme?: string;
  width: number;
  height: number;
  grid: GridCellMeta[][];
  clues: {
    across: ClueInfo[];
    down: ClueInfo[];
  };
  expiresAt: string;
  isClosed: boolean;
  // Answers MUST NOT be present in this payload for an active, unfinished attempt!
}

export interface FullPuzzleData extends ClientPuzzlePayload {
  solution: string[][]; // 15x15 uppercase chars, '#' for black cells
  cluesWithAnswers: {
    across: ClueWithAnswer[];
    down: ClueWithAnswer[];
  };
  status: 'buffered' | 'published' | 'archived';
  createdAt: string;
}

export interface AttemptState {
  id: string;
  puzzleId: string;
  userId: string;
  guildId: string | null;
  startTime: string; // ISO 8601
  finishTime: string | null; // ISO 8601 when completed
  elapsedSeconds: number; // Wall clock seconds
  penaltySeconds: number; // Accumulated penalty
  totalScoreSeconds: number; // elapsed + penalty
  isCompleted: boolean;
  gridState: string[][]; // 15x15 player letters or empty string ''
  lockedCells: { row: number; col: number }[]; // Correct cells checked or revealed
  wrongAnswersPerEntry: Record<string, string[]>; // entryKey (e.g. '1-across') -> distinct wrong attempts
}

export interface CheckWordRequest {
  entryNumber: number;
  direction: Direction;
  word: string;
}

export interface CheckWordResponse {
  correct: boolean;
  entryKey: string;
  lockedCells?: { row: number; col: number }[];
  penaltyAdded: number;
  totalPenaltySeconds: number;
  isFirstTimeWrong?: boolean;
}

export interface RevealLetterRequest {
  row: number;
  col: number;
}

export interface RevealLetterResponse {
  row: number;
  col: number;
  letter: string;
  penaltyAdded: number;
  totalPenaltySeconds: number;
}

export interface SubmitGridRequest {
  gridState: string[][];
}

export interface SubmitGridResponse {
  success: boolean;
  penaltyAdded: number;
  totalPenaltySeconds: number;
  finishTime?: string;
  totalScoreSeconds?: number;
  message?: string;
  solution?: string[][]; // Included only if completed successfully
}

export interface SaveProgressRequest {
  gridState: string[][];
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  finishTime: string;
  elapsedSeconds: number;
  penaltySeconds: number;
  totalScoreSeconds: number;
}

export interface AuthSessionResponse {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
  };
  guildId: string | null;
}
