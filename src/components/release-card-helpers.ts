import type React from "react";
import { defaultSchema } from "rehype-sanitize";
import {
  defaultSecurityHighlightCustomColor,
  normalizeSecurityHighlightColorPreset,
  normalizeSecurityHighlightCustomColor,
} from "@/lib/security-release";
import type {
  AppSettings,
  EnrichedRelease,
  FetchError,
  SecurityHighlightColorPreset,
} from "@/types";

export function getReleaseErrorMessage(
  error: FetchError,
  t: (key: string) => string,
): string {
  switch (error.type) {
    case "rate_limit":
      return t("error_rate_limit");
    case "no_matching_releases":
      return t("error_no_matching_releases");
    case "repo_not_found":
      return t("error_repo_not_found");
    case "invalid_url":
      return t("error_invalid_url");
    case "no_releases_found":
      return t("error_no_releases_found");
    default:
      return t("error_generic_fetch");
  }
}

type RepoSettings = NonNullable<EnrichedRelease["repoSettings"]>;

export function hasCustomRepoSettings(
  repoSettings: RepoSettings | undefined,
): boolean {
  if (!repoSettings) return false;

  return Boolean(
    (repoSettings.releaseChannels && repoSettings.releaseChannels.length > 0) ||
      (repoSettings.preReleaseSubChannels &&
        repoSettings.preReleaseSubChannels.length > 0) ||
      (repoSettings.releasesPerPage !== null &&
        typeof repoSettings.releasesPerPage === "number") ||
      (repoSettings.refreshInterval !== null &&
        typeof repoSettings.refreshInterval === "number") ||
      (repoSettings.cacheInterval !== null &&
        typeof repoSettings.cacheInterval === "number") ||
      repoSettings.backgroundCheckCron ||
      repoSettings.includeRegex ||
      repoSettings.excludeRegex ||
      repoSettings.appriseTags ||
      repoSettings.appriseFormat,
  );
}

type SecurityHighlightStyle = {
  cardClassName: string;
  badgeClassName: string;
  style?: React.CSSProperties;
};

const securityHighlightPresetStyles: Record<
  Exclude<SecurityHighlightColorPreset, "custom">,
  SecurityHighlightStyle
> = {
  yellow: {
    cardClassName:
      "border-yellow-500/70 ring-2 ring-yellow-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-yellow-500/70 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  },
  red: {
    cardClassName:
      "border-red-500/70 ring-2 ring-red-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-red-500/70 bg-red-500/15 text-red-700 dark:text-red-300",
  },
  orange: {
    cardClassName:
      "border-orange-500/70 ring-2 ring-orange-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-orange-500/70 bg-orange-500/15 text-orange-700 dark:text-orange-300",
  },
  blue: {
    cardClassName:
      "border-blue-500/70 ring-2 ring-blue-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-blue-500/70 bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  purple: {
    cardClassName:
      "border-purple-500/70 ring-2 ring-purple-500/60 ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-purple-500/70 bg-purple-500/15 text-purple-700 dark:text-purple-300",
  },
};

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeSecurityHighlightCustomColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function getSecurityHighlightStyle(
  settings: AppSettings,
): SecurityHighlightStyle {
  const preset = normalizeSecurityHighlightColorPreset(
    settings.securityHighlightColorPreset,
  );

  if (preset !== "custom") {
    return securityHighlightPresetStyles[preset];
  }

  const color = normalizeSecurityHighlightCustomColor(
    settings.securityHighlightCustomColor ??
      defaultSecurityHighlightCustomColor,
  );
  const style = {
    "--security-highlight-border": hexToRgba(color, 0.7),
    "--security-highlight-ring": hexToRgba(color, 0.6),
    "--security-highlight-bg": hexToRgba(color, 0.15),
  } as React.CSSProperties;

  return {
    cardClassName:
      "border-[var(--security-highlight-border)] ring-2 ring-[var(--security-highlight-ring)] ring-offset-2 ring-offset-background",
    badgeClassName:
      "border-[var(--security-highlight-border)] bg-[var(--security-highlight-bg)] text-foreground",
    style,
  };
}

export const markdownSanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...(defaultSchema.attributes || {}),
    a: [...(defaultSchema.attributes?.a || []), "target", "rel"],
    img: [
      ...(defaultSchema.attributes?.img || []),
      "src",
      "alt",
      "title",
      "width",
      "height",
    ],
  },
  protocols: {
    ...(defaultSchema.protocols || {}),
    src: ["http", "https"],
  },
};
