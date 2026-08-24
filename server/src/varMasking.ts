import type { Variable, VarRow } from './types.js';

// df.vars has no sensitivity flag of its own — every value is plaintext,
// whether it's a base URL or an API key. This is a name-based heuristic, not a
// guarantee: a secret named without one of these words still ships in plain
// text, and a harmless var that happens to match gets needlessly hidden.
const SENSITIVE_NAME = /key|secret|token|password|passwd|credential|auth/i;

/**
 * The one place a secret could leak to the browser, kept free of the
 * SQLite-backed connection store so it can be tested without loading it.
 */
export function toVariable(row: VarRow): Variable {
  const sensitive = SENSITIVE_NAME.test(row.name);
  return {
    name: row.name,
    owner: row.owner,
    sensitive,
    value: sensitive ? null : row.value,
    length: row.value?.length ?? 0,
  };
}
