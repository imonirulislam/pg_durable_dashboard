import { describe, expect, it } from 'vitest';
import { toVariable } from '../varMasking.js';

describe('toVariable — the one place a secret could leak to the browser', () => {
  it.each([
    'api_key',
    'API_KEY',
    'stripe_secret',
    'auth_token',
    'db_password',
    'db_passwd',
    'oauth_credential',
    'basic_auth',
  ])('masks %s', (name) => {
    const value = 'super-secret-value';
    const v = toVariable({ name, value, owner: 'postgres' });
    expect(v.sensitive).toBe(true);
    expect(v.value).toBeNull();
    expect(v.length).toBe(value.length);
  });

  it.each(['api_base', 'timeout_seconds', 'feature_flag', 'region'])(
    'shows %s in full',
    (name) => {
      const value = 'https://api.example.com';
      const v = toVariable({ name, value, owner: 'postgres' });
      expect(v.sensitive).toBe(false);
      expect(v.value).toBe(value);
    }
  );

  it('reports length even when the value is masked, so the UI can show its shape', () => {
    const v = toVariable({ name: 'api_key', value: 'abc123', owner: 'postgres' });
    expect(v.length).toBe(6);
  });
});
