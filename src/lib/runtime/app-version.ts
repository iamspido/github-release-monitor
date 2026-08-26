type ParsedVersion = {
  core: [number, number, number];
  prerelease: string[];
};

function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^v/i, "").replace(/\+.*$/, "");
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(
    normalized,
  );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < a.core.length; i += 1) {
    const segmentA = a.core[i];
    const segmentB = b.core[i];
    if (segmentA > segmentB) return 1;
    if (segmentA < segmentB) return -1;
  }

  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const identifierA = a.prerelease[i];
    const identifierB = b.prerelease[i];
    if (identifierA === undefined) return -1;
    if (identifierB === undefined) return 1;
    if (identifierA === identifierB) continue;

    const numericA = /^\d+$/.test(identifierA);
    const numericB = /^\d+$/.test(identifierB);
    if (numericA && numericB) {
      return Number(identifierA) > Number(identifierB) ? 1 : -1;
    }
    if (numericA !== numericB) return numericA ? -1 : 1;
    return identifierA > identifierB ? 1 : -1;
  }

  return 0;
}

export function compareAppVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return null;
  return compareParsedVersions(parsedA, parsedB);
}

export function isStableAppVersion(value: string | null | undefined): boolean {
  const parsed = parseVersion(value);
  return parsed !== null && parsed.prerelease.length === 0;
}
