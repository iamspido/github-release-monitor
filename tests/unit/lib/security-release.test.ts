import { describe, expect, it } from "vitest";
import { isSecurityRelease } from "@/lib/security-release";
import type { GithubRelease } from "@/types";

function release(overrides: Partial<GithubRelease>): GithubRelease {
  return {
    id: 1,
    html_url: "https://example.com/release",
    tag_name: "v1.0.0",
    name: "v1.0.0",
    body: null,
    created_at: "2024-01-01T00:00:00.000Z",
    published_at: "2024-01-01T00:00:00.000Z",
    prerelease: false,
    draft: false,
    ...overrides,
  };
}

describe("isSecurityRelease", () => {
  it("detects common security release indicators", () => {
    expect(isSecurityRelease(release({ name: "Security update" }))).toBe(true);
    expect(isSecurityRelease(release({ tag_name: "CVE-2024-12345" }))).toBe(
      true,
    );
    expect(
      isSecurityRelease(release({ body: "Fixes GHSA-abcd-1234-wxyz" })),
    ).toBe(true);
    expect(isSecurityRelease(release({ body: "Closes a vulnerability" }))).toBe(
      true,
    );
    expect(
      isSecurityRelease(release({ body: "Behebt eine Sicherheitsluecke" })),
    ).toBe(true);
  });

  it("does not mark regular release notes as security releases", () => {
    expect(
      isSecurityRelease(
        release({ name: "v1.2.3", body: "Adds new dashboard filters." }),
      ),
    ).toBe(false);
    expect(isSecurityRelease(undefined)).toBe(false);
  });

  it("detects custom keyword and regex indicators", () => {
    expect(
      isSecurityRelease(release({ body: "Contains a breaking auth fix." }), {
        customSecurityPatterns: "breaking",
      }),
    ).toBe(true);
    expect(
      isSecurityRelease(release({ name: "Auth hardening" }), {
        customSecurityPatterns: "/hardening/i",
      }),
    ).toBe(true);
  });

  it("can disable default indicators and use only custom patterns", () => {
    expect(
      isSecurityRelease(release({ name: "Security update" }), {
        includeDefaultSecurityPatterns: false,
      }),
    ).toBe(false);
    expect(
      isSecurityRelease(release({ name: "Security update" }), {
        includeDefaultSecurityPatterns: false,
        customSecurityPatterns: "security",
      }),
    ).toBe(true);
  });

  it("ignores invalid custom regex without crashing", () => {
    expect(
      isSecurityRelease(release({ name: "Security update" }), {
        customSecurityPatterns: "/[/",
      }),
    ).toBe(true);
    expect(
      isSecurityRelease(release({ name: "v1.2.3" }), {
        includeDefaultSecurityPatterns: false,
        customSecurityPatterns: "/[/",
      }),
    ).toBe(false);
  });
});
