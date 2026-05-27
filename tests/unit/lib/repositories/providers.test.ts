import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/server-action-helpers", () => ({
  log: logMock,
  normalizeEnvToken(value: string | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    const unquoted =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ? trimmed.slice(1, -1).trim()
        : trimmed;
    const compact = unquoted.replace(/\s+/g, "");
    return compact || null;
  },
}));

describe("repositories/providers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
    delete process.env.GITLAB_ACCESS_TOKENS;
    delete process.env.GITLAB_DEPLOY_TOKENS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("normalizes GitLab host names and rejects URL-shaped or malformed hosts", async () => {
    const { normalizeGitlabHost } = await import(
      "@/lib/repositories/providers"
    );

    expect(normalizeGitlabHost(" GitLab.Example.COM ")).toBe(
      "gitlab.example.com",
    );
    expect(normalizeGitlabHost("sub.gitlab.example")).toBe(
      "sub.gitlab.example",
    );

    for (const host of [
      "",
      "https://gitlab.example.com",
      "gitlab.example.com:443",
      "gitlab.example.com/group",
      "gitlab.example.com?x=1",
      ".gitlab.example.com",
      "gitlab.example.com.",
    ]) {
      expect(normalizeGitlabHost(host)).toBeNull();
    }
  });

  it("builds the allowed GitLab host set with defaults, normalization, de-duping, and warnings", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS =
      " GitLab.Self.TEST, gitlab.com, https://bad, bad:443, .bad, bad. ";
    const { getAllowedGitlabHosts } = await import(
      "@/lib/repositories/providers"
    );

    expect(getAllowedGitlabHosts()).toEqual(["gitlab.com", "gitlab.self.test"]);
    expect(logMock.warn).toHaveBeenCalledTimes(4);
  });

  it("parses GitLab access tokens by normalized host and drops invalid entries", async () => {
    process.env.GITLAB_ACCESS_TOKENS =
      "gitlab.com='abc 123',missing-separator,no-token=   ,bad:443=tok,self.test=\"tok en\"";
    const { getGitlabAccessTokensByHost } = await import(
      "@/lib/repositories/providers"
    );

    expect([...getGitlabAccessTokensByHost()]).toEqual([
      ["gitlab.com", "abc123"],
      ["self.test", "token"],
    ]);
    expect(logMock.warn).toHaveBeenCalledTimes(3);
  });

  it("parses GitLab deploy tokens by host and drops invalid users, hosts, and tokens", async () => {
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.com=deploy-user: tok en,self.test=user.name:'secret',missing,host-only=nousercolon,bad:443=user:tok,space.test=bad user:tok";
    const { getGitlabDeployTokensByHost } = await import(
      "@/lib/repositories/providers"
    );

    expect([...getGitlabDeployTokensByHost()]).toEqual([
      ["gitlab.com", { username: "deploy-user", token: "token" }],
      ["self.test", { username: "user.name", token: "secret" }],
    ]);
    expect(logMock.warn).toHaveBeenCalledTimes(4);
  });

  it("returns GitLab auth data only for normalized hosts that have usable tokens", async () => {
    process.env.GITLAB_ACCESS_TOKENS = "gitlab.com=access-token";
    process.env.GITLAB_DEPLOY_TOKENS = "gitlab.com=deploy-user:deploy-token";
    const { getGitlabAuthForHost } = await import(
      "@/lib/repositories/providers"
    );

    expect(getGitlabAuthForHost(" GitLab.COM ")).toEqual({
      accessToken: "access-token",
      deployToken: { username: "deploy-user", token: "deploy-token" },
    });
    expect(getGitlabAuthForHost("https://gitlab.com")).toBeNull();
    expect(getGitlabAuthForHost("gitlab.self.test")).toBeNull();
  });

  it("reports whether any allowed GitLab host has a configured token", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_ACCESS_TOKENS = "other.gitlab.test=token";
    const { hasAnyGitlabTokenForAllowedHosts } = await import(
      "@/lib/repositories/providers"
    );

    expect(hasAnyGitlabTokenForAllowedHosts()).toBe(false);

    process.env.GITLAB_ACCESS_TOKENS = "gitlab.self.test=token";

    expect(hasAnyGitlabTokenForAllowedHosts()).toBe(true);
  });

  it("parses supported GitHub, Codeberg, and GitLab repository URLs", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    const { parseSupportedRepoUrl } = await import(
      "@/lib/repositories/providers"
    );

    expect(parseSupportedRepoUrl("https://github.com/Owner/Repo.git")).toEqual({
      provider: "github",
      owner: "Owner",
      repo: "Repo",
      id: "github:owner/repo",
      canonicalRepoUrl: "https://github.com/Owner/Repo",
    });
    expect(
      parseSupportedRepoUrl("https://codeberg.org/Owner/Repo.git"),
    ).toEqual({
      provider: "codeberg",
      owner: "Owner",
      repo: "Repo",
      id: "codeberg:owner/repo",
      canonicalRepoUrl: "https://codeberg.org/Owner/Repo",
    });
    expect(
      parseSupportedRepoUrl("https://codeberg.org/api/v1/repos/Owner/Repo"),
    ).toEqual({
      provider: "codeberg",
      owner: "Owner",
      repo: "Repo",
      id: "codeberg:owner/repo",
      canonicalRepoUrl: "https://codeberg.org/Owner/Repo",
    });
    expect(
      parseSupportedRepoUrl(
        "https://gitlab.self.test/group/sub/repo/-/releases",
      ),
    ).toEqual({
      provider: "gitlab",
      providerHost: "gitlab.self.test",
      owner: "group/sub",
      repo: "repo",
      id: "gitlab:gitlab.self.test/group/sub/repo",
      canonicalRepoUrl: "https://gitlab.self.test/group/sub/repo",
    });
    expect(
      parseSupportedRepoUrl(
        "https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo",
      ),
    ).toEqual({
      provider: "gitlab",
      providerHost: "gitlab.com",
      owner: "group/sub",
      repo: "repo",
      id: "gitlab:gitlab.com/group/sub/repo",
      canonicalRepoUrl: "https://gitlab.com/group/sub/repo",
    });
    expect(
      parseSupportedRepoUrl("https://not-allowed.gitlab.test/group/repo"),
    ).toBeNull();
    expect(parseSupportedRepoUrl("not a url")).toBeNull();
  });
});
