import { getDatabase, queryAll, runQuery, transaction } from './database.js';

export async function runMigrations(): Promise<void> {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrations: { name: string; sql: string }[] = [
    {
      name: '001_initial_schema',
      sql: `
        -- Puzzles table
        CREATE TABLE IF NOT EXISTS puzzles (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          theme TEXT,
          width INTEGER NOT NULL DEFAULT 15,
          height INTEGER NOT NULL DEFAULT 15,
          grid_json TEXT NOT NULL,
          clues_json TEXT NOT NULL,
          solution_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('buffered', 'published', 'archived')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Server Guild Config table
        CREATE TABLE IF NOT EXISTS guild_config (
          guild_id TEXT PRIMARY KEY,
          leaderboard_channel_id TEXT,
          announce_solves INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Players table
        CREATE TABLE IF NOT EXISTS players (
          user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          display_name TEXT NOT NULL,
          avatar TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Attempts table
        CREATE TABLE IF NOT EXISTS attempts (
          id TEXT PRIMARY KEY,
          puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
          user_id TEXT NOT NULL REFERENCES players(user_id),
          guild_id TEXT,
          start_time TEXT NOT NULL,
          finish_time TEXT,
          penalty_seconds INTEGER NOT NULL DEFAULT 0,
          grid_state_json TEXT NOT NULL,
          wrong_answers_json TEXT NOT NULL,
          locked_cells_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(puzzle_id, user_id)
        );

        -- Events audit log table
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          attempt_id TEXT NOT NULL REFERENCES attempts(id),
          puzzle_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          guild_id TEXT,
          event_type TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_puzzles_date ON puzzles(date);
        CREATE INDEX IF NOT EXISTS idx_puzzles_status ON puzzles(status);
        CREATE INDEX IF NOT EXISTS idx_attempts_guild_puzzle ON attempts(guild_id, puzzle_id);
        CREATE INDEX IF NOT EXISTS idx_attempts_user_puzzle ON attempts(user_id, puzzle_id);
        CREATE INDEX IF NOT EXISTS idx_events_attempt ON events(attempt_id);
      `,
    },
    {
      // Set by `cli approve`. With REQUIRE_PUZZLE_APPROVAL=true, only approved puzzles are published.
      name: '002_puzzle_approval',
      sql: `ALTER TABLE puzzles ADD COLUMN approved_at TEXT;`,
    },
  ];

  for (const m of migrations) {
    // Checked inside the transaction so the server and the CLI can't both apply the same migration.
    const applied = transaction(() => {
      const done = queryAll<{ name: string }>(`SELECT name FROM migrations WHERE name = ?;`, [m.name]);
      if (done.length > 0) return false;
      db.exec(m.sql);
      runQuery(`INSERT INTO migrations (name) VALUES (?);`, [m.name]);
      return true;
    });
    if (applied) {
      console.log(`[Database] Applied migration: ${m.name}`);
    }
  }
}
