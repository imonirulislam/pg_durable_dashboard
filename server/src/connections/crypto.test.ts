import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// crypto.ts derives its key once and caches it, so each test needs a fresh
// module instance with the environment already in place.
async function load(secret?: string) {
  vi.resetModules();
  if (secret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = secret;
  return import('./crypto.js');
}

let keyPath: string;

beforeEach(() => {
  keyPath = join(mkdtempSync(join(tmpdir(), 'pgdd-crypto-')), 'secret.key');
});

afterEach(() => {
  delete process.env.APP_SECRET;
});

describe('encrypt/decrypt', () => {
  it('round-trips a password', async () => {
    const { encrypt, decrypt } = await load('test-secret');
    expect(decrypt(encrypt('s3cr3t', keyPath), keyPath)).toBe('s3cr3t');
  });

  it('handles unicode and empty passwords', async () => {
    const { encrypt, decrypt } = await load('test-secret');
    for (const value of ['', 'pässwörd — 秘密', 'a'.repeat(4096)]) {
      expect(decrypt(encrypt(value, keyPath), keyPath)).toBe(value);
    }
  });

  it('produces different ciphertext each time, so equal passwords are not obvious', async () => {
    const { encrypt } = await load('test-secret');
    expect(encrypt('same', keyPath)).not.toBe(encrypt('same', keyPath));
  });

  it('never leaves the plaintext in the stored payload', async () => {
    const { encrypt } = await load('test-secret');
    expect(encrypt('hunter2', keyPath)).not.toContain('hunter2');
  });

  it('rejects tampered ciphertext instead of returning garbage', async () => {
    const { encrypt, decrypt } = await load('test-secret');
    const [iv, tag, data] = encrypt('s3cr3t', keyPath).split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    expect(() =>
      decrypt([iv, tag, flipped.toString('base64')].join(':'), keyPath)
    ).toThrow(/APP_SECRET may have changed/);
  });

  it('rejects a malformed payload', async () => {
    const { decrypt } = await load('test-secret');
    expect(() => decrypt('not-a-payload', keyPath)).toThrow(/malformed/);
  });

  it('cannot decrypt with a different APP_SECRET, and says so', async () => {
    const { encrypt } = await load('first-secret');
    const payload = encrypt('s3cr3t', keyPath);

    const { decrypt } = await load('second-secret');
    expect(() => decrypt(payload, keyPath)).toThrow(/APP_SECRET may have changed/);
  });
});

describe('generated key file', () => {
  it('is created when APP_SECRET is unset, and is not world-readable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { encrypt, decrypt } = await load(undefined);

    expect(decrypt(encrypt('s3cr3t', keyPath), keyPath)).toBe('s3cr3t');
    expect(readFileSync(keyPath, 'utf8').trim()).not.toBe('');
    // 0600: the file sits next to the ciphertext it protects.
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('APP_SECRET is not set'));
    warn.mockRestore();
  });

  it('reuses an existing key file across restarts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = await load(undefined);
    const payload = first.encrypt('s3cr3t', keyPath);

    const second = await load(undefined);
    expect(second.decrypt(payload, keyPath)).toBe('s3cr3t');
  });
});
