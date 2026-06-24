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
