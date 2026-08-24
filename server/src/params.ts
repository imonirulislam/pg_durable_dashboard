/**
 * `?status[x]=y` parses to an object, and String() on it yields
 * "[object Object]" — which would reach Postgres as a filter or a cache key.
 */
export function queryParam(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
