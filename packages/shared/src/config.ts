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

  // Timing & Schedule
  RELEASE_HOUR_UTC: 0,
  RELEASE_MINUTE_UTC: 0,
  PUZZLE_DURATION_HOURS: 24,
  DEFAULT_TIMEZONE: 'UTC',

  // Penalties (in seconds)
  CHECK_WORD_PENALTY_SECONDS: 30,
  REVEAL_LETTER_PENALTY_SECONDS: 60,
  SUBMIT_INCORRECT_PENALTY_SECONDS: 30,

  // Generation & Solver
  SOLVER_TIME_BUDGET_MS: 3500,
  BUFFER_TARGET_MIN: 3,
  BUFFER_TARGET_MAX: 7,
  BUFFER_DAYS_AHEAD: 2,
  MAX_PIPELINE_RETRIES: 4,

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
