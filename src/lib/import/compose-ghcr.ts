import { getLocale, getTranslations } from "next-intl/server";
import { parse as parseYaml } from "yaml";
import {
  fetchJsonResponseWithRetry,
  fetchWithRetry,
} from "@/lib/releases/fetch";
import { parseSupportedRepoUrl } from "@/lib/repositories/providers";
import {
  getRestrictedActionError,
  isRestrictedActionAllowed,
  log,
} from "@/lib/server-action-helpers";
import type { Repository } from "@/types";

export type ComposeImportSkipReason =
  | "unsupported_registry"
  | "missing_source_label"
  | "invalid_source_url"
  | "metadata_unavailable";

export type ComposeImportSkipStats = Record<ComposeImportSkipReason, number>;

type GhcrImageReference = {
  repository: string;
  reference: string;
};

type GhcrDescriptor = {
  mediaType?: string;
  digest?: string;
  platform?: {
    architecture?: string;
    os?: string;
  };
  annotations?: Record<string, string>;
};

const GHCR_IMAGE_SOURCE_LABEL = "org.opencontainers.image.source";
const GHCR_MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const GHCR_CONFIG_ACCEPT = [
  "application/vnd.oci.image.config.v1+json",
  "application/vnd.docker.container.image.v1+json",
].join(", ");

function createComposeImportSkipStats(): ComposeImportSkipStats {
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
    if (key === "image" && typeof child === "string") {
      images.push(child);
    }
    collectYamlImageValues(child, images, seen);
  }

  return images;
}

function parseGhcrImageReference(image: string): GhcrImageReference | null {
  const trimmed = image.trim();
  const match = trimmed.match(
    /^ghcr\.io\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)(?:(?::([\w][\w.-]{0,127}))|@([A-Za-z][A-Za-z0-9+._-]*:[A-Za-z0-9=_-]+))?$/i,
  );
  if (!match) return null;

  const owner = match[1]?.toLowerCase();
  const name = match[2]?.toLowerCase();
  if (!owner || !name) return null;

  return {
    repository: `${owner}/${name}`,
    reference: match[4] ?? match[3] ?? "latest",
  };
}

function parseBearerChallenge(
  header: string | null,
): { realm: string; service?: string; scope?: string } | null {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;

  const params: Record<string, string> = {};
  const regex = /([a-zA-Z_][a-zA-Z0-9_-]*)="([^"]*)"/g;
  for (const match of header.matchAll(regex)) {
    const key = match[1];
    const value = match[2];
    if (key && value) params[key] = value;
  }

  if (!params.realm) return null;
  return {
    realm: params.realm,
    service: params.service,
    scope: params.scope,
  };
}

async function fetchGhcrResponse(
  url: string,
  accept: string,
  description: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  const firstResponse = await fetchWithRetry(
    url,
    { headers, cache: "no-store" },
    { description },
  );
  if (firstResponse.status !== 401) return firstResponse;

  const challenge = parseBearerChallenge(
    firstResponse.headers.get("www-authenticate"),
  );
  if (!challenge) return firstResponse;

  const tokenUrl = new URL(challenge.realm);
  if (challenge.service)
    tokenUrl.searchParams.set("service", challenge.service);
  if (challenge.scope) tokenUrl.searchParams.set("scope", challenge.scope);

  const { response, data } = await fetchJsonResponseWithRetry<{
    token?: string;
    access_token?: string;
  }>(
    tokenUrl.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "GitHubReleaseMonitorApp",
      },
      cache: "no-store",
    },
    { description: `${description} auth token` },
  );
  const token = data?.token ?? data?.access_token;
  if (!response.ok || !token) return firstResponse;

  return fetchWithRetry(
    url,
    {
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
    { description: `${description} authenticated` },
  );
}

async function fetchGhcrJson<T>(
  repository: string,
  resource: "manifests" | "blobs",
  reference: string,
  accept: string,
): Promise<T | null> {
  const url = `https://ghcr.io/v2/${repository}/${resource}/${reference}`;
  const response = await fetchGhcrResponse(
    url,
    accept,
    `GHCR ${resource} ${repository}@${reference}`,
  );
  if (!response.ok) return null;

  try {
    return (await response.json()) as T;
  } catch (error) {
    log.warn(`Failed to parse GHCR ${resource} JSON for ${repository}.`, error);
    return null;
  }
}

