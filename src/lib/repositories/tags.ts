export const MAX_REPOSITORY_TAGS = 20;
export const MAX_REPOSITORY_TAG_LENGTH = 40;

export type RepositoryTagsValidationError =
  | "not_an_array"
  | "not_a_string"
  | "too_many"
  | "too_long"
  | "invalid_characters";

export type RepositoryTagsValidationResult =
  | { success: true; tags: string[] }
  | { success: false; error: RepositoryTagsValidationError };

const INVALID_TAG_CHARACTER_PATTERN = /[,\p{Cc}\p{Zl}\p{Zp}]/u;

function hasInvalidTagCharacters(value: string): boolean {
  return INVALID_TAG_CHARACTER_PATTERN.test(value);
}

export function normalizeRepositoryTag(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeRepositoryTags(
  value: unknown,
): RepositoryTagsValidationResult {
  if (!Array.isArray(value)) {
    return { success: false, error: "not_an_array" };
  }

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const valueEntry of value) {
    if (typeof valueEntry !== "string") {
      return { success: false, error: "not_a_string" };
    }

    const compatibilityNormalizedEntry = valueEntry.normalize("NFKC");
    if (hasInvalidTagCharacters(compatibilityNormalizedEntry)) {
      return { success: false, error: "invalid_characters" };
    }

    const tag = normalizeRepositoryTag(compatibilityNormalizedEntry);
    if (!tag) continue;
    if (Array.from(tag).length > MAX_REPOSITORY_TAG_LENGTH) {
      return { success: false, error: "too_long" };
    }
    if (seen.has(tag)) continue;

    seen.add(tag);
    tags.push(tag);
  }

  if (tags.length > MAX_REPOSITORY_TAGS) {
    return { success: false, error: "too_many" };
  }

  return { success: true, tags };
}

export function moveRepositoryTag(
  tags: readonly string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (
    fromIndex < 0 ||
    fromIndex >= tags.length ||
    toIndex < 0 ||
    toIndex >= tags.length ||
    fromIndex === toIndex
  ) {
    return tags as string[];
  }

  const reorderedTags = [...tags];
  const [tag] = reorderedTags.splice(fromIndex, 1);
  reorderedTags.splice(toIndex, 0, tag);
  return reorderedTags;
}

export function repositoryMatchesTagFilter(
  repositoryTags: readonly string[],
  selectedTags: ReadonlySet<string>,
  includeUntagged: boolean,
): boolean {
  if (selectedTags.size === 0 && !includeUntagged) return true;
  if (includeUntagged && repositoryTags.length === 0) return true;
  return repositoryTags.some((tag) => selectedTags.has(tag));
}
