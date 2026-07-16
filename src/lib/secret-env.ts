/**
 * Reads an environment secret without changing its bytes. Whitespace-only
 * values are treated as unset, but meaningful leading, trailing, or internal
 * whitespace is preserved so credentials are never silently rewritten.
 */
export function readSecretEnvValue(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

/**
 * Normalizes provider access tokens for compatibility with environment files
 * and secret stores that wrap values in quotes or inject whitespace. Provider
 * tokens do not support meaningful whitespace, unlike passwords and client
 * secrets handled by readSecretEnvValue.
 */
export function normalizeAccessTokenEnvValue(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const isWrappedInQuotes =
    (first === '"' && last === '"') || (first === "'" && last === "'");
  const raw = isWrappedInQuotes ? trimmed.slice(1, -1).trim() : trimmed;
  const compact = raw.replace(/\s+/g, "");
  return compact || null;
}
