import { inflateSync } from "node:zlib";
import { getTranslations } from "next-intl/server";
import { buildGitlabAuthChain } from "@/lib/releases/auth-chains";
import {
  fetchJsonResponseWithRetryAuthChain,
  fetchResponseWithRetryAuthChain,
} from "@/lib/releases/fetch";
import {
  isPreReleaseByTagName,
  resolveEffectiveRepoFilters,
} from "@/lib/releases/filters";
import type {
  LatestReleaseFetchResult,
  RepoSettingsForFetch,
} from "@/lib/releases/types";
import {
  type GitlabAuthConfig,
  type GitlabDeployToken,
  getGitlabAuthForHost,
} from "@/lib/repositories/providers";
import { log } from "@/lib/server-action-helpers";
import type { AppSettings, GithubRelease } from "@/types";
import { allPreReleaseTypes } from "@/types";

type GitlabReleaseApi = {
  name?: string | null;
  tag_name?: string | null;
  description?: string | null;
  created_at?: string | null;
  released_at?: string | null;
  upcoming_release?: boolean | null;
};

type GitlabTagApi = {
  name: string;
  message?: string | null;
  release?: {
    description?: string | null;
  } | null;
  commit?: {
    id?: string | null;
    message?: string | null;
    created_at?: string | null;
    committed_date?: string | null;
    authored_date?: string | null;
  } | null;
};

type GitlabCommitApi = {
  message?: string | null;
  committed_date?: string | null;
  authored_date?: string | null;
  created_at?: string | null;
};

type ParsedTagSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

type GitSmartTagRef = {
  name: string;
  objectId: string;
  peeledObjectId?: string;
};

type GitTransportTag = {
  name: string;
  commitSha: string | null;
};

function hashStringToId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function extractGitlabCommitDate(
  commit:
    | {
        committed_date?: string | null;
        authored_date?: string | null;
        created_at?: string | null;
      }
    | null
    | undefined,
): string | undefined {
  if (!commit) return undefined;
  if (typeof commit.committed_date === "string") return commit.committed_date;
  if (typeof commit.authored_date === "string") return commit.authored_date;
  if (typeof commit.created_at === "string") return commit.created_at;
  return undefined;
}

function parseTagSemver(tagName: string): ParsedTagSemver | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      tagName.trim(),
    );
  if (!match) return null;

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? null,
  };
}

