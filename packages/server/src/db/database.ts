import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

let dbInstance: SqlJsDatabase | null = null;
let databaseFilePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'crossword.db');

export function setDatabasePath(customPath: string) {
  databaseFilePath = customPath;
}

export async function getDatabase(): Promise<SqlJsDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(databaseFilePath)) {
    const fileBuffer = fs.readFileSync(databaseFilePath);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
    persistDatabase();
  }

  return dbInstance;
}

export function persistDatabase() {
  if (!dbInstance) return;
  const dir = path.dirname(databaseFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const binaryArray = dbInstance.export();
  fs.writeFileSync(databaseFilePath, Buffer.from(binaryArray));
}

/**
 * Executes a single SQL query or script and auto-persists to disk.
 */
export async function runQuery(sql: string, params: (string | number | null | Uint8Array)[] = []): Promise<void> {
  const db = await getDatabase();
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  persistDatabase();
}

/**
 * Runs a SELECT query and returns all matching rows as plain objects.
 */
export async function queryAll<T = Record<string, any>>(
  sql: string,
  params: (string | number | null | Uint8Array)[] = []
): Promise<T[]> {
  const db = await getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

/**
 * Runs a SELECT query and returns the first matching row or null.
 */
export async function queryOne<T = Record<string, any>>(
  sql: string,
  params: (string | number | null | Uint8Array)[] = []
): Promise<T | null> {
  const rows = await queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}
