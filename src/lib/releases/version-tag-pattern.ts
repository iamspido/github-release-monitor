export type VersionTagPatternValidationError =
  | "invalid"
  | "missing_version_group"
  | null;

export function validateVersionTagPattern(
  value: string | null | undefined,
): VersionTagPatternValidationError {
  const pattern = value?.trim();
  if (!pattern) return null;

  try {
    // The empty alternative lets us inspect named groups without needing a
    // tag that happens to match the user-provided expression.
    const groups = new RegExp(`(?:${pattern})|`).exec("")?.groups;
    return groups && Object.hasOwn(groups, "version")
      ? null
      : "missing_version_group";
  } catch {
    return "invalid";
  }
}
