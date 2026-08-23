import { describe, expect, it } from 'vitest';
import { parseSslMode, sslConfig, sslModeFromSearch } from './ssl.js';

describe('parseSslMode', () => {
  it('accepts the modes we implement', () => {
    for (const mode of ['disable', 'require', 'verify-ca', 'verify-full'] as const) {
      expect(parseSslMode(mode)).toBe(mode);
    }
  });

  it('maps libpq negotiation modes to the strongest thing we can honour', () => {
    // node-postgres cannot negotiate allow/prefer, so treating them as `require`
    // is the only reading that does not over-promise.
    expect(parseSslMode('prefer')).toBe('require');
    expect(parseSslMode('allow')).toBe('require');
  });

  it('accepts a legacy boolean', () => {
    expect(parseSslMode(true)).toBe('require');
    expect(parseSslMode(false)).toBe('disable');
  });

  it('falls back rather than guessing when nothing is given', () => {
    expect(parseSslMode(undefined)).toBe('disable');
    expect(parseSslMode('', 'verify-full')).toBe('verify-full');
  });

  it('rejects an unknown mode with a 400 rather than silently downgrading', () => {
    expect(() => parseSslMode('sort-of')).toThrowError(
      expect.objectContaining({ status: 400 })
    );
  });
});

describe('sslModeFromSearch', () => {
  it('reads sslmode out of a connection string query', () => {
    expect(sslModeFromSearch('?sslmode=verify-full')).toBe('verify-full');
    expect(sslModeFromSearch('?application_name=x&sslmode=require')).toBe('require');
  });

  it('uses the fallback when the parameter is absent', () => {
    expect(sslModeFromSearch('')).toBe('disable');
    expect(sslModeFromSearch('?application_name=x', 'require')).toBe('require');
  });
});

describe('sslConfig', () => {
  it('disables TLS entirely for disable', () => {
    expect(sslConfig('disable', 'db.example.com')).toBe(false);
  });

  it('encrypts without verifying for require', () => {
    // This is the libpq meaning of `require`, and the reason the UI labels it
    // "encrypted, unverified" rather than implying safety.
    expect(sslConfig('require', 'db.example.com')).toEqual({ rejectUnauthorized: false });
  });

  it('verifies the chain for verify-ca but not the hostname', () => {
    const config = sslConfig('verify-ca', 'db.example.com');
    expect(config).toMatchObject({ rejectUnauthorized: true });
    expect(typeof (config as { checkServerIdentity: unknown }).checkServerIdentity).toBe(
      'function'
    );
    expect(
      (config as { checkServerIdentity: () => undefined }).checkServerIdentity()
    ).toBeUndefined();
  });

  it('verifies chain and hostname for verify-full', () => {
    const config = sslConfig('verify-full', 'db.example.com');
    expect(config).toMatchObject({
      rejectUnauthorized: true,
      servername: 'db.example.com',
    });
    // No checkServerIdentity override: Node's default hostname check applies.
    expect(config).not.toHaveProperty('checkServerIdentity');
  });

  it('passes a supplied CA through for verification', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';
    expect(sslConfig('verify-full', 'db.example.com', ca)).toMatchObject({ ca });
  });

  it('leaves ca unset when none is given, falling back to the system store', () => {
    expect(sslConfig('verify-full', 'db.example.com', null)).toMatchObject({
      ca: undefined,
    });
  });
});
