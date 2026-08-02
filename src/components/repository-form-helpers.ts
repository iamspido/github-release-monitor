import { MAX_PROVIDER_RESOLUTION_BATCH_SIZE } from "@/lib/repositories/provider-resolution-limits";
import type { Repository } from "@/types";

export type ProviderChoiceCandidate = {
  provider: "github" | "codeberg" | "forgejo" | "gitlab";
  providerHost?: string;
  providerBaseUrl?: string;
  canonicalRepoUrl: string;
};

export interface RepositoryImportStats {
  newCount: number;
  existingCount: number;
  skippedImages?: number;
}

export const initialRepositoryFormState = {
  success: false,
  toast: undefined,
  error: undefined,
};

const providerChoiceOrder: Record<ProviderChoiceCandidate["provider"], number> =
  {
    github: 0,
    gitlab: 1,
    codeberg: 2,
    forgejo: 3,
  };

export const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

export const isOwnerRepoShorthand = (value: string) =>
  /^[a-z0-9-._]+\/[a-z0-9-._]+$/i.test(value.trim());

export function getProviderResolutionBatches(lines: string[]): string[][] {
  const shorthandInputs = [...new Set(lines.filter(isOwnerRepoShorthand))];
  const batches: string[][] = [];

  for (
    let offset = 0;
    offset < shorthandInputs.length;
    offset += MAX_PROVIDER_RESOLUTION_BATCH_SIZE
  ) {
    batches.push(
      shorthandInputs.slice(
        offset,
        offset + MAX_PROVIDER_RESOLUTION_BATCH_SIZE,
      ),
    );
  }

  return batches;
}

export const isComposeFileName = (value: string) => /\.(ya?ml)$/i.test(value);

export function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== "string") {
        reject(new Error("file_read_failed"));
        return;
      }
      resolve(content);
    };
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsText(file);
  });
}

export function parseRepositoryImportJson(content: string): Repository[] {
  const importedData = JSON.parse(content) as unknown;

  if (!Array.isArray(importedData)) {
    throw new Error("invalid_format");
  }

  const isValidFormat = importedData.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      "url" in item,
  );

  if (!isValidFormat) {
    throw new Error("invalid_format");
  }

  return importedData as Repository[];
}

export const getRepositoryDisplayName = (repo: Repository) => {
  if (repo.id.startsWith("github:")) return repo.id.slice("github:".length);
  if (repo.id.startsWith("codeberg:")) return repo.id.slice("codeberg:".length);
  if (repo.id.startsWith("forgejo:")) return repo.id.slice("forgejo:".length);
  if (repo.id.startsWith("gitlab:")) return repo.id.slice("gitlab:".length);
  return repo.id;
};

export const getRepositoryProviderName = (repo: Repository) => {
  if (repo.id.startsWith("github:")) return "GitHub";
  if (repo.id.startsWith("codeberg:")) return "Codeberg";
  if (repo.id.startsWith("forgejo:")) return "Forgejo";
  if (repo.id.startsWith("gitlab:")) return "GitLab";
  return null;
};

export function sortProviderChoiceCandidates(
  candidates: ProviderChoiceCandidate[],
) {
  return [...candidates].sort(
    (a, b) =>
      providerChoiceOrder[a.provider] - providerChoiceOrder[b.provider] ||
      (a.providerBaseUrl ?? a.providerHost ?? "").localeCompare(
        b.providerBaseUrl ?? b.providerHost ?? "",
      ),
  );
}

export function getRepositoryImportStats(
  importedData: Repository[],
  currentRepositoryIds: ReadonlySet<string>,
  skippedImages?: number,
): RepositoryImportStats {
  const newRepos = importedData.filter(
    (repo) => !currentRepositoryIds.has(repo.id),
  );
  return {
    newCount: newRepos.length,
    existingCount: importedData.length - newRepos.length,
    skippedImages,
  };
}
