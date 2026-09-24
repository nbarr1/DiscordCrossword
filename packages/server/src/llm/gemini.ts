import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import {
  ClueEntryInput,
  ClueVerificationItem,
  ClueVerificationResult,
  LlmProvider,
  LlmThemeProposal,
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

  public async proposeTheme(topic?: string): Promise<LlmThemeProposal | null> {
    if (!this.client) return null;

    try {
      const prompt = `You are an expert crossword constructor.
Propose a clever, delightful daily 15x15 crossword theme.
${topic ? `Requested subject or idea: ${topic}` : ''}
Provide 3 to 4 theme seed entries that could be symmetrical across answers in a 15x15 grid.
Each word must only contain letters A-Z (no spaces, 3 to 15 characters).
Respond strictly in JSON matching this schema:
{
  "theme": "Theme Title",
  "themeDescription": "Explanation of the wordplay or unifying motif",
  "seedEntries": [
    { "word": "SOLARSYSTEM", "clueHint": "Our celestial neighborhood" },
    { "word": "STARGAZING", "clueHint": "Nighttime astronomical pastime" }
  ]
}`;

      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      return ThemeResponseSchema.parse(parsed);
    } catch (err) {
      console.warn('[GeminiLLM] Failed to propose theme:', err);
      return null;
    }
  }

  public async generateClues(
    entries: ClueEntryInput[],
    difficulty: 'easy' | 'medium' | 'hard' = 'medium'
  ): Promise<Record<string, string>> {
    if (!this.client) {
      return this.fallbackClues(entries);
    }

    try {
      const entryListText = entries
        .map((e) => `${e.number}-${e.direction}: ${e.answer} (${e.length} letters)`)
        .join('\n');

      const prompt = `You are a premier crossword constructor for a national publication.
Generate witty, accurate, concise crossword clues for the following answers at difficulty level: ${difficulty}.
CRITICAL RULES:
1. DO NOT include the answer word itself or any derivative of it in the clue text!
2. Keep clues punchy (typically 3-10 words).
3. Follow standard conventions (e.g., question mark for wordplay, "Abbr." for abbreviations).
4. Return a valid JSON object mapping the key (e.g. "1-across") to its clue string.

Entries to clue:
${entryListText}`;

      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text || '{}';
      const parsed = JSON.parse(text);
      const validated = CluesResponseSchema.parse(parsed);

      // Ensure every entry has a clue and filter out self-containing answers
      const result: Record<string, string> = {};
      for (const entry of entries) {
        const key = `${entry.number}-${entry.direction}`;
        let clue = validated[key] || validated[`${entry.number}${entry.direction}`];

        if (!clue || this.containsAnswer(clue, entry.answer)) {
          clue = this.generateFallbackClue(entry.answer);
        }
        result[key] = clue;
      }

      return result;
    } catch (err) {
      console.warn('[GeminiLLM] Failed to generate clues via LLM, using fallback:', err);
      return this.fallbackClues(entries);
    }
  }

  public async verifyClues(items: ClueVerificationItem[]): Promise<ClueVerificationResult[]> {
    if (!this.client) {
      return items.map((i) => ({
        number: i.number,
        direction: i.direction,
        valid: !this.containsAnswer(i.clue, i.answer),
      }));
    }

    try {
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

      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text || '[]';
      const parsed = JSON.parse(text);
      return ClueVerificationSchema.parse(parsed);
    } catch (err) {
      console.warn('[GeminiLLM] Failed to verify clues via LLM:', err);
      return items.map((i) => ({
        number: i.number,
        direction: i.direction,
        valid: !this.containsAnswer(i.clue, i.answer),
      }));
    }
  }

  private containsAnswer(clue: string, answer: string): boolean {
    const cleanClue = clue.toUpperCase().replace(/[^A-Z]/g, ' ');
    const cleanAns = answer.toUpperCase().replace(/[^A-Z]/g, '');
    if (cleanAns.length < 3) return false;
    const words = cleanClue.split(/\s+/);
    return words.includes(cleanAns) || cleanClue.includes(cleanAns);
  }

  private generateFallbackClue(answer: string): string {
    const hints: Record<string, string> = {
      ACE: 'Top playing card or tennis serve',
      CAT: 'Feline companion',
      DOG: 'Canine friend',
      SUN: 'Solar system centerpiece',
      SKY: 'High celestial expanse',
      CODE: 'Software developer script',
      GRID: 'Network of intersecting lines',
      PUZZLE: 'Mind-bending enigma',
      TIME: 'Clock measurement',
      STAR: 'Night sky luminary',
      DISCORD: 'Platform for community voice and text',
      SERVER: 'Network host or restaurant worker',
      WEB: 'Online interconnected realm',
      BOT: 'Automated script or assistant',
      GAME: 'Playful competition or match',
      DAILY: 'Occurring every twenty-four hours',
    };

    if (hints[answer]) return hints[answer];
    return `Clue for ${answer.length}-letter entry`;
  }

  private fallbackClues(entries: ClueEntryInput[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const e of entries) {
      result[`${e.number}-${e.direction}`] = this.generateFallbackClue(e.answer);
    }
    return result;
  }
}

export const defaultLlmProvider = new GeminiLlmProvider();
