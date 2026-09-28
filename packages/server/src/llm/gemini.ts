import { GAME_CONFIG } from '@crossword/shared';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { clueRevealsAnswer } from './clueQuality.js';
import {
  ClueEntryInput,
  ClueVerificationItem,
  ClueVerificationResult,
  LlmProvider,
  LlmThemeProposal,
  ThemeRequest,
} from './types.js';

const ThemeResponseSchema = z.object({
  theme: z.string(),
  themeDescription: z.string(),
  seedEntries: z.array(
    z.object({
      word: z.string(),
      clueHint: z.string(),
    })
  ),
});

const CluesResponseSchema = z.record(z.string(), z.string());

const ClueVerificationSchema = z.array(
  z.object({
    number: z.number(),
    direction: z.enum(['across', 'down']),
    valid: z.boolean(),
    reason: z.string().optional(),
    replacementClue: z.string().optional(),
  })
);

export class GeminiLlmProvider implements LlmProvider {
  private client: GoogleGenAI | null = null;
  private modelName: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    this.modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  public isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Sends a prompt that must answer in JSON and returns the parsed value. Rejects on request
   * errors, on timeouts, and on responses that aren't JSON.
   */
  private async requestJson(prompt: string): Promise<unknown> {
    if (!this.client) {
      throw new Error('Gemini is not configured (set GEMINI_API_KEY)');
    }
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        // Without a deadline, one hung request would hold up puzzle generation indefinitely.
        abortSignal: AbortSignal.timeout(GAME_CONFIG.LLM_REQUEST_TIMEOUT_MS),
      },
    });
    if (!response.text) {
      throw new Error(`Gemini (${this.modelName}) returned an empty response`);
    }
    return JSON.parse(response.text);
  }

  public async proposeTheme({ topic, entryLengths }: ThemeRequest): Promise<LlmThemeProposal | null> {
    if (!this.client || entryLengths.length === 0) return null;

    try {
      const prompt = `You are an expert crossword constructor.
Propose a clever, delightful theme for a daily ${GAME_CONFIG.GRID_WIDTH}x${GAME_CONFIG.GRID_HEIGHT} crossword.
${topic ? `Requested subject or idea: ${topic}` : ''}
Provide 3 to 4 theme entries. Each entry must be written with only the letters A-Z (no spaces or punctuation),
and its letter count must be one of: ${entryLengths.join(', ')}. Count the letters carefully.
Respond strictly in JSON matching this schema:
{
  "theme": "Theme Title",
  "themeDescription": "Explanation of the wordplay or unifying motif",
  "seedEntries": [
    { "word": "STARGAZE", "clueHint": "Look up at night" }
  ]
}`;
      return ThemeResponseSchema.parse(await this.requestJson(prompt));
    } catch (err) {
      console.warn('[GeminiLLM] Failed to propose theme:', err);
      return null;
    }
  }

  public async generateClues(
    entries: ClueEntryInput[],
    difficulty: 'easy' | 'medium' | 'hard' = 'medium'
  ): Promise<Record<string, string>> {
    const entryListText = entries
      .map(
        (e) =>
          `${e.number}-${e.direction}: ${e.answer} (${e.length} letters)` +
          (e.themeHint ? ` [theme entry; hint: ${e.themeHint}]` : '')
      )
      .join('\n');

    const prompt = `You are a premier crossword constructor for a national publication.
Generate witty, accurate, concise crossword clues for the following answers at difficulty level: ${difficulty}.
CRITICAL RULES:
1. DO NOT include the answer word itself or any derivative of it in the clue text!
2. Keep clues punchy (typically 3-10 words).
3. Follow standard conventions (e.g., question mark for wordplay, "Abbr." for abbreviations).
4. Answers with several words are written without spaces; clue the whole phrase.
5. Return a valid JSON object mapping the key (e.g. "1-across") to its clue string.

Entries to clue:
${entryListText}`;

    const validated = CluesResponseSchema.parse(await this.requestJson(prompt));

    // Keep only usable clues; the pipeline retries or rejects the puzzle for anything missing.
    const result: Record<string, string> = {};
    for (const entry of entries) {
      const key = `${entry.number}-${entry.direction}`;
      const clue = (validated[key] || validated[`${entry.number}${entry.direction}`] || '').trim();
      if (clue && !clueRevealsAnswer(clue, entry.answer)) {
        result[key] = clue;
      }
    }
    return result;
  }

  public async verifyClues(items: ClueVerificationItem[]): Promise<ClueVerificationResult[]> {
    const itemsText = JSON.stringify(items, null, 2);
    const prompt = `You are an editorial quality checker for crosswords.
Review each clue against its answer.
Flag a clue as invalid (valid: false) IF AND ONLY IF:
1. The clue directly gives away or contains the answer word (or obvious stem).
2. The clue is factually wrong or nonsensical.
If invalid, supply a superior "replacementClue".

Respond strictly as a JSON array matching:
[
  { "number": 1, "direction": "across", "valid": true },
  { "number": 5, "direction": "down", "valid": false, "reason": "Contains answer", "replacementClue": "Better clue here" }
]

Items:
${itemsText}`;

    return ClueVerificationSchema.parse(await this.requestJson(prompt));
  }
}

export const defaultLlmProvider = new GeminiLlmProvider();
