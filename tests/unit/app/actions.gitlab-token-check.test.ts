// vitest globals enabled

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

import {
  fetchCallHeaders,
  headerRecord,
  installFetchMock,
  mockFetchResponse,
} from "../helpers/fetch";

describe("getGitlabTokenCheck", () => {
  const fetchBackup = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    installFetchMock();
    delete process.env.GITLAB_ACCESS_TOKENS;
    delete process.env.GITLAB_DEPLOY_TOKENS;
    delete process.env.GITLAB_ADDITIONAL_HOSTS;
  });

  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("returns limited-valid for deploy token when /user endpoint rejects basic auth", async () => {
    process.env.GITLAB_ADDITIONAL_HOSTS = "gitlab.self.test";
    process.env.GITLAB_DEPLOY_TOKENS =
      "gitlab.self.test=gitlab+deploy-token-1:gl-dpt-abc";
    const actions = await import("@/app/actions");

    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const result = await actions.getGitlabTokenCheck();
    expect(result).toEqual({
      status: "valid",
      username: null,
      name: null,
      diagnosticsLimited: true,
    });

    const authorization = headerRecord(
      fetchCallHeaders(vi.mocked(global.fetch).mock.calls[0]),
    ).Authorization;
    expect(authorization.startsWith("Basic ")).toBe(true);
  });
});
