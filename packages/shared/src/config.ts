/**
 * Game rules and tuning configuration constants.
 * Every rule-based number is defined here so it can be changed without code edits.
 */

export const GAME_CONFIG = {
  // Grid geometry
  GRID_WIDTH: 12,
  GRID_HEIGHT: 12,
  MIN_WORD_LENGTH: 3,
  MAX_ENTRIES: 78,

  // Daily release time (UTC). Each puzzle is live from its release until the next day's release.
  RELEASE_HOUR_UTC: 0,
  RELEASE_MINUTE_UTC: 0,

  // Penalties (in seconds)
  CHECK_WORD_PENALTY_SECONDS: 30,
  REVEAL_LETTER_PENALTY_SECONDS: 60,
  SUBMIT_INCORRECT_PENALTY_SECONDS: 30,

  // Generation & Solver
  SOLVER_TIME_BUDGET_MS: 3500,
  // Puzzles are kept ready for tomorrow through BUFFER_DAYS_AHEAD + BUFFER_TARGET_MIN - 1 days out.
  BUFFER_TARGET_MIN: 3,
  BUFFER_DAYS_AHEAD: 2,
  MAX_PIPELINE_RETRIES: 4,
  // An LLM request that takes longer than this is abandoned, so a hung call can't stall generation.
  LLM_REQUEST_TIMEOUT_MS: 120 * 1000,

  // Rate Limiting (per user window)
  RATE_LIMIT_CHECK_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_CHECK_MAX: 30,
  RATE_LIMIT_REVEAL_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_REVEAL_MAX: 20,
  RATE_LIMIT_SUBMIT_WINDOW_MS: 60 * 1000,
  RATE_LIMIT_SUBMIT_MAX: 15,

  // UI / Display
  TIMER_SYNC_INTERVAL_MS: 1000,
  AUTO_SAVE_DEBOUNCE_MS: 500,
} as const;

export type GameConfig = typeof GAME_CONFIG;
