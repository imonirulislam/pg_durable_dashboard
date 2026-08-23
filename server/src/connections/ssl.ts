import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import { envStr } from '../config.js';
import { HttpError } from '../types.js';

/**
 * Postgres SSL modes, named as libpq names them. Only the ones that differ in
 * behaviour here are offered: `allow`/`prefer` are negotiation hints libpq
 * implements and node-postgres does not, so accepting them would imply a
 * guarantee we can't keep.
 */
export const SSL_MODES = ['disable', 'require', 'verify-ca', 'verify-full'] as const;
export type SslMode = (typeof SSL_MODES)[number];

export function isSslMode(value: unknown): value is SslMode {
  return typeof value === 'string' && (SSL_MODES as readonly string[]).includes(value);
}

export function parseSslMode(value: unknown, fallback: SslMode = 'disable'): SslMode {
  if (isSslMode(value)) return value;
  if (value === 'prefer' || value === 'allow') return 'require';
  if (value === true) return 'require';
  if (value === false || value === undefined || value === null || value === '') {
    return fallback;
  }
  throw new HttpError(
    400,
    `sslmode must be one of ${SSL_MODES.join(', ')} (got ${JSON.stringify(value)})`
  );
}

/** sslmode from a connection string's query parameters. */
export function sslModeFromSearch(search: string, fallback: SslMode = 'disable'): SslMode {
  const value = new URLSearchParams(search).get('sslmode');
  return value ? parseSslMode(value, fallback) : fallback;
}

function rootCert(pem: string | null): string | Buffer | undefined {
  if (pem && pem.trim()) return pem;
  // Fall back to libpq's environment variable so an existing setup works
  // unchanged; without a CA, verification uses Node's bundled roots, which is
  // usually wrong for a private Postgres CA.
  const path = envStr('PGSSLROOTCERT');
  if (!path) return undefined;
  try {
    return readFileSync(path);
  } catch (err) {
    throw new Error(`could not read PGSSLROOTCERT (${path}): ${(err as Error).message}`);
  }
}

/**
 * node-postgres takes Node's TLS options, where `rejectUnauthorized: false`
 * means "encrypt but authenticate nothing" — that's `require`, and it is not
 * protection against an active attacker. `verify-ca` checks the chain;
 * `verify-full` additionally checks the hostname.
 */
export function sslConfig(
  mode: SslMode,
  host: string,
  ca: string | null = null
): ConnectionOptions | false {
  switch (mode) {
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-ca':
      // checkServerIdentity is a no-op so the chain is verified but a certificate
      // issued for another host by the same CA still passes — which is what
      // verify-ca means.
      return { rejectUnauthorized: true, ca: rootCert(ca), checkServerIdentity: () => undefined };
    case 'verify-full':
      return { rejectUnauthorized: true, ca: rootCert(ca), servername: host };
  }
}

export function describeSslMode(mode: SslMode): string {
  switch (mode) {
    case 'disable':
      return 'no TLS';
    case 'require':
      return 'encrypted, certificate not verified';
    case 'verify-ca':
      return 'certificate chain verified';
    case 'verify-full':
      return 'chain and hostname verified';
  }
}
