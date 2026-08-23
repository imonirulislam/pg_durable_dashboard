import { describe, expect, it } from 'vitest';
import { parseConnectionInput } from './input.js';

const bad = (body: unknown, message: RegExp) =>
  expect(() => parseConnectionInput(body)).toThrowError(
    expect.objectContaining({ status: 400, message: expect.stringMatching(message) })
  );

describe('parseConnectionInput — connection string form', () => {
  it('splits a URL into the parts the UI displays', () => {
    expect(
      parseConnectionInput({
        label: 'staging',
        url: 'postgresql://reader:s3cr3t@db.example.com:5433/analytics',
      })
    ).toEqual({
      label: 'staging',
      host: 'db.example.com',
      port: 5433,
      database: 'analytics',
      username: 'reader',
      password: 's3cr3t',
      sslMode: 'disable',
      ca: null,
    });
  });

  it('defaults the port and database like libpq does', () => {
    const input = parseConnectionInput({
      label: 'x',
      url: 'postgresql://user:pw@db.example.com',
    });
    expect(input.port).toBe(5432);
    expect(input.database).toBe('postgres');
  });

  it('percent-decodes credentials, so a password with @ or / survives', () => {
    const input = parseConnectionInput({
      label: 'x',
      url: 'postgresql://od%40d:p%40ss%2Fword@db.example.com/db',
    });
    expect(input.username).toBe('od@d');
    expect(input.password).toBe('p@ss/word');
  });

  it('takes sslmode from the query string', () => {
    expect(
      parseConnectionInput({
        label: 'x',
        url: 'postgresql://u:p@db.example.com/db?sslmode=verify-full',
      }).sslMode
    ).toBe('verify-full');
  });

  it('lets an explicit sslMode tighten what the URL said', () => {
    expect(
      parseConnectionInput({
        label: 'x',
        url: 'postgresql://u:p@db.example.com/db?sslmode=require',
        sslMode: 'verify-full',
      }).sslMode
    ).toBe('verify-full');
  });

  it('accepts both postgres:// and postgresql://', () => {
    for (const scheme of ['postgres', 'postgresql']) {
      expect(
        parseConnectionInput({ label: 'x', url: `${scheme}://u:p@h/db` }).host
      ).toBe('h');
    }
  });

  it('rejects a non-postgres scheme', () => {
    // Without this, the server would happily be pointed at http:// or file://.
    bad({ label: 'x', url: 'http://example.com/db' }, /must start with postgres/);
    bad({ label: 'x', url: 'file:///etc/passwd' }, /must start with postgres/);
  });

  it('rejects an unparseable string', () => {
    bad({ label: 'x', url: 'definitely not a url' }, /could not parse/);
  });

  it('requires a username, which a URL can omit', () => {
    bad({ label: 'x', url: 'postgresql://db.example.com/db' }, /no username/);
  });
});

describe('parseConnectionInput — field form', () => {
  it('accepts discrete fields', () => {
    expect(
      parseConnectionInput({
        label: 'prod',
        host: 'db.internal',
        port: 6432,
        database: 'app',
        username: 'dashboard',
        password: 'pw',
        sslMode: 'verify-full',
      })
    ).toMatchObject({ host: 'db.internal', port: 6432, sslMode: 'verify-full' });
  });

  it('requires host, database and username', () => {
    bad({ label: 'x', database: 'd', username: 'u' }, /host is required/);
    bad({ label: 'x', host: 'h', username: 'u' }, /database is required/);
    bad({ label: 'x', host: 'h', database: 'd' }, /username is required/);
  });

  it('rejects a port that is not a usable port', () => {
    for (const port of [0, 70000, -1, 5432.5, 'abc']) {
      bad({ label: 'x', host: 'h', database: 'd', username: 'u', port }, /port must be/);
    }
  });

  it('allows an empty password, which is valid with trust or peer auth', () => {
    expect(
      parseConnectionInput({ label: 'x', host: 'h', database: 'd', username: 'u' })
        .password
    ).toBe('');
  });
});

describe('parseConnectionInput — shared validation', () => {
  it('requires a label and bounds its length', () => {
    bad({ url: 'postgresql://u:p@h/db' }, /label is required/);
    bad({ label: '   ', url: 'postgresql://u:p@h/db' }, /label is required/);
    bad({ label: 'a'.repeat(65), url: 'postgresql://u:p@h/db' }, /64 characters/);
  });

  it('rejects a body that is not an object', () => {
    bad('postgresql://u:p@h/db', /expected a JSON object/);
    bad(null, /expected a JSON object/);
  });

  it('rejects a CA that is not PEM, and one that is absurdly large', () => {
    bad(
      { label: 'x', url: 'postgresql://u:p@h/db', ca: 'just some text' },
      /PEM encoded/
    );
    bad(
      {
        label: 'x',
        url: 'postgresql://u:p@h/db',
        ca: `-----BEGIN CERTIFICATE-----${'a'.repeat(33_000)}`,
      },
      /too large/
    );
  });

  it('keeps a valid PEM certificate', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';
    expect(
      parseConnectionInput({ label: 'x', url: 'postgresql://u:p@h/db', ca }).ca
    ).toBe(ca);
  });

  it('trims surrounding whitespace from pasted values', () => {
    const input = parseConnectionInput({
      label: '  staging  ',
      url: '  postgresql://u:p@h/db  ',
    });
    expect(input.label).toBe('staging');
    expect(input.host).toBe('h');
  });
});