function readStringProperty(value: unknown, property: string): string | null {
  if (!isPlainRecord(value)) return null;
  const candidate = value[property];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function readSourceLabel(metadata: unknown): string | null {
  if (!isPlainRecord(metadata)) return null;

  const fromAnnotations = readStringProperty(
    metadata.annotations,
    GHCR_IMAGE_SOURCE_LABEL,
  );
  if (fromAnnotations) return fromAnnotations;

  const config = isPlainRecord(metadata.config) ? metadata.config : null;
  const fromConfigLabels = readStringProperty(
    config?.Labels,
    GHCR_IMAGE_SOURCE_LABEL,
  );
  if (fromConfigLabels) return fromConfigLabels;

  const containerConfig = isPlainRecord(metadata.container_config)
    ? metadata.container_config
    : null;
  return readStringProperty(containerConfig?.Labels, GHCR_IMAGE_SOURCE_LABEL);
}

function getManifestDescriptors(manifest: unknown): GhcrDescriptor[] {
  if (!isPlainRecord(manifest) || !Array.isArray(manifest.manifests)) {
    return [];
  }

  return manifest.manifests.filter(isPlainRecord).map((descriptor) => ({
    mediaType:
      typeof descriptor.mediaType === "string"
        ? descriptor.mediaType
        : undefined,
    digest:
      typeof descriptor.digest === "string" ? descriptor.digest : undefined,
    platform: isPlainRecord(descriptor.platform)
      ? {
          architecture:
            typeof descriptor.platform.architecture === "string"
              ? descriptor.platform.architecture
              : undefined,
          os:
            typeof descriptor.platform.os === "string"
              ? descriptor.platform.os
              : undefined,
        }
      : undefined,
    annotations: isPlainRecord(descriptor.annotations)
      ? Object.fromEntries(
          Object.entries(descriptor.annotations).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined,
  }));
}

function selectGhcrManifestDescriptor(
  descriptors: GhcrDescriptor[],
): GhcrDescriptor | null {
  const withDigest = descriptors.filter((descriptor) => descriptor.digest);
  if (withDigest.length === 0) return null;

  const runnable = withDigest.filter(
    (descriptor) => descriptor.platform?.os !== "unknown",
  );
  const candidates = runnable.length > 0 ? runnable : withDigest;

  return (
    candidates.find(
      (descriptor) =>
        descriptor.platform?.os === "linux" &&
        descriptor.platform.architecture === "amd64",
    ) ??
    candidates.find((descriptor) => descriptor.platform?.os === "linux") ??
    candidates[0] ??
    null
  );
}

async function getGhcrImageManifestSource(
  repository: string,
  manifest: unknown,
): Promise<string | "metadata_unavailable" | null> {
  const manifestSource = readSourceLabel(manifest);
  if (manifestSource) return manifestSource;

  if (!isPlainRecord(manifest) || !isPlainRecord(manifest.config)) {
    return null;
  }

  const configDigest = manifest.config.digest;
  if (typeof configDigest !== "string" || !configDigest) return null;

  const config = await fetchGhcrJson<unknown>(
    repository,
    "blobs",
    configDigest,
    GHCR_CONFIG_ACCEPT,
  );
  if (!config) return "metadata_unavailable";

  return readSourceLabel(config);
}

async function resolveGhcrImageSourceUrl(
  imageRef: GhcrImageReference,
): Promise<string | ComposeImportSkipReason> {
  const rootManifest = await fetchGhcrJson<unknown>(
    imageRef.repository,
    "manifests",
    imageRef.reference,
    GHCR_MANIFEST_ACCEPT,
  );
  if (!rootManifest) return "metadata_unavailable";

  const rootSource = readSourceLabel(rootManifest);
  if (rootSource) return rootSource;

  const descriptors = getManifestDescriptors(rootManifest);
  if (descriptors.length === 0) {
    const manifestSource = await getGhcrImageManifestSource(
      imageRef.repository,
      rootManifest,
    );
    return manifestSource ?? "missing_source_label";
  }

  const descriptor = selectGhcrManifestDescriptor(descriptors);
  const descriptorSource = readSourceLabel(descriptor);
  if (descriptorSource) return descriptorSource;

  if (!descriptor?.digest) return "metadata_unavailable";

  const childManifest = await fetchGhcrJson<unknown>(
    imageRef.repository,
    "manifests",
    descriptor.digest,
    GHCR_MANIFEST_ACCEPT,
  );
  if (!childManifest) return "metadata_unavailable";

  const childSource = await getGhcrImageManifestSource(
    imageRef.repository,
    childManifest,
  );
  return childSource ?? "missing_source_label";
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

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(content);
  } catch (error) {
    log.warn(`Failed to parse Compose import file ${fileName}.`, error);
    return {
      success: false,
      repositories: [],
      skipped,
      error: t("toast_import_error_parsing"),
    };
  }

  const imageValues = Array.from(new Set(collectYamlImageValues(parsedYaml)));
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

    if (
      sourceUrlOrReason === "metadata_unavailable" ||
      sourceUrlOrReason === "missing_source_label" ||
      sourceUrlOrReason === "invalid_source_url" ||
      sourceUrlOrReason === "unsupported_registry"
    ) {
      skipped[sourceUrlOrReason]++;
      continue;
    }

    const parsedSource = parseSupportedRepoUrl(sourceUrlOrReason);
    if (!parsedSource || parsedSource.provider !== "github") {
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