function compareTagNamesByRecency(a: string, b: string): number {
  const aSemver = parseTagSemver(a);
  const bSemver = parseTagSemver(b);

  if (aSemver && bSemver) {
    if (aSemver.major !== bSemver.major) return aSemver.major - bSemver.major;
    if (aSemver.minor !== bSemver.minor) return aSemver.minor - bSemver.minor;
    if (aSemver.patch !== bSemver.patch) return aSemver.patch - bSemver.patch;

    // Stable release sorts after prerelease for the same version.
    if (!aSemver.prerelease && bSemver.prerelease) return 1;
    if (aSemver.prerelease && !bSemver.prerelease) return -1;
    if (aSemver.prerelease && bSemver.prerelease) {
      return aSemver.prerelease.localeCompare(bSemver.prerelease, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    return 0;
  }

  if (aSemver && !bSemver) return 1;
  if (!aSemver && bSemver) return -1;

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function parseGitSmartHttpTagRefs(payload: Uint8Array): GitSmartTagRef[] {
  const refsByName = new Map<string, GitSmartTagRef>();
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 4 <= payload.length) {
    const lengthHex = decoder.decode(payload.subarray(offset, offset + 4));
    if (!/^[0-9a-fA-F]{4}$/.test(lengthHex)) {
      break;
    }

    const packetLength = Number.parseInt(lengthHex, 16);
    offset += 4;

    if (packetLength === 0) {
      continue;
    }

    const dataLength = packetLength - 4;
    if (dataLength <= 0 || offset + dataLength > payload.length) {
      break;
    }

    const packetData = decoder.decode(
      payload.subarray(offset, offset + dataLength),
    );
    offset += dataLength;

    const withoutTrailingNewline = packetData.endsWith("\n")
      ? packetData.slice(0, -1)
      : packetData;
    if (withoutTrailingNewline.startsWith("# service=")) {
      continue;
    }

    const spaceIndex = withoutTrailingNewline.indexOf(" ");
    if (spaceIndex <= 0) {
      continue;
    }

    const objectId = withoutTrailingNewline.slice(0, spaceIndex).trim();
    if (!/^[0-9a-fA-F]{40,64}$/.test(objectId)) {
      continue;
    }

    let refName = withoutTrailingNewline.slice(spaceIndex + 1).trim();
    const nulIndex = refName.indexOf("\u0000");
    if (nulIndex !== -1) {
      refName = refName.slice(0, nulIndex);
    }
    if (!refName.startsWith("refs/tags/")) {
      continue;
    }

    const rawTagName = refName.slice("refs/tags/".length);
    const isPeeled = rawTagName.endsWith("^{}");
    const tagName = isPeeled ? rawTagName.slice(0, -3) : rawTagName;
    if (!tagName) {
      continue;
    }

    const existing = refsByName.get(tagName) ?? { name: tagName, objectId };
    if (isPeeled) {
      existing.peeledObjectId = objectId;
    } else {
      existing.objectId = objectId;
    }
    refsByName.set(tagName, existing);
  }

  return [...refsByName.values()];
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function encodeGitPktLine(data: string): Uint8Array {
  const encoder = new TextEncoder();
  const payload = encoder.encode(data);
  const header = encoder.encode(
    (payload.length + 4).toString(16).padStart(4, "0"),
  );
  return concatUint8Arrays([header, payload]);
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function extractPackPayloadFromUploadPackResponse(
  payload: Uint8Array,
): Uint8Array | null {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const packSignature = encoder.encode("PACK");
  const packChunks: Uint8Array[] = [];
  let offset = 0;

  while (offset + 4 <= payload.length) {
    const lengthHex = decoder.decode(payload.subarray(offset, offset + 4));
    if (!/^[0-9a-fA-F]{4}$/.test(lengthHex)) {
      break;
    }

    const packetLength = Number.parseInt(lengthHex, 16);
    offset += 4;

    if (packetLength === 0) {
      continue;
    }

    const dataLength = packetLength - 4;
    if (dataLength <= 0 || offset + dataLength > payload.length) {
      break;
    }

    const packetData = payload.subarray(offset, offset + dataLength);
    offset += dataLength;

    if (packetData.length === 0) continue;

    const channel = packetData[0];
    if (channel === 1 && packetData.length > 1) {
      packChunks.push(packetData.subarray(1));
      continue;
    }

    if (channel === 2 || channel === 3) {
      continue;
    }

    const packIndex = indexOfBytes(packetData, packSignature);
    if (packIndex !== -1) {
      packChunks.push(packetData.subarray(packIndex));
    }
  }

  if (packChunks.length > 0) {
    return concatUint8Arrays(packChunks);
  }

  const directPackIndex = indexOfBytes(payload, packSignature);
  if (directPackIndex !== -1) {
    return payload.subarray(directPackIndex);
  }

  return null;
}

function parseGitTimestampToIso(headerLine: string): string | undefined {
  const timestampMatch = / (\d+) [+-]\d{4}$/.exec(headerLine);
  if (!timestampMatch) return undefined;

  const seconds = Number.parseInt(timestampMatch[1], 10);
  if (!Number.isFinite(seconds)) return undefined;

  return new Date(seconds * 1000).toISOString();
}

function parseGitObjectMetadata(
  objectType: number,
  objectText: string,
): { message?: string; date?: string } | null {
  if (objectType !== 1 && objectType !== 4) return null;

  const splitIndex = objectText.indexOf("\n\n");
  const headerPart =
    splitIndex === -1 ? objectText : objectText.slice(0, splitIndex);
  const messagePart =
    splitIndex === -1 ? "" : objectText.slice(splitIndex + 2).trim();

  let date: string | undefined;
  const headerPrefix = objectType === 1 ? "committer " : "tagger ";
  for (const line of headerPart.split("\n")) {
    if (line.startsWith(headerPrefix)) {
      date = parseGitTimestampToIso(line);
      break;
    }
  }

  const message = messagePart || undefined;
  if (!message && !date) return null;

  return { message, date };
}

function parseFirstGitObjectMetadataFromPack(
  packPayload: Uint8Array,
): { message?: string; date?: string } | null {
  const decoder = new TextDecoder();
  if (packPayload.length < 32) return null;
  if (decoder.decode(packPayload.subarray(0, 4)) !== "PACK") return null;

  const objectCount = new DataView(
    packPayload.buffer,
    packPayload.byteOffset + 8,
    4,
  ).getUint32(0, false);
  if (objectCount < 1) return null;

  let offset = 12;
  if (offset >= packPayload.length) return null;

  let headerByte = packPayload[offset];
  offset += 1;
  const objectType = (headerByte >> 4) & 0x07;
  while ((headerByte & 0x80) !== 0) {
    if (offset >= packPayload.length) return null;
    headerByte = packPayload[offset];
    offset += 1;
  }

  const compressedEnd = Math.max(offset, packPayload.length - 20);
  if (offset >= compressedEnd) return null;

  try {
    const inflated = inflateSync(packPayload.subarray(offset, compressedEnd));
    const objectText = decoder.decode(inflated);
    return parseGitObjectMetadata(objectType, objectText);
  } catch (error) {
    log.debug("Failed to parse git pack object for commit metadata:", error);
    return null;
  }
}

async function tryFetchGitlabCommitMetadataViaGitTransport(
  gitlabHost: string,
  projectPath: string,
  deployToken: GitlabDeployToken,
  commitSha: string,
): Promise<{ message?: string; date?: string } | null> {
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) return null;

  const encodedPath = projectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const uploadPackUrl = `https://${gitlabHost}/${encodedPath}.git/git-upload-pack`;

  const basicAuth = Buffer.from(
    `${deployToken.username}:${deployToken.token}`,
  ).toString("base64");
  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/x-git-upload-pack-result",
    "Content-Type": "application/x-git-upload-pack-request",
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  const payloads: Uint8Array[] = [
    concatUint8Arrays([
      encodeGitPktLine(`want ${commitSha} side-band-64k filter\n`),
      encodeGitPktLine("deepen 1\n"),
      encodeGitPktLine("filter tree:0\n"),
      new TextEncoder().encode("0000"),
      encodeGitPktLine("done\n"),
    ]),
    concatUint8Arrays([
      encodeGitPktLine(`want ${commitSha} side-band-64k\n`),
      new TextEncoder().encode("0000"),
      encodeGitPktLine("done\n"),
    ]),
  ];

  for (const payload of payloads) {
    const requestBody = Buffer.from(payload);
    const authChain = [
      {
        mode: "basic" as const,
        options: {
          method: "POST",
          body: requestBody,
          headers: {
            ...headersWithoutAuth,
            Authorization: `Basic ${basicAuth}`,
          },
          cache: "no-store" as const,
        },
      },
      {
        mode: "none" as const,
        options: {
          method: "POST",
          body: requestBody,
          headers: headersWithoutAuth,
          cache: "no-store" as const,
        },
      },
    ];

    const { response, mode } = await fetchResponseWithRetryAuthChain(
      uploadPackUrl,
      authChain,
      {
        description: `Git transport commit metadata for ${projectPath} (${commitSha.slice(0, 12)}) on ${gitlabHost}`,
      },
    );

    if (!response.ok) {
      log.debug(
        `Git transport commit metadata lookup failed for ${projectPath} on ${gitlabHost}: ${response.status} ${response.statusText} (auth=${mode})`,
      );
      continue;
    }

    const uploadPackResponse = new Uint8Array(await response.arrayBuffer());
    const packPayload =
      extractPackPayloadFromUploadPackResponse(uploadPackResponse);
    if (!packPayload) {
      continue;
    }

    const metadata = parseFirstGitObjectMetadataFromPack(packPayload);
    if (metadata) {
      return metadata;
    }
  }

  return null;
}

async function fetchGitlabTagsViaGitTransport(
  gitlabHost: string,
  projectPath: string,
  deployToken: GitlabDeployToken,
): Promise<GitTransportTag[] | null> {
  const encodedPath = projectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const gitRefsUrl = `https://${gitlabHost}/${encodedPath}.git/info/refs?service=git-upload-pack`;

  const basicAuth = Buffer.from(
    `${deployToken.username}:${deployToken.token}`,
  ).toString("base64");
  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/x-git-upload-pack-advertisement",
    "User-Agent": "GitHubReleaseMonitorApp",
  };

  const { response, mode } = await fetchResponseWithRetryAuthChain(
    gitRefsUrl,
    [
      {
        mode: "basic",
        options: {
          headers: {
            ...headersWithoutAuth,
            Authorization: `Basic ${basicAuth}`,
          },
          cache: "no-store",
        },
      },
      {
        mode: "none",
        options: { headers: headersWithoutAuth, cache: "no-store" },
      },
    ],
    {
      description: `Git transport tags for ${projectPath} on ${gitlabHost}`,
    },
  );

  if (!response.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await response.text();
    } catch {
      bodyText = undefined;
    }
    log.warn(
      `Git transport tags lookup failed for ${projectPath} on ${gitlabHost}: ${response.status} ${response.statusText} (auth=${mode})`,
      bodyText ? { bodyText } : undefined,
    );
    return null;
  }

  const payload = new Uint8Array(await response.arrayBuffer());
  const refs = parseGitSmartHttpTagRefs(payload);
  if (refs.length === 0) {
    return [];
  }

  const sortedTags = refs
    .map((ref) => ({
      name: ref.name,
      commitSha: ref.peeledObjectId ?? ref.objectId ?? null,
    }))
    .sort((a, b) => compareTagNamesByRecency(b.name, a.name));
  return sortedTags;
}

async function tryFetchGitlabCommitMessage(
  apiBaseUrl: string,
  headersWithoutAuth: Record<string, string>,
  auth: GitlabAuthConfig | null,
  refOrSha: string,
): Promise<{ message?: string; date?: string } | null> {
  const chain = buildGitlabAuthChain(headersWithoutAuth, auth);
  const url = `${apiBaseUrl}/repository/commits/${encodeURIComponent(refOrSha)}`;
  try {
    const { response, data } =
      await fetchJsonResponseWithRetryAuthChain<GitlabCommitApi>(url, chain, {
        description: `GitLab commit (${refOrSha})`,
      });
    if (!response.ok || !data) return null;

    const message = typeof data.message === "string" ? data.message : undefined;
    const date = extractGitlabCommitDate(data);

    if (!message && !date) return null;
    return { message, date };
  } catch {
    return null;
  }
}

export async function fetchLatestReleaseFromGitLab(
  gitlabHost: string,
  owner: string,
  repo: string,
  repoSettings: RepoSettingsForFetch,
  globalSettings: AppSettings,
  locale: string,
): Promise<LatestReleaseFetchResult> {
  const projectPath = `${owner}/${repo}`;
  log.info(`Fetching GitLab release for ${projectPath} on ${gitlabHost}`);
  const fetchedAtTimestamp = new Date().toISOString();

  const {
    effectiveReleaseChannels,
    effectivePreReleaseSubChannels,
    totalReleasesToFetch,
    effectiveIncludeRegex,
    effectiveExcludeRegex,
  } = resolveEffectiveRepoFilters(repoSettings, globalSettings);

  const GITLAB_API_BASE_URL = `https://${gitlabHost}/api/v4/projects/${encodeURIComponent(projectPath)}`;
  const MAX_PER_PAGE = 100;
  const pagesToFetch = Math.ceil(totalReleasesToFetch / MAX_PER_PAGE);
  let allReleases: GithubRelease[] = [];
  let newEtag: string | undefined;
  let fellBackToTagsAfterReleases404 = false;
  const gitTransportCommitShasByTag = new Map<string, string>();

  const headersWithoutAuth: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GitHubReleaseMonitorApp",
  };
  const gitlabAuth = getGitlabAuthForHost(gitlabHost);

  try {
    for (let page = 1; page <= pagesToFetch; page += 1) {
      const releasesOnThisPage = Math.min(
        MAX_PER_PAGE,
        totalReleasesToFetch - allReleases.length,
      );
      if (releasesOnThisPage <= 0) break;

      const url = `${GITLAB_API_BASE_URL}/releases?per_page=${releasesOnThisPage}&page=${page}`;

      const currentHeadersWithoutAuth = { ...headersWithoutAuth };
      if (page === 1 && repoSettings.etag) {
        currentHeadersWithoutAuth["If-None-Match"] = repoSettings.etag;
      }

      const chain = buildGitlabAuthChain(currentHeadersWithoutAuth, gitlabAuth);

      const { response, data: pageReleases } =
        await fetchJsonResponseWithRetryAuthChain<GitlabReleaseApi[]>(
          url,
          chain,
          {
            description: `GitLab releases for ${projectPath} page ${page}`,
          },
        );

      if (page === 1) {
        newEtag = response.headers.get("etag") || undefined;
        if (response.status === 304) {
          log.info(
            `[ETag] No changes for gitlab:${gitlabHost}/${projectPath}.`,
          );
          return {
            release: null,
            error: { type: "not_modified" },
            newEtag: repoSettings.etag,
          };
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          if (gitlabAuth?.deployToken && !gitlabAuth.accessToken) {
            log.warn(
              `GitLab releases endpoint returned 404 for ${projectPath} on ${gitlabHost} with deploy token auth. Falling back to tags endpoint.`,
            );
            fellBackToTagsAfterReleases404 = true;
            break;
          }
          log.error(
            `GitLab API error for ${projectPath}: Not Found (404). The repository may not exist or is private.`,
          );
          return { release: null, error: { type: "repo_not_found" }, newEtag };
        }
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get("retry-after"))
        ) {
          const retryAfter = response.headers.get("retry-after") ?? "N/A";
          const remaining =
            response.headers.get("ratelimit-remaining") ?? "N/A";
          const reset = response.headers.get("ratelimit-reset") ?? "N/A";
          log.error(
            `GitLab API rate limit exceeded for ${projectPath}. Remaining: ${remaining}, Reset: ${reset}, Retry-After: ${retryAfter}.`,
          );
          return { release: null, error: { type: "rate_limit" }, newEtag };
        }

        log.error(
          `GitLab API error for ${projectPath}: ${response.status} ${response.statusText}`,
        );
        return { release: null, error: { type: "api_error" }, newEtag };
      }

      if (!pageReleases) {
        throw new Error(
          `GitLab API returned an empty body for ${projectPath} releases page ${page}.`,
        );
      }

      allReleases = [
        ...allReleases,
        ...pageReleases
          .map((release) => {
            const tagName =
              typeof release.tag_name === "string" ? release.tag_name : null;
            if (!tagName) return null;

            const createdAt =
              typeof release.created_at === "string"
                ? release.created_at
                : typeof release.released_at === "string"
                  ? release.released_at
                  : fetchedAtTimestamp;

            const publishedAt =
              typeof release.released_at === "string"
                ? release.released_at
                : typeof release.created_at === "string"
                  ? release.created_at
                  : null;

            const mapped: GithubRelease = {
              id: hashStringToId(tagName),
              html_url: `https://${gitlabHost}/${projectPath}/-/releases/${encodeURIComponent(tagName)}`,
              tag_name: tagName,
              name: typeof release.name === "string" ? release.name : null,
              body:
                typeof release.description === "string"
                  ? release.description
                  : null,
              created_at: createdAt,
              published_at: publishedAt,
              prerelease: false,
              draft: !!release.upcoming_release,
            };
            return mapped;
          })
          .filter((release): release is GithubRelease => release !== null),
      ];

      if (pageReleases.length < releasesOnThisPage) {
        break;
      }
    }

    if (allReleases.length === 0) {
      if (fellBackToTagsAfterReleases404) {
        log.info(
          `Falling back to tags for ${projectPath} after releases endpoint 404.`,
        );
      } else {
        log.info(
          `No formal releases found for ${projectPath}. Falling back to tags.`,
        );
      }
      const tagUrls = [
        `${GITLAB_API_BASE_URL}/repository/tags?per_page=1&order_by=updated&sort=desc`,
        `${GITLAB_API_BASE_URL}/repository/tags?per_page=1`,
        `${GITLAB_API_BASE_URL}/repository/tags`,
      ];

      let tagsResponse: Response | null = null;
      let tags: GitlabTagApi[] | undefined;
      let hadSuccessfulTagResponse = false;

      for (const tagUrl of tagUrls) {
        const tagChain = buildGitlabAuthChain(headersWithoutAuth, gitlabAuth);
        const result = await fetchJsonResponseWithRetryAuthChain<
          GitlabTagApi[]
        >(tagUrl, tagChain, { description: `GitLab tags for ${projectPath}` });
        tagsResponse = result.response;

        if (!tagsResponse.ok) {
          // Some GitLab versions don't support order_by/sort on tags. Retry with a simpler endpoint.
          if (tagsResponse.status === 400) {
            continue;
          }
          break;
        }

        hadSuccessfulTagResponse = true;
        const receivedTags = result.data ?? [];
        if (receivedTags.length > 0) {
          tags = receivedTags;
          break;
        }
      }

      if (!hadSuccessfulTagResponse) {
        let bodyText: string | undefined;
        try {
          bodyText = tagsResponse ? await tagsResponse.text() : undefined;
        } catch {
          bodyText = undefined;
        }

        const details =
          tagsResponse == null
            ? "no response"
            : `${tagsResponse.status} ${tagsResponse.statusText}`;

        const canTryGitTransportFallback =
          tagsResponse?.status === 404 &&
          Boolean(gitlabAuth?.deployToken && !gitlabAuth.accessToken);

        if (canTryGitTransportFallback) {
          log.warn(
            `Tag API returned 404 for ${projectPath} on ${gitlabHost} with deploy token auth. Trying Git transport fallback.`,
            bodyText ? { bodyText } : undefined,
          );

          try {
            const deployToken = gitlabAuth?.deployToken;
            if (!deployToken) {
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }
            const gitTransportTags = await fetchGitlabTagsViaGitTransport(
              gitlabHost,
              projectPath,
              deployToken,
            );

            if (gitTransportTags && gitTransportTags.length > 0) {
              const t = await getTranslations({ locale, namespace: "Actions" });
              const commitTitle = t("commit_message_fallback_title");
              const unavailableText = t("commit_message_unavailable_fallback");
              const fallbackTimestamp = new Date().toISOString();
              allReleases = gitTransportTags.map((tag) => {
                if (tag.commitSha) {
                  gitTransportCommitShasByTag.set(tag.name, tag.commitSha);
                }
                const shortSha = tag.commitSha?.slice(0, 12);
                const body = shortSha
                  ? `### ${commitTitle}\n\n---\n\n${unavailableText}\n\nCommit: \`${shortSha}\``
                  : `### ${commitTitle}\n\n---\n\n${unavailableText}`;

                return {
                  id: hashStringToId(tag.name),
                  html_url: `https://${gitlabHost}/${projectPath}/-/tags/${encodeURIComponent(tag.name)}`,
                  tag_name: tag.name,
                  name: `Tag: ${tag.name}`,
                  body,
                  created_at: fallbackTimestamp,
                  published_at: fallbackTimestamp,
                  published_at_unknown: true,
                  prerelease: false,
                  draft: false,
                };
              });
              log.info(
                `Git transport fallback found ${gitTransportTags.length} tags for ${projectPath}.`,
              );
            } else if (gitTransportTags && gitTransportTags.length === 0) {
              log.info(
                `Git transport fallback found no tags for ${projectPath}.`,
              );
              return {
                release: null,
                error: { type: "no_releases_found" },
                newEtag,
              };
            } else {
              return {
                release: null,
                error: { type: "repo_not_found" },
                newEtag,
              };
            }
          } catch (error) {
            log.error(
              `Git transport fallback failed for ${projectPath} on ${gitlabHost}.`,
              error,
            );
            return { release: null, error: { type: "api_error" }, newEtag };
          }
        } else {
          log.error(
            `Failed to fetch tags for ${projectPath} after failing to find releases. (${details})`,
            bodyText ? { bodyText } : undefined,
          );
          if (tagsResponse?.status === 404) {
            return {
              release: null,
              error: { type: "repo_not_found" },
              newEtag,
            };
          }
          return { release: null, error: { type: "api_error" }, newEtag };
        }
      }

      if (allReleases.length === 0) {
        if (!tags || tags.length === 0) {
          log.info(`No tags found for ${projectPath}.`);
          return {
            release: null,
            error: { type: "no_releases_found" },
            newEtag,
          };
        }

        const latestTag = tags[0];
        const t = await getTranslations({ locale, namespace: "Actions" });
        let bodyContent = "";
        let publicationDate =
          extractGitlabCommitDate(latestTag.commit) || new Date().toISOString();

        const tagMessage =
          typeof latestTag.message === "string" ? latestTag.message : null;
        const releaseDescription =
          typeof latestTag.release?.description === "string"
            ? latestTag.release.description
            : null;

        if (tagMessage) {
          bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${tagMessage}`;
        } else if (releaseDescription) {
          bodyContent = `### ${t("tag_message_fallback_title")}\n\n---\n\n${releaseDescription}`;
        }

        if (!bodyContent && typeof latestTag.commit?.message === "string") {
          bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${latestTag.commit.message}`;
        }

        if (!bodyContent) {
          const ref = latestTag.commit?.id ?? latestTag.name;
          const commit = await tryFetchGitlabCommitMessage(
            GITLAB_API_BASE_URL,
            headersWithoutAuth,
            gitlabAuth,
            ref,
          );
          if (commit?.message) {
            bodyContent = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
          }
          if (commit?.date) {
            publicationDate = commit.date;
          }
        }

        const virtualRelease: GithubRelease = {
          id: 0,
          html_url: `https://${gitlabHost}/${projectPath}/-/tags/${encodeURIComponent(latestTag.name)}`,
          tag_name: latestTag.name,
          name: `Tag: ${latestTag.name}`,
          body: bodyContent,
          created_at: publicationDate,
          published_at: publicationDate,
          prerelease: false,
          draft: false,
        };
        allReleases = [virtualRelease];
      }
    }

    const filteredReleases = allReleases.filter((r) => {
      try {
        if (effectiveExcludeRegex) {
          const exclude = new RegExp(effectiveExcludeRegex, "i");
          if (exclude.test(r.tag_name)) return false;
        }
        if (effectiveIncludeRegex) {
          const include = new RegExp(effectiveIncludeRegex, "i");
          return include.test(r.tag_name);
        }
      } catch (e) {
        log.error(
          `Invalid regex for repo gitlab:${gitlabHost}/${projectPath}. Regex filters will be ignored. Error:`,
          e,
        );
      }

      if (r.draft) {
        return effectiveReleaseChannels.includes("draft");
      }

      const isTagMarkedPreRelease = isPreReleaseByTagName(
        r.tag_name,
        allPreReleaseTypes,
      );
      const isConsideredPreRelease = r.prerelease || isTagMarkedPreRelease;

      if (isConsideredPreRelease) {
        if (!effectiveReleaseChannels.includes("prerelease")) return false;

        if (isTagMarkedPreRelease) {
          return isPreReleaseByTagName(
            r.tag_name,
            effectivePreReleaseSubChannels,
          );
        }

        return true;
      }

      return effectiveReleaseChannels.includes("stable");
    });

    if (filteredReleases.length === 0) {
      return {
        release: null,
        error: { type: "no_matching_releases" },
        newEtag,
      };
    }

    const sortedReleases = filteredReleases.slice().sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at).getTime();
      const bTime = new Date(b.published_at || b.created_at).getTime();
      return bTime - aTime;
    });

    const latestRelease = sortedReleases[0];

    if (
      latestRelease.published_at_unknown &&
      gitlabAuth?.deployToken &&
      !gitlabAuth.accessToken
    ) {
      const commitSha = gitTransportCommitShasByTag.get(latestRelease.tag_name);
      if (commitSha) {
        const metadata = await tryFetchGitlabCommitMetadataViaGitTransport(
          gitlabHost,
          projectPath,
          gitlabAuth.deployToken,
          commitSha,
        );
        if (metadata?.message) {
          const t = await getTranslations({ locale, namespace: "Actions" });
          latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${metadata.message}`;
        }
        if (metadata?.date) {
          latestRelease.created_at = metadata.date;
          latestRelease.published_at = metadata.date;
          latestRelease.published_at_unknown = false;
        }
      }
    }

    if (
      latestRelease.id !== 0 &&
      (!latestRelease.body || latestRelease.body.trim() === "")
    ) {
      const commit = await tryFetchGitlabCommitMessage(
        GITLAB_API_BASE_URL,
        headersWithoutAuth,
        gitlabAuth,
        latestRelease.tag_name,
      );
      if (commit?.message) {
        const t = await getTranslations({ locale, namespace: "Actions" });
        latestRelease.body = `### ${t("commit_message_fallback_title")}\n\n---\n\n${commit.message}`;
      }
      if (commit?.date) {
        latestRelease.published_at = latestRelease.published_at ?? commit.date;
      }
    }

    latestRelease.fetched_at = fetchedAtTimestamp;
    return { release: latestRelease, error: null, newEtag };
  } catch (error) {
    log.error(`Failed to fetch GitLab releases for ${projectPath}:`, error);
    return { release: null, error: { type: "api_error" } };
  }
}
