import pg from 'pg';
import { envList, envNum } from '../config.js';
import { HttpError } from '../types.js';
import { sslConfig, type SslMode } from './ssl.js';
import { getConnection, resolveCredentials, type ConnectionInput } from './store.js';

const { Client, Pool } = pg;

// A hanging df.* call must not pin a connection: later polls would queue
// behind it and the UI would stall rather than error.
const poolDefaults = {
  max: envNum('PG_POOL_MAX', 5),
  statement_timeout: envNum('PG_STATEMENT_TIMEOUT_MS', 10_000),
  query_timeout: envNum('PG_QUERY_TIMEOUT_MS', 15_000),
  connectionTimeoutMillis: envNum('PG_CONNECT_TIMEOUT_MS', 5_000),
  idleTimeoutMillis: 30_000,
} as const;

// Hosts arrive from the browser. Unset means anywhere — fine on localhost, not
// once exposed.
const hostAllowList = envList('ALLOWED_DB_HOSTS').map((h) => h.toLowerCase());

export function assertHostAllowed(host: string): void {
  if (hostAllowList.length === 0) return;
  if (!hostAllowList.includes(host.toLowerCase())) {
    throw new HttpError(403, `host "${host}" is not in ALLOWED_DB_HOSTS`);
  }
}

export const VERSION_QUERY = `
  SELECT current_setting('server_version') AS version,
         (SELECT extversion FROM pg_extension WHERE extname = 'pg_durable') AS extversion
`;

export interface ProbeResult {
  serverVersion: string;
  pgDurableVersion: string | null;
}

const pools = new Map<string, pg.Pool>();

function build(id: string): pg.Pool {
  const credentials = resolveCredentials(id);
  if (!credentials) throw new HttpError(404, 'connection not found');

  const pool =
    credentials.kind === 'url'
      ? // sslmode re-applied rather than left to pg-connection-string, which
        // maps everything but `disable` to `{}` — Node then verifies fully, so
        // `require` would reject a self-signed cert. Explicit ssl wins, keeping
        // behaviour equal to the mode the UI shows.
        new Pool({
          ...poolDefaults,
          connectionString: credentials.url,
          ssl: sslConfig(credentials.sslMode, credentials.host, null),
        })
      : new Pool({
          ...poolDefaults,
          host: credentials.config.host,
          port: credentials.config.port,
          database: credentials.config.database,
          user: credentials.config.username,
          password: credentials.config.password,
          ssl: sslConfig(
            credentials.config.sslMode,
            credentials.config.host,
            credentials.config.ca
          ),
        });

  pool.on('error', (err: Error) => {
    // An idle client dying must not take the process down.
    console.error(`[${id}] Postgres pool error:`, err.message);
  });

  return pool;
}

export function getPool(id: string): pg.Pool {
  const existing = pools.get(id);
  if (existing) return existing;

  const profile = getConnection(id);
  if (!profile) throw new HttpError(404, 'connection not found');
  assertHostAllowed(profile.host);

  const pool = build(id);
  pools.set(id, pool);
  return pool;
}

/** Drop a pool after its profile changes or is removed. */
export async function releasePool(id: string): Promise<void> {
  const pool = pools.get(id);
  if (!pool) return;
  pools.delete(id);
  await pool.end().catch((err: Error) => {
    console.error(`[${id}] error closing pool:`, err.message);
  });
}

export async function closeAllPools(): Promise<void> {
  await Promise.all([...pools.keys()].map(releasePool));
}

/** Tests credentials that may not be stored yet. A Client, so a bad host can't
 * occupy a pool slot. */
export async function probe(
  config: Pick<
    ConnectionInput,
    'host' | 'port' | 'database' | 'username' | 'password' | 'ca'
  > & { sslMode: SslMode }
): Promise<ProbeResult> {
  assertHostAllowed(config.host);
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: sslConfig(config.sslMode, config.host, config.ca),
    statement_timeout: 5_000,
    query_timeout: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const { rows } = await client.query<{
      version: string;
      extversion: string | null;
    }>(VERSION_QUERY);
    return {
      serverVersion: rows[0]?.version ?? 'unknown',
      pgDurableVersion: rows[0]?.extversion ?? null,
    };
  } finally {
    await client.end().catch(() => {});
  }
}
