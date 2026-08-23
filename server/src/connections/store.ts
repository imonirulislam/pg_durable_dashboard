import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decrypt, encrypt } from './crypto.js';
import { parseSslMode, sslModeFromSearch, type SslMode } from './ssl.js';
import { envStr } from '../config.js';
import { HttpError } from '../types.js';

/** Profile as exposed over HTTP: no password, ever. */
export interface SafeConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  hasCustomCa: boolean;
  /** Profiles from DATABASE_URL can't be edited or deleted. */
  readOnly: boolean;
  createdAt: string | null;
  lastOkAt: string | null;
}

export interface ConnectionInput {
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  /** PEM for a private CA; not a secret, so stored as-is. */
  ca: string | null;
}

interface Row {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslmode: string;
  ca: string | null;
  secret: string;
  created_at: string;
  last_ok_at: string | null;
}

/** Identifier for the implicit profile built from DATABASE_URL. */
export const ENV_CONNECTION_ID = 'env';

const DATA_DIR = envStr('DATA_DIR') ?? 'data';
const DB_PATH = envStr('CONNECTIONS_DB') ?? join(DATA_DIR, 'connections.db');
const KEY_PATH = envStr('APP_SECRET_FILE') ?? join(DATA_DIR, 'secret.key');

let db: DatabaseSync | null = null;

function columnNames(database: DatabaseSync, table: string): string[] {
  const rows = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

function handle(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL UNIQUE,
      host        TEXT NOT NULL,
      port        INTEGER NOT NULL,
      database    TEXT NOT NULL,
      username    TEXT NOT NULL,
      sslmode     TEXT NOT NULL DEFAULT 'disable',
      ca          TEXT,
      secret      TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      last_ok_at  TEXT
    )
  `);

  // Earlier versions had a boolean `ssl` column instead of a mode.
  const columns = columnNames(db, 'connections');
  if (!columns.includes('sslmode')) {
    db.exec(`ALTER TABLE connections ADD COLUMN sslmode TEXT NOT NULL DEFAULT 'disable'`);
    if (columns.includes('ssl')) {
      db.exec(`UPDATE connections SET sslmode = 'require' WHERE ssl = 1`);
    }
  }
  if (!columns.includes('ca')) {
    db.exec('ALTER TABLE connections ADD COLUMN ca TEXT');
  }

  return db;
}

function toSafe(row: Row): SafeConnection {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    sslMode: parseSslMode(row.sslmode),
    hasCustomCa: !!row.ca,
    readOnly: false,
    createdAt: row.created_at,
    lastOkAt: row.last_ok_at,
  };
}

/** DATABASE_URL as a profile. Kept out of the store so the .env credential is
 * never copied into the database file. */
export function envConnection(): SafeConnection | null {
  const url = envStr('DATABASE_URL');
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      id: ENV_CONNECTION_ID,
      label: envStr('ENV_CONNECTION_LABEL') ?? 'DATABASE_URL',
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      username: decodeURIComponent(parsed.username) || '(default)',
      sslMode: sslModeFromSearch(parsed.search),
      hasCustomCa: !!envStr('PGSSLROOTCERT'),
      readOnly: true,
      createdAt: null,
      lastOkAt: null,
    };
  } catch {
    console.warn('DATABASE_URL is set but could not be parsed — ignoring it.');
    return null;
  }
}

export function listConnections(): SafeConnection[] {
  const stored = handle()
    .prepare('SELECT * FROM connections ORDER BY label')
    .all() as unknown as Row[];
  const env = envConnection();
  return env ? [env, ...stored.map(toSafe)] : stored.map(toSafe);
}

export function getConnection(id: string): SafeConnection | null {
  if (id === ENV_CONNECTION_ID) return envConnection();
  const row = handle()
    .prepare('SELECT * FROM connections WHERE id = ?')
    .get(id) as unknown as Row | undefined;
  return row ? toSafe(row) : null;
}

/** Connection details including the decrypted password. Never leaves the server. */
export function resolveCredentials(
  id: string
):
  | { kind: 'url'; url: string; sslMode: SslMode; host: string }
  | { kind: 'parts'; config: ConnectionInput }
  | null {
  if (id === ENV_CONNECTION_ID) {
    const url = envStr('DATABASE_URL');
    const profile = envConnection();
    return url && profile
      ? { kind: 'url', url, sslMode: profile.sslMode, host: profile.host }
      : null;
  }
  const row = handle()
    .prepare('SELECT * FROM connections WHERE id = ?')
    .get(id) as unknown as Row | undefined;
  if (!row) return null;
  return {
    kind: 'parts',
    config: {
      label: row.label,
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password: decrypt(row.secret, KEY_PATH),
      sslMode: parseSslMode(row.sslmode),
      ca: row.ca,
    },
  };
}

export function createConnection(input: ConnectionInput): SafeConnection {
  const id = randomUUID();
  try {
    handle()
      .prepare(
        `INSERT INTO connections
           (id, label, host, port, database, username, sslmode, ca, secret, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.label,
        input.host,
        input.port,
        input.database,
        input.username,
        input.sslMode,
        input.ca,
        encrypt(input.password, KEY_PATH),
        new Date().toISOString()
      );
  } catch (err) {
    if (String((err as Error).message).includes('UNIQUE')) {
      throw new HttpError(409, `a connection named "${input.label}" already exists`);
    }
    throw err;
  }
  return getConnection(id)!;
}

export function deleteConnection(id: string): void {
  if (id === ENV_CONNECTION_ID) {
    throw new HttpError(400, 'the DATABASE_URL connection is configured in .env');
  }
  const result = handle().prepare('DELETE FROM connections WHERE id = ?').run(id);
  if (result.changes === 0) throw new HttpError(404, 'connection not found');
}

export function markConnectionOk(id: string): void {
  if (id === ENV_CONNECTION_ID) return;
  handle()
    .prepare('UPDATE connections SET last_ok_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

/** Where queries go when the client doesn't name a target. */
export function defaultConnectionId(): string | null {
  return listConnections()[0]?.id ?? null;
}

export function closeStore(): void {
  db?.close();
  db = null;
}
