/**
 * Reads an environment secret without changing its bytes. Whitespace-only
 * values are treated as unset, but meaningful leading, trailing, or internal
 * whitespace is preserved so credentials are never silently rewritten.
 */
export function readSecretEnvValue(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}
