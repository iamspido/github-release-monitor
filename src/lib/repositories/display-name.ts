export const MAX_REPOSITORY_DISPLAY_NAME_LENGTH = 100;

export type RepositoryDisplayNameNormalizationResult =
  | { success: true; displayName: string | undefined }
  | { success: false };

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function normalizeRepositoryDisplayName(
  value: unknown,
): RepositoryDisplayNameNormalizationResult {
  if (value === undefined || value === null) {
    return { success: true, displayName: undefined };
  }
  if (typeof value !== "string") return { success: false };

  const displayName = value.trim();
  if (!displayName) return { success: true, displayName: undefined };
  if (
    displayName.length > MAX_REPOSITORY_DISPLAY_NAME_LENGTH ||
    containsControlCharacter(displayName)
  ) {
    return { success: false };
  }

  return { success: true, displayName };
}
