import { allPreReleaseTypes, type PreReleaseChannelType } from "@/types";

export const legacyPreReleaseMarkers = ["a", "b", "m"] as const;
export const legacyAllPreReleaseTypes = [
  "a",
  "alpha",
  "b",
  "beta",
  "canary",
  "cr",
  "dev",
  "eap",
  "m",
  "milestone",
  "next",
  "nightly",
  "pre",
  "preview",
  "pr",
  "rc",
  "snapshot",
  "sp",
  "tp",
] as const;

const customPreReleaseMarkerPattern =
  /^\p{L}[\p{L}\p{M}]*(?:-[\p{L}\p{M}]+)*$/u;
const supportedPreReleaseMarkerSet = new Set<string>(allPreReleaseTypes);
const legacyPreReleaseMarkerSet = new Set<string>(legacyPreReleaseMarkers);

export function isValidCustomPreReleaseMarker(marker: string): boolean {
  return customPreReleaseMarkerPattern.test(
    normalizePreReleaseMarkerText(marker.trim()),
  );
}

export function normalizePreReleaseMarkerText(value: string): string {
  return value.normalize("NFKC").toLowerCase().normalize("NFC");
}

export function getInvalidCustomPreReleaseMarkers(
  markers: readonly string[] | undefined,
): string[] {
  return [...new Set((markers ?? []).map((marker) => marker.trim()))].filter(
    (marker) => marker !== "" && !isValidCustomPreReleaseMarker(marker),
  );
}

export function normalizeCustomPreReleaseMarkers(
  markers: readonly string[] | undefined,
): string[] {
  const normalized = new Set<string>();
  for (const marker of markers ?? []) {
    const value = normalizePreReleaseMarkerText(marker.trim());
    if (value) normalized.add(value);
  }
  return [...normalized];
}

export function parseCustomPreReleaseMarkers(value: string): string[] {
  return normalizeCustomPreReleaseMarkers(
    splitCustomPreReleaseMarkerInput(value),
  );
}

export function splitCustomPreReleaseMarkerInput(value: string): string[] {
  return value.split(/[,،，]/u);
}

export function getValidCustomPreReleaseMarkers(
  markers: readonly string[] | undefined,
): string[] {
  return normalizeCustomPreReleaseMarkers(markers).filter(
    isValidCustomPreReleaseMarker,
  );
}

function hasSameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

export function migrateLegacyPreReleaseConfiguration(
  preReleaseSubChannels: readonly string[] | undefined,
  customPreReleaseMarkers: readonly string[] | undefined,
): {
  preReleaseSubChannels: PreReleaseChannelType[] | undefined;
  customPreReleaseMarkers: string[] | undefined;
} {
  if (preReleaseSubChannels === undefined) {
    return {
      preReleaseSubChannels: undefined,
      customPreReleaseMarkers:
        customPreReleaseMarkers === undefined
          ? undefined
          : normalizeCustomPreReleaseMarkers(customPreReleaseMarkers),
    };
  }

  const wasLegacyDefault = hasSameValues(
    preReleaseSubChannels,
    legacyAllPreReleaseTypes,
  );
  const supportedChannels = preReleaseSubChannels.filter(
    (channel): channel is PreReleaseChannelType =>
      supportedPreReleaseMarkerSet.has(channel),
  );
  const explicitlySelectedLegacyMarkers = wasLegacyDefault
    ? []
    : preReleaseSubChannels.filter((channel) =>
        legacyPreReleaseMarkerSet.has(channel),
      );
  const migratedCustomMarkers = normalizeCustomPreReleaseMarkers([
    ...(customPreReleaseMarkers ?? []),
    ...explicitlySelectedLegacyMarkers,
  ]);

  return {
    preReleaseSubChannels: supportedChannels,
    customPreReleaseMarkers:
      customPreReleaseMarkers === undefined &&
      explicitlySelectedLegacyMarkers.length === 0
        ? undefined
        : migratedCustomMarkers,
  };
}
