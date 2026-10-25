import {
  compileUntrustedPattern,
  type UntrustedPattern,
} from "@/lib/untrusted-pattern";

export type VersionTagPatternValidationError =
  | "invalid"
  | "missing_version_group"
  | null;

export function validateVersionTagPattern(
  value: string | null | undefined,
): VersionTagPatternValidationError {
  const pattern = value?.trim();
  if (!pattern) return null;

  const compiled = compileUntrustedPattern(pattern, "", { captures: true });
  if (compiled.error) return "invalid";
  return compiled.pattern.hasGroup("version") ? null : "missing_version_group";
}

export function compileVersionTagPattern(
  value: string | null | undefined,
): UntrustedPattern | null {
  const pattern = value?.trim();
  if (!pattern) return null;
  const compiled = compileUntrustedPattern(pattern, "", { captures: true });
  return compiled.pattern?.hasGroup("version") ? compiled.pattern : null;
}
