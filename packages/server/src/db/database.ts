import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export type SqlParam = string | number | null | Uint8Array;

let dbInstance: DatabaseSync | null = null;
let databaseFilePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'crossword.db');

/**
 * Points the module at another database file (tests, tooling). Closes the current connection.
 */
export function setDatabasePath(customPath: string) {
  closeDatabase();
  databaseFilePath = customPath;
}

export function closeDatabase() {
  dbInstance?.close();
  dbInstance = null;
}

/**
 * Opens the SQLite file itself rather than an in-memory copy, so the server and the CLI can
 * share it: each write is committed through SQLite's journal instead of rewriting the file, and
 * each process sees the other's changes on its next query.
 */
export function getDatabase(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const dir = path.dirname(databaseFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(databaseFilePath);
  // WAL lets the CLI read and write while the server holds the file open; the busy timeout
  // makes a writer wait for the other process's transaction instead of failing immediately.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  dbInstance = db;
  return db;
}

/**
 * Executes a single write statement and returns the number of rows it changed.
 */
export function runQuery(sql: string, params: SqlParam[] = []): { changes: number } {
  const result = getDatabase().prepare(sql).run(...params);
  return { changes: Number(result.changes) };
}

/**
 * Runs a SELECT query and returns all matching rows as plain objects.
 */
export function queryAll<T = Record<string, any>>(sql: string, params: SqlParam[] = []): T[] {
  return getDatabase().prepare(sql).all(...params) as T[];
}

/**
 * Runs a SELECT query and returns the first matching row or null.
 */
export function queryOne<T = Record<string, any>>(sql: string, params: SqlParam[] = []): T | null {
  return (getDatabase().prepare(sql).get(...params) as T | undefined) ?? null;
}

let transactionDepth = 0;

/**
 * Runs `fn` inside a write transaction, rolling back if it throws. A call made inside another
 * transaction joins it. `fn` must be synchronous: the queries above are, and awaiting inside a
 * transaction would let other requests' statements join it.
 */
export function transaction<T>(fn: () => T): T {
  if (transactionDepth > 0) {
    return fn();
  }

  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE;');
  transactionDepth++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error('transaction() callbacks must be synchronous');
    }
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    transactionDepth--;
  }
}
