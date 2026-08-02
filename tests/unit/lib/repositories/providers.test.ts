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
    delete process.env.FORGEJO_ADDITIONAL_BASE_URLS;
    delete process.env.FORGEJO_ACCESS_TOKENS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("normalizes GitLab host names and rejects URL-shaped or malformed hosts", async () => {
    const { normalizeGitlabHost } = await import(
      "@/lib/repositories/providers"
    );

    expect(normalizeGitlabHost(" GitLab.Example.TEST ")).toBe(
      "gitlab.example.test",
    );
    expect(normalizeGitlabHost("sub.gitlab.test")).toBe("sub.gitlab.test");

    for (const host of [
      "",
      "https://gitlab.example.test",
      "gitlab.example.test:443",
      "gitlab.example.test/group",
      "gitlab.example.test?x=1",
      ".gitlab.example.test",
      "gitlab.example.test.",
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

  it("never includes invalid GitLab credentials in warning logs", async () => {
    process.env.GITLAB_ACCESS_TOKENS =
      "missing-secret-value,bad:443=access-secret,no-token=   ";
    process.env.GITLAB_DEPLOY_TOKENS =
      "missing-deploy-secret,bad:443=user:deploy-secret,host=user-without-token";
    const { getGitlabAccessTokensByHost, getGitlabDeployTokensByHost } =
      await import("@/lib/repositories/providers");

    getGitlabAccessTokensByHost();
    getGitlabDeployTokensByHost();

    const warnings = JSON.stringify(logMock.warn.mock.calls);
    expect(warnings).not.toContain("secret-value");
    expect(warnings).not.toContain("access-secret");
    expect(warnings).not.toContain("deploy-secret");
    expect(warnings).not.toContain("user-without-token");
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

  it("normalizes Forgejo base URLs with protocols, ports, IPv6, and subpaths", async () => {
    const { normalizeForgejoBaseUrl } = await import(
      "@/lib/repositories/providers"
    );

    expect(
      normalizeForgejoBaseUrl(" HTTPS://Forgejo.Example.TEST/code/// "),
    ).toBe("https://forgejo.example.test/code");
    expect(normalizeForgejoBaseUrl("http://forgejo.internal.test:3000/")).toBe(
      "http://forgejo.internal.test:3000",
    );
    expect(normalizeForgejoBaseUrl("http://192.0.2.10:3000/code/")).toBe(
      "http://192.0.2.10:3000/code",
    );
    expect(normalizeForgejoBaseUrl("http://[::1]:3000/code/")).toBe(
      "http://[::1]:3000/code",
    );
    expect(
      normalizeForgejoBaseUrl(
        "https://forgejo.example.test/~Forgejo/code%20hosting/",
      ),
    ).toBe("https://forgejo.example.test/~Forgejo/code%20hosting");
    expect(
      normalizeForgejoBaseUrl("https://forgejo.example.test/code//hosting"),
    ).toBe("https://forgejo.example.test/code//hosting");
    expect(
      normalizeForgejoBaseUrl(
        "https://forgejo.example.test/%7eForgejo/%63ode%20hosting",
      ),
    ).toBe("https://forgejo.example.test/~Forgejo/code%20hosting");
    expect(
      normalizeForgejoBaseUrl("https://forgejo.example.test/%63ode%2Ehosting"),
    ).toBe("https://forgejo.example.test/code.hosting");
    expect(
      normalizeForgejoBaseUrl(
        "https://forgejo.example.test/code[prod]|secondary",
      ),
    ).toBe("https://forgejo.example.test/code%5Bprod%5D%7Csecondary");
    for (const value of [
      "https:forgejo.example.test",
      "http:forgejo.example.test/code",
      "https:\\forgejo.example.test\\code",
      "https://forgejo.example.test\\code",
      "https://forgejo.example.test/co\tde",
      "ftp://forgejo.example.test",
      "https://user:secret@forgejo.example.test",
      "https://@forgejo.example.test",
      "https://forgejo.example.test?query=1",
      "https://forgejo.example.test?",
      "https://forgejo.example.test/#fragment",
      "https://forgejo.example.test/#",
      "https://forgejo.example.test/code%2Fhosting",
      "https://forgejo.example.test/code%5Chosting",
      "https://forgejo.example.test/code%",
      "https://forgejo.example.test/code%2",
      "https://forgejo.example.test/code%zz",
      "https://forgejo.example.test.",
      "not-a-url",
    ]) {
      expect(normalizeForgejoBaseUrl(value)).toBeNull();
    }
  });

  it("assigns tokens to the longest exact Forgejo base URL containing equals signs", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://scm.example.test/code,https://scm.example.test/code=hosting";
    process.env.FORGEJO_ACCESS_TOKENS =
      "https://scm.example.test/code=hosting=long-token==,https://scm.example.test/code=short-token";
    const { getForgejoAccessTokensByBaseUrl } = await import(
      "@/lib/repositories/providers"
    );

    expect([...getForgejoAccessTokensByBaseUrl()]).toEqual([
      ["https://scm.example.test/code=hosting", "long-token=="],
      ["https://scm.example.test/code", "short-token"],
    ]);
  });

  it("does not reassign an empty long-base token to a shorter Forgejo base", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://scm.example.test/code,https://scm.example.test/code=hosting";
    process.env.FORGEJO_ACCESS_TOKENS =
      "https://scm.example.test/code=hosting=";
    const { getForgejoAccessTokensByBaseUrl } = await import(
      "@/lib/repositories/providers"
    );

    expect([...getForgejoAccessTokensByBaseUrl()]).toEqual([]);
    expect(logMock.warn).toHaveBeenCalledOnce();
  });

  it("de-duplicates equivalent percent-encoded Forgejo base paths", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://scm.example.test/%7eForgejo/%63ode,https://scm.example.test/~Forgejo/code";
    const { buildForgejoRepoId, getAllowedForgejoBaseUrls } = await import(
      "@/lib/repositories/providers"
    );
    const { isValidRepoId } = await import("@/lib/repositories/validation");
    const allowedBaseUrls = getAllowedForgejoBaseUrls();

    expect(allowedBaseUrls).toEqual(["https://scm.example.test/~Forgejo/code"]);
    expect(
      isValidRepoId(buildForgejoRepoId(allowedBaseUrls[0], "owner", "repo")),
    ).toBe(true);
    expect(logMock.warn).toHaveBeenCalledOnce();
  });

  it("builds allowed Forgejo instances and keeps only tokens for exact allowed base URLs", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://forgejo.example.test/code,http://forgejo.internal.test:3000,https://codeberg.org,http://codeberg.org/mirror,http://forgejo.example.test/code,bad";
    process.env.FORGEJO_ACCESS_TOKENS =
      "https://forgejo.example.test/code=token-one,http://forgejo.internal.test:3000='token two',https://other.example.test=secret,invalid";
    const {
      getAllowedForgejoBaseUrls,
      getForgejoAccessTokensByBaseUrl,
      hasAnyForgejoToken,
    } = await import("@/lib/repositories/providers");

    expect(getAllowedForgejoBaseUrls()).toEqual([
      "https://forgejo.example.test/code",
      "http://forgejo.internal.test:3000",
    ]);
    expect([...getForgejoAccessTokensByBaseUrl()]).toEqual([
      ["https://forgejo.example.test/code", "token-one"],
      ["http://forgejo.internal.test:3000", "tokentwo"],
    ]);
    expect(hasAnyForgejoToken()).toBe(true);
    expect(JSON.stringify(logMock.warn.mock.calls)).not.toContain("secret");
  });

  it("preserves case-sensitive Forgejo paths while de-duplicating schemes for an exact path", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://scm.example.test/Code,http://scm.example.test/code,http://scm.example.test/Code";
    const { getAllowedForgejoBaseUrls } = await import(
      "@/lib/repositories/providers"
    );

    expect(getAllowedForgejoBaseUrls()).toEqual([
      "https://scm.example.test/Code",
      "http://scm.example.test/code",
    ]);
    expect(logMock.warn).toHaveBeenCalledOnce();
  });

  it("supports tokens and repository IDs for URL-safe Forgejo base paths", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://scm.example.test/~Forgejo/code%20hosting,https://scm.example.test/code=hosting";
    process.env.FORGEJO_ACCESS_TOKENS =
      "https://scm.example.test/code=hosting=equals-token==";
    const {
      buildForgejoRepoId,
      getForgejoAccessTokensByBaseUrl,
      parseSupportedRepoUrl,
    } = await import("@/lib/repositories/providers");
    const { isValidRepoId } = await import("@/lib/repositories/validation");

    const id = buildForgejoRepoId(
      "https://scm.example.test/~Forgejo/code%20hosting",
      "Owner",
      "Repo",
    );
    expect(id).toBe(
      "forgejo:scm.example.test/~Forgejo/code%20hosting/owner/repo",
    );
    expect(isValidRepoId(id)).toBe(true);
    expect(
      parseSupportedRepoUrl(
        "https://scm.example.test/~Forgejo/code%20hosting/Owner/Repo.git",
      ),
    ).toMatchObject({
      provider: "forgejo",
      providerBaseUrl: "https://scm.example.test/~Forgejo/code%20hosting",
      id,
    });
    expect(
      parseSupportedRepoUrl(
        "https://scm.example.test/%7eForgejo/code%20hosting/Owner/Repo.git",
      ),
    ).toMatchObject({
      provider: "forgejo",
      providerBaseUrl: "https://scm.example.test/~Forgejo/code%20hosting",
      id,
    });
    expect([...getForgejoAccessTokensByBaseUrl()]).toEqual([
      ["https://scm.example.test/code=hosting", "equals-token=="],
    ]);
  });

  it("round-trips Forgejo base paths whose literal characters require ID encoding", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://scm.example.test/code[prod]|secondary";
    process.env.FORGEJO_ACCESS_TOKENS =
      "https://scm.example.test/code[prod]|secondary=forgejo-token";
    const {
      buildForgejoRepoId,
      getAllowedForgejoBaseUrls,
      getForgejoAccessTokensByBaseUrl,
      parseSupportedRepoUrl,
    } = await import("@/lib/repositories/providers");
    const { isValidRepoId } = await import("@/lib/repositories/validation");

    const baseUrl = "https://scm.example.test/code%5Bprod%5D%7Csecondary";
    const repoId = buildForgejoRepoId(baseUrl, "Owner", "Repo");

    expect(getAllowedForgejoBaseUrls()).toEqual([baseUrl]);
    expect([...getForgejoAccessTokensByBaseUrl()]).toEqual([
      [baseUrl, "forgejo-token"],
    ]);
    expect(repoId).toBe(
      "forgejo:scm.example.test/code%5Bprod%5D%7Csecondary/owner/repo",
    );
    expect(isValidRepoId(repoId)).toBe(true);
    expect(
      parseSupportedRepoUrl(
        "https://scm.example.test/code[prod]|secondary/Owner/Repo.git",
      ),
    ).toMatchObject({
      provider: "forgejo",
      providerBaseUrl: baseUrl,
      id: repoId,
    });
  });

  it("parses allowed Forgejo web and API URLs under root and subpath instances", async () => {
    process.env.FORGEJO_ADDITIONAL_BASE_URLS =
      "https://forgejo.example.test,http://forgejo.internal.test:3000/code,http://[::1]:3000";
    const { parseSupportedRepoUrl } = await import(
      "@/lib/repositories/providers"
    );

    expect(
      parseSupportedRepoUrl("https://forgejo.example.test/Owner/Repo.git"),
    ).toEqual({
      provider: "forgejo",
      providerHost: "forgejo.example.test",
      providerBaseUrl: "https://forgejo.example.test",
      owner: "Owner",
      repo: "Repo",
      id: "forgejo:forgejo.example.test/owner/repo",
      canonicalRepoUrl: "https://forgejo.example.test/Owner/Repo",
    });
    expect(
      parseSupportedRepoUrl(
        "http://forgejo.internal.test:3000/code/api/v1/repos/Owner/Repo",
      ),
    ).toEqual({
      provider: "forgejo",
      providerHost: "forgejo.internal.test:3000",
      providerBaseUrl: "http://forgejo.internal.test:3000/code",
      owner: "Owner",
      repo: "Repo",
      id: "forgejo:forgejo.internal.test:3000/code/owner/repo",
      canonicalRepoUrl: "http://forgejo.internal.test:3000/code/Owner/Repo",
    });
    expect(parseSupportedRepoUrl("http://[::1]:3000/owner/repo")).toMatchObject(
      {
        provider: "forgejo",
        id: "forgejo:[::1]:3000/owner/repo",
      },
    );
    expect(
      parseSupportedRepoUrl("https://forgejo.example.test/api/v1"),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl("http://forgejo.internal.test:3000/code/api/v1"),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl("https://unconfigured.example.test/owner/repo"),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl(
        "http://forgejo.internal.test:3000/code/api/v1/other/repos/Owner/Repo",
      ),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl(
        "http://user:secret@forgejo.internal.test:3000/code/Owner/Repo",
      ),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl(
        "http://@forgejo.internal.test:3000/code/Owner/Repo",
      ),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl(
        "http://forgejo.internal.test:3000/code/Owner/Repo%20Name",
      ),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl(
        "http://forgejo.internal.test:3000/code\\Owner\\Repo",
      ),
    ).toBeNull();
    expect(
      parseSupportedRepoUrl(
        "http://forgejo.internal.test:3000/code/Owner/Re\tpo",
      ),
    ).toBeNull();
  });

  it("builds valid Forgejo IDs for ports and IPv6 instances", async () => {
    const { buildForgejoRepoId } = await import("@/lib/repositories/providers");
    const { isValidRepoId } = await import("@/lib/repositories/validation");

    const httpsPort80Id = buildForgejoRepoId(
      "https://forgejo.example.test:80",
      "owner",
      "repo",
    );
    expect(httpsPort80Id).toBe("forgejo:forgejo.example.test:80/owner/repo");
    expect(isValidRepoId(httpsPort80Id)).toBe(true);
    expect(
      isValidRepoId(
        buildForgejoRepoId(
          "http://forgejo.internal.test:3000/code",
          "owner",
          "repo",
        ),
      ),
    ).toBe(true);
    expect(
      isValidRepoId(buildForgejoRepoId("http://[::1]:3000", "owner", "repo")),
    ).toBe(true);
    expect(isValidRepoId("github:owner:3000/repo")).toBe(false);
    expect(isValidRepoId("codeberg:[::1]/owner/repo")).toBe(false);
    expect(isValidRepoId("forgejo:forgejo.example.test/owner/repo")).toBe(true);
    expect(isValidRepoId("forgejo:[::1]:3000/owner/repo")).toBe(true);
    expect(isValidRepoId("forgejo:forgejo.example.test/owner")).toBe(false);
    expect(
      isValidRepoId("forgejo:forgejo.example.test/code%2Fother/owner/repo"),
    ).toBe(false);
    expect(isValidRepoId("forgejo:user@forgejo.example.test/owner/repo")).toBe(
      false,
    );
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
