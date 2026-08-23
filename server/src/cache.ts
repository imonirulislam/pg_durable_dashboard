import { envNum } from './config.js';

// TTL cache with single-flight in front of the df.* reads: load scales with open
// tabs, so several viewers asking the same question share one query.
const DEFAULT_TTL = envNum('CACHE_TTL_MS', 2000);

// ?label=... means callers can invent keys.
const MAX_ENTRIES = 500;

interface Entry {
  promise: Promise<unknown>;
  pending: boolean;
  expires: number;
}

export interface CachedResult<T> {
  data: T;
  fromCache: boolean;
}

const entries = new Map<string, Entry>();

function sweep(limit: number): void {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (!entry.pending && entry.expires <= now) entries.delete(key);
  }
  // Still full of live keys: drop oldest-inserted first.
  while (entries.size > limit) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Concurrent callers for one key share a single in-flight query. */
export async function cached<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL
): Promise<CachedResult<T>> {
  if (ttlMs <= 0) return { data: await loader(), fromCache: false };

  const existing = entries.get(key);
  if (existing && (existing.pending || existing.expires > Date.now())) {
    return { data: (await existing.promise) as T, fromCache: true };
  }

  // Leave room for the insert below, so MAX_ENTRIES is a real ceiling.
  if (entries.size >= MAX_ENTRIES) sweep(MAX_ENTRIES - 1);

  const promise = loader();
  const entry: Entry = { promise, pending: true, expires: 0 };
  entries.set(key, entry);

  try {
    const data = await promise;
    entry.pending = false;
    entry.expires = Date.now() + ttlMs;
    return { data, fromCache: false };
  } catch (err) {
    // Never cache failures; a brief outage should recover on the next poll.
    entries.delete(key);
    throw err;
  }
}

export function cacheStats(): {
  entries: number;
  ttlMs: number;
  maxEntries: number;
} {
  return { entries: entries.size, ttlMs: DEFAULT_TTL, maxEntries: MAX_ENTRIES };
}
