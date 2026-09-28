import { GAME_CONFIG } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function releaseOffsetMs(): number {
  return (GAME_CONFIG.RELEASE_HOUR_UTC * 60 + GAME_CONFIG.RELEASE_MINUTE_UTC) * 60 * 1000;
}

/**
 * The date (YYYY-MM-DD) of the puzzle that is live at `now`. A puzzle is released at
 * RELEASE_HOUR_UTC:RELEASE_MINUTE_UTC on its date and runs until the next day's release.
 */
export function getPuzzleDate(now: Date = new Date()): string {
  return new Date(now.getTime() - releaseOffsetMs()).toISOString().slice(0, 10);
}

/**
 * Adds whole days to a YYYY-MM-DD date.
 */
export function addDays(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Whole days between 1970-01-01 and a YYYY-MM-DD date, for cycling through fixed sets by date.
 */
export function getDayNumber(dateStr: string): number {
  return Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / DAY_MS);
}

/**
 * When the puzzle for `dateStr` goes live.
 */
export function getPuzzleReleaseTime(dateStr: string): Date {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + releaseOffsetMs());
}

/**
 * When the puzzle for `dateStr` closes, which is the next puzzle's release.
 */
export function getPuzzleExpiry(dateStr: string): Date {
  return getPuzzleReleaseTime(addDays(dateStr, 1));
}
