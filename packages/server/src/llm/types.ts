export interface LlmThemeProposal {
  theme: string;
  themeDescription: string;
  seedEntries: { word: string; clueHint: string }[];
}

export interface ClueEntryInput {
  number: number;
  direction: 'across' | 'down';
  answer: string;
  length: number;
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
  proposeTheme(topic?: string): Promise<LlmThemeProposal | null>;
  generateClues(
    entries: ClueEntryInput[],
    difficulty?: 'easy' | 'medium' | 'hard'
  ): Promise<Record<string, string>>;
  verifyClues(items: ClueVerificationItem[]): Promise<ClueVerificationResult[]>;
}
