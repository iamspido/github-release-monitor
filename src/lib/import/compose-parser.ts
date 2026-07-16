import { parse as parseYaml } from "yaml";

export type ComposeImportSkipReason =
  | "unsupported_registry"
  | "missing_source_label"
  | "invalid_source_url"
  | "metadata_unavailable";

export type ComposeImportSkipStats = Record<ComposeImportSkipReason, number>;

export function createComposeImportSkipStats(): ComposeImportSkipStats {
  return {
    unsupported_registry: 0,
    missing_source_label: 0,
    invalid_source_url: 0,
    metadata_unavailable: 0,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectYamlImageValues(
  value: unknown,
  images: string[] = [],
  seen = new WeakSet<object>(),
): string[] {
  if (Array.isArray(value)) {
    if (seen.has(value)) return images;
    seen.add(value);
    for (const item of value) collectYamlImageValues(item, images, seen);
    return images;
  }
  if (!isPlainRecord(value)) return images;
  if (seen.has(value)) return images;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (key === "image" && typeof child === "string") images.push(child);
    collectYamlImageValues(child, images, seen);
  }
  return images;
}

export function parseComposeImageValues(content: string): string[] {
  const parsed = parseYaml(content) as unknown;
  return Array.from(new Set(collectYamlImageValues(parsed)));
}
