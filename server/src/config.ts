/**
 * Blank counts as unset. `-e VAR=` and compose's `VAR: ${VAR:-}` both arrive as
 * '', where `??` wouldn't fall back and `Number('')` is 0.
 */
export function envStr(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function envNum(name: string, fallback: number): number {
  const raw = envStr(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`${name}="${raw}" is not a number — using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

/** Comma-separated list, blanks dropped. */
export function envList(name: string): string[] {
  return (envStr(name) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
