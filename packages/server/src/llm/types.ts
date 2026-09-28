export interface LlmThemeProposal {
  theme: string;
  themeDescription: string;
  seedEntries: { word: string; clueHint: string }[];
}

export interface ThemeRequest {
  /** Optional subject from the CLI (`generate --theme`). */
  topic?: string;
  /** Lengths the grid can hold; theme entries of other lengths can't be placed. */
  entryLengths: number[];
}

export interface ClueEntryInput {
  number: number;
  direction: 'across' | 'down';
  answer: string;
  length: number;
  /** For theme entries: the hint that came with the theme, so the clue fits it. */
  themeHint?: string;
}

export interface ClueVerificationItem {
  number: number;
  direction: 'across' | 'down';
  answer: string;
  clue: string;
}

export interface ClueVerificationResult {
  number: number;
  direction: 'across' | 'down';
  valid: boolean;
  reason?: string;
  replacementClue?: string;
}

export interface LlmProvider {
  /** False when the provider can't write real clues (e.g. no API key). */
  isAvailable?(): boolean;
  /** Resolves to null when no usable theme was proposed; the puzzle is then themeless. */
  proposeTheme(request: ThemeRequest): Promise<LlmThemeProposal | null>;
  /**
   * Returns clues keyed by `${number}-${direction}`. Entries without a usable clue are left out
   * (the caller retries or rejects the puzzle); request failures reject instead of returning
   * placeholder text, so a puzzle is never published with made-up clues.
   */
  generateClues(
    entries: ClueEntryInput[],
    difficulty?: 'easy' | 'medium' | 'hard'
  ): Promise<Record<string, string>>;
  /** Rejects when verification couldn't run; the caller decides whether to keep unverified clues. */
  verifyClues(items: ClueVerificationItem[]): Promise<ClueVerificationResult[]>;
}
