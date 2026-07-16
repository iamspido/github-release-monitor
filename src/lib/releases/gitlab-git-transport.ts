import { inflateSync } from "node:zlib";

import {
  consumeResponseWithTimeout,
  discardResponseWithTimeout,
} from "@/lib/http/fetch-with-timeout";
import { fetchResponseWithRetryAuthChain } from "@/lib/releases/fetch";
import type { GitlabDeployToken } from "@/lib/repositories/providers";
import { log } from "@/lib/server-action-helpers";

type ParsedTagSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

export type GitSmartTagRef = {
  name: string;
  objectId: string;
  peeledObjectId?: string;
};

export type GitTransportTag = {
  name: string;
  commitSha: string | null;
};

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

export function parseGitSmartHttpTagRefs(
  payload: Uint8Array,
): GitSmartTagRef[] {
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

export function extractPackPayloadFromUploadPackResponse(
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

export function parseFirstGitObjectMetadataFromPack(
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

export async function tryFetchGitlabCommitMetadataViaGitTransport(
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
      await discardResponseWithTimeout(response);
      log.debug(
        `Git transport commit metadata lookup failed for ${projectPath} on ${gitlabHost}: ${response.status} ${response.statusText} (auth=${mode})`,
      );
      continue;
    }

    const uploadPackResponse = new Uint8Array(
      await consumeResponseWithTimeout(response, (result) =>
        result.arrayBuffer(),
      ),
    );
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

export async function fetchGitlabTagsViaGitTransport(
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
      bodyText = await consumeResponseWithTimeout(response, (result) =>
        result.text(),
      );
    } catch {
      bodyText = undefined;
    }
    log.warn(
      `Git transport tags lookup failed for ${projectPath} on ${gitlabHost}: ${response.status} ${response.statusText} (auth=${mode})`,
      bodyText ? { bodyText } : undefined,
    );
    return null;
  }

  const payload = new Uint8Array(
    await consumeResponseWithTimeout(response, (result) =>
      result.arrayBuffer(),
    ),
  );
  const refs = parseGitSmartHttpTagRefs(payload);
  if (refs.length === 0) {
    return [];
  }

  return refs
    .map((ref) => ({
      name: ref.name,
      commitSha: ref.peeledObjectId ?? ref.objectId ?? null,
    }))
    .sort((a, b) => compareTagNamesByRecency(b.name, a.name));
}
