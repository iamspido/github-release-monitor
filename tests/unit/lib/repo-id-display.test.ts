import { describe, expect, it } from "vitest";
import {
  formatRepoIdForDisplay,
  getRepositoryNameFromId,
} from "@/lib/repo-id-display";

describe("formatRepoIdForDisplay", () => {
  it("returns non-prefixed ids unchanged", () => {
    expect(formatRepoIdForDisplay("owner/repo")).toBe("owner/repo");
  });

  it("hides provider prefix when configured", () => {
    expect(
      formatRepoIdForDisplay("github:owner/repo", {
        showProviderPrefix: false,
      }),
    ).toBe("owner/repo");
  });

  it("hides gitlab domain while keeping provider prefix", () => {
    expect(
      formatRepoIdForDisplay("gitlab:gitlab.self.test/group/repo", {
        showProviderPrefix: true,
        showProviderDomain: false,
      }),
    ).toBe("gitlab:group/repo");
  });

  it("hides gitlab domain and provider prefix together", () => {
    expect(
      formatRepoIdForDisplay("gitlab:gitlab.self.test/group/repo", {
        showProviderPrefix: false,
        showProviderDomain: false,
      }),
    ).toBe("group/repo");
  });

  it("keeps non-host-like gitlab paths unchanged when hiding domain", () => {
    expect(
      formatRepoIdForDisplay("gitlab:owner/repo", {
        showProviderDomain: false,
      }),
    ).toBe("gitlab:owner/repo");
  });

  it("hides a Forgejo host and base path while keeping owner/repo", () => {
    expect(
      formatRepoIdForDisplay(
        "forgejo:forgejo.internal.test:3000/code/owner/repo",
        { showProviderPrefix: true, showProviderDomain: false },
      ),
    ).toBe("forgejo:owner/repo");
  });
});

describe("getRepositoryNameFromId", () => {
  it("extracts the repository name from prefixed and unprefixed ids", () => {
    expect(getRepositoryNameFromId("github:owner/repo")).toBe("repo");
    expect(getRepositoryNameFromId("owner/repo")).toBe("repo");
    expect(
      getRepositoryNameFromId("gitlab:gitlab.example.test/group/sub/repo"),
    ).toBe("repo");
  });
});
