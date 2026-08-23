import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { envStr } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

// KDF domain separator, not a label. Changing it makes every stored password
// undecryptable — leave it alone when renaming things.
const KEY_SALT = 'pg-durable-dashboard:connections';

let cachedKey: Buffer | null = null;

// Better than storing passwords in the clear, but a key beside the ciphertext
// guards against little; set APP_SECRET outside local development.
function loadOrCreateSecret(keyPath: string): string {
  try {
    const existing = readFileSync(keyPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // No key file yet.
  }
  const generated = randomBytes(32).toString('base64');
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, `${generated}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  console.warn(
    `APP_SECRET is not set — generated an encryption key at ${keyPath}. ` +
      'Back it up: losing it means re-entering every stored password.'
  );
  return generated;
}

// Fixed salt: the input is high-entropy, so this is domain separation only.
function key(keyPath: string): Buffer {
  if (cachedKey) return cachedKey;
  const secret = envStr('APP_SECRET') ?? loadOrCreateSecret(keyPath);
  cachedKey = scryptSync(secret, KEY_SALT, 32);
  return cachedKey;
}

/** Returns `iv:tag:ciphertext`, base64 each. */
export function encrypt(plaintext: string, keyPath: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(keyPath), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(payload: string, keyPath: string): string {
  const parts = payload.split(':');
  const [ivB64, tagB64, dataB64] = parts;
  // Empty ciphertext is legitimate — a blank password is valid with trust auth.
  if (parts.length !== 3 || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('stored credential is malformed');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key(keyPath),
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Almost always a rotated APP_SECRET rather than tampering.
    throw new Error(
      'could not decrypt the stored password — APP_SECRET may have changed. ' +
        'Re-add the connection.'
    );
  }
}
