import { getLocale, getTranslations } from "next-intl/server";
import {
  type ComposeImportSkipReason,
  type ComposeImportSkipStats,
  createComposeImportSkipStats,
  parseComposeImageValues,
} from "@/lib/import/compose-parser";
import {
  parseGhcrImageReference,
  resolveGhcrImageSourceUrl,
} from "@/lib/import/ghcr-client";
import { parseSupportedRepoUrl } from "@/lib/repositories/providers";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
  log,
} from "@/lib/server-action-helpers";
import type { Repository } from "@/types";

export type { ComposeImportSkipReason, ComposeImportSkipStats };

function isSkipReason(value: string): value is ComposeImportSkipReason {
  return (
    value === "metadata_unavailable" ||
    value === "missing_source_label" ||
    value === "invalid_source_url" ||
    value === "unsupported_registry"
  );
}

export async function previewComposeImportAction(
  fileName: string,
  content: string,
): Promise<{
  success: boolean;
  repositories: Repository[];
  skipped: ComposeImportSkipStats;
  error?: string;
}> {
  const skipped = createComposeImportSkipStats();
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "RepositoryForm" });
  if (!(await isRestrictedActionAllowed())) {
    return {
      success: false,
      repositories: [],
      skipped,
      error: await getRestrictedActionError(),
    };
  }
  if (typeof content !== "string" || !content.trim()) {
    return {
      success: false,
      repositories: [],
      skipped,
      error: t("toast_import_error_parsing"),
    };
  }

  let imageValues: string[];
  try {
    imageValues = parseComposeImageValues(content);
  } catch (error) {
    log.warn(`Failed to parse Compose import file ${fileName}.`, error);
    return {
      success: false,
      repositories: [],
      skipped,
      error: t("toast_import_error_parsing"),
    };
  }

  const repositories = new Map<string, Repository>();
  for (const imageValue of imageValues) {
    const imageRef = parseGhcrImageReference(imageValue);
    if (!imageRef) {
      skipped.unsupported_registry++;
      continue;
    }

    let sourceUrlOrReason: string | ComposeImportSkipReason;
    try {
      sourceUrlOrReason = await resolveGhcrImageSourceUrl(imageRef);
    } catch (error) {
      log.warn(`Failed to read GHCR metadata for ${imageValue}.`, error);
      skipped.metadata_unavailable++;
      continue;
    }
    if (isSkipReason(sourceUrlOrReason)) {
      skipped[sourceUrlOrReason]++;
      continue;
    }

    const parsedSource = parseSupportedRepoUrl(sourceUrlOrReason);
    if (parsedSource?.provider !== "github") {
      skipped.invalid_source_url++;
      continue;
    }
    repositories.set(parsedSource.id, {
      id: parsedSource.id,
      url: parsedSource.canonicalRepoUrl,
    });
  }

  log.info(
    `Compose import preview for ${fileName}: images=${imageValues.length} repos=${repositories.size} skipped=${JSON.stringify(skipped)}`,
  );
  return {
    success: true,
    repositories: Array.from(repositories.values()),
    skipped,
  };
}
