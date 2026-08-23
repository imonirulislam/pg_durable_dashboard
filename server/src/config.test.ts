import { afterEach, describe, expect, it, vi } from 'vitest';
import { envList, envNum, envStr } from './config.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('envStr', () => {
  it('reads a value', () => {
    vi.stubEnv('X_TEST', 'value');
    expect(envStr('X_TEST')).toBe('value');
  });

  it('treats blank as unset', () => {
    // `docker run -e X=` and a compose `X: ${X:-}` both arrive as ''. Without
    // this, `?? fallback` would keep the empty string.
    for (const blank of ['', '   ']) {
      vi.stubEnv('X_TEST', blank);
      expect(envStr('X_TEST')).toBeUndefined();
    }
  });

  it('trims surrounding whitespace', () => {
    vi.stubEnv('X_TEST', '  value  ');
    expect(envStr('X_TEST')).toBe('value');
  });
});

describe('envNum', () => {
  it('parses a number', () => {
    vi.stubEnv('X_TEST', '8080');
    expect(envNum('X_TEST', 4000)).toBe(8080);
  });

  it('falls back when blank rather than yielding 0', () => {
    // Number('') === 0, which would have meant PORT=0 and CACHE_TTL_MS=0.
    vi.stubEnv('X_TEST', '');
    expect(envNum('X_TEST', 4000)).toBe(4000);
  });

  it('falls back when unset', () => {
    expect(envNum('X_DEFINITELY_UNSET', 4000)).toBe(4000);
  });

  it('honours an explicit zero, which disables the cache', () => {
    vi.stubEnv('X_TEST', '0');
    expect(envNum('X_TEST', 2000)).toBe(0);
  });

  it('warns and falls back on a non-number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('X_TEST', 'soon');
    expect(envNum('X_TEST', 4000)).toBe(4000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('X_TEST'));
  });
});

describe('envList', () => {
  it('splits on commas and drops blanks', () => {
    vi.stubEnv('X_TEST', 'localhost, db.internal ,,');
    expect(envList('X_TEST')).toEqual(['localhost', 'db.internal']);
  });

  it('is empty when unset or blank', () => {
    expect(envList('X_DEFINITELY_UNSET')).toEqual([]);
    vi.stubEnv('X_TEST', '  ');
    expect(envList('X_TEST')).toEqual([]);
  });
});
