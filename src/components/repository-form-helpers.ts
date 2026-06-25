import type { Repository } from "@/types";

export type ProviderChoiceCandidate = {
  provider: "github" | "codeberg" | "gitlab";
  providerHost?: string;
  canonicalRepoUrl: string;
};

export const initialRepositoryFormState = {
  success: false,
  toast: undefined,
  error: undefined,
};

export const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

export const isOwnerRepoShorthand = (value: string) =>
  /^[a-z0-9-._]+\/[a-z0-9-._]+$/i.test(value.trim());

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
  if (repo.id.startsWith("gitlab:")) return repo.id.slice("gitlab:".length);
  return repo.id;
};

export const getRepositoryProviderName = (repo: Repository) => {
  if (repo.id.startsWith("github:")) return "GitHub";
  if (repo.id.startsWith("codeberg:")) return "Codeberg";
  if (repo.id.startsWith("gitlab:")) return "GitLab";
  return null;
};
