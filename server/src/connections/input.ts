import { parseSslMode, sslModeFromSearch } from './ssl.js';
import { HttpError } from '../types.js';
// Type-only, so validation can be tested without loading SQLite.
import type { ConnectionInput } from './store.js';

const DEFAULT_PORT = 5432;
const MAX_LABEL = 64;
const MAX_CA_BYTES = 32 * 1024;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The trust boundary for browser-supplied connection details. Takes a
 * connection string or discrete fields; parts are stored so the UI can show
 * where a connection points without handling the password.
 */
export function parseConnectionInput(body: unknown): ConnectionInput {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'expected a JSON object');
  }
  const raw = body as Record<string, unknown>;

  const label = str(raw.label);
  if (!label) throw new HttpError(400, 'label is required');
  if (label.length > MAX_LABEL) {
    throw new HttpError(400, `label must be ${MAX_LABEL} characters or fewer`);
  }

  const ca = str(raw.ca) || null;
  if (ca && Buffer.byteLength(ca) > MAX_CA_BYTES) {
    throw new HttpError(400, 'CA certificate is too large');
  }
  if (ca && !ca.includes('BEGIN CERTIFICATE')) {
    throw new HttpError(400, 'CA certificate must be PEM encoded');
  }

  const url = str(raw.url);
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(400, 'could not parse that connection string');
    }
    if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
      throw new HttpError(
        400,
        'connection string must start with postgres:// or postgresql://'
      );
    }
    if (!parsed.hostname) throw new HttpError(400, 'connection string has no host');
    const username = decodeURIComponent(parsed.username);
    if (!username) throw new HttpError(400, 'connection string has no username');

    return {
      label,
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : DEFAULT_PORT,
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      username,
      password: decodeURIComponent(parsed.password),
      // Explicit sslMode wins, so the dropdown can tighten a pasted URL.
      sslMode:
        raw.sslMode === undefined
          ? sslModeFromSearch(parsed.search)
          : parseSslMode(raw.sslMode),
      ca,
    };
  }

  const host = str(raw.host);
  const database = str(raw.database);
  const username = str(raw.username);
  if (!host) throw new HttpError(400, 'host is required');
  if (!database) throw new HttpError(400, 'database is required');
  if (!username) throw new HttpError(400, 'username is required');

  const port =
    raw.port === undefined || raw.port === '' ? DEFAULT_PORT : Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new HttpError(400, 'port must be an integer between 1 and 65535');
  }

  return {
    label,
    host,
    port,
    database,
    username,
    password: typeof raw.password === 'string' ? raw.password : '',
    sslMode: parseSslMode(raw.sslMode),
    ca,
  };
}
