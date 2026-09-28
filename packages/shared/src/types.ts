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
  solution: string[][]; // height x width uppercase chars, '#' for black cells
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
  gridState: string[][]; // height x width player letters or empty string ''
  lockedCells: { row: number; col: number }[]; // Correct cells checked or revealed
  wrongAnswersPerEntry: Record<string, string[]>; // entryKey (e.g. '1-across') -> distinct wrong attempts
}

/**
 * Every attempt request names the puzzle it was made against. When that puzzle is no longer the
 * live one, the server answers 409 with `code: 'PUZZLE_CLOSED'` instead of applying the action to
 * the new day's puzzle.
 */
export interface AttemptRequestBase {
  puzzleId: string;
}

export type ApiErrorCode = 'PUZZLE_CLOSED' | 'ATTEMPT_FINISHED' | 'ATTEMPT_NOT_FOUND' | 'INVALID_GRID';

export interface ApiErrorResponse {
  error: string;
  code?: ApiErrorCode;
}

export interface CheckWordRequest extends AttemptRequestBase {
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

export interface RevealLetterRequest extends AttemptRequestBase {
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

export interface SubmitGridRequest extends AttemptRequestBase {
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

export interface SaveProgressRequest extends AttemptRequestBase {
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
