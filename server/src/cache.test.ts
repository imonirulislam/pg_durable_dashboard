import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The TTL is read at module load, so each test loads the module with the TTL it
// wants.
async function load(ttlMs?: string) {
  vi.resetModules();
  if (ttlMs === undefined) delete process.env.CACHE_TTL_MS;
  else process.env.CACHE_TTL_MS = ttlMs;
  return import('./cache.js');
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CACHE_TTL_MS;
});

describe('cached', () => {
  it('serves a repeat call from the cache', async () => {
    const { cached } = await load('2000');
    const loader = vi.fn().mockResolvedValue('value');

    const first = await cached('k', loader);
    const second = await cached('k', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ data: 'value', fromCache: false });
    expect(second).toEqual({ data: 'value', fromCache: true });
  });

  it('collapses concurrent callers into one query', async () => {
    // The reason this exists: ten dashboards polling the same thing should cost
    // one df.metrics() call, not ten.
    const { cached } = await load('2000');
    const gate = deferred<string>();
    const loader = vi.fn().mockReturnValue(gate.promise);

    const inFlight = Promise.all([
      cached('k', loader),
      cached('k', loader),
      cached('k', loader),
    ]);
    gate.resolve('value');
    const results = await inFlight;

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.data)).toEqual(['value', 'value', 'value']);
  });

  it('queries again once the TTL has passed', async () => {
    const { cached } = await load('2000');
    const loader = vi.fn().mockResolvedValue('value');

    await cached('k', loader);
    vi.advanceTimersByTime(1999);
    await cached('k', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await cached('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps keys separate, so one database cannot serve another', async () => {
    const { cached } = await load('2000');
    const loader = vi.fn(async (value: string) => value);

    await cached('db1:metrics', () => loader('one'));
    const other = await cached('db2:metrics', () => loader('two'));

    expect(other.data).toBe('two');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures, so a brief outage recovers on the next poll', async () => {
    const { cached } = await load('2000');
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue('back');

    await expect(cached('k', loader)).rejects.toThrow('connection refused');
    await expect(cached('k', loader)).resolves.toEqual({
      data: 'back',
      fromCache: false,
    });
  });

  it('rejects every concurrent caller when the shared query fails', async () => {
    const { cached } = await load('2000');
    const gate = deferred<string>();
    const loader = vi.fn().mockReturnValue(gate.promise);

    const first = cached('k', loader);
    const second = cached('k', loader);
    gate.reject(new Error('boom'));

    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('is a passthrough when disabled', async () => {
    const { cached } = await load('0');
    const loader = vi.fn().mockResolvedValue('value');

    await cached('k', loader);
    const second = await cached('k', loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(second.fromCache) .toBe(false);
  });

  it('stays bounded when keys are unbounded', async () => {
    // ?label=<anything> means callers can invent keys; the map must not grow
    // forever.
    const { cached, cacheStats } = await load('2000');
    for (let i = 0; i < 700; i++) {
      await cached(`instances:${i}`, async () => i);
    }
    expect(cacheStats().entries).toBeLessThanOrEqual(cacheStats().maxEntries);
  });
});
