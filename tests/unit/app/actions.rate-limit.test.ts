import { getGitHubRateLimit } from "@/app/actions";
import {
  headerRecord,
  installFetchMock,
  mockFetchResponse,
} from "../helpers/fetch";

describe("actions.getGitHubRateLimit", () => {
  const fetchBackup = global.fetch;
  beforeEach(() => {
    installFetchMock();
  });
  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("returns data on 200 OK", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({ json: { rate: { limit: 60 } } }),
    );
    const res = await getGitHubRateLimit();
    expect(res.data).toBeTruthy();
    expect(res.error).toBeUndefined();
  });

  it("returns invalid_token on 401", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    const res = await getGitHubRateLimit();
    expect(res.data).toBeNull();
    expect(res.error).toBe("invalid_token");
  });

  it("with a bad token set, sends Authorization and maps 401 to invalid_token", async () => {
    const prev = process.env.GITHUB_ACCESS_TOKEN;
    process.env.GITHUB_ACCESS_TOKEN = "bad-token";
    try {
      vi.mocked(global.fetch).mockImplementation(
        (_url, _opts): Promise<Response> => {
          if (!_opts?.headers) {
            throw new Error("Expected Authorization header");
          }
          const authorization = headerRecord(_opts.headers).Authorization;
          expect(authorization).toMatch(/token\s+bad-token/);
          return Promise.resolve(
            mockFetchResponse({
              status: 401,
              statusText: "Unauthorized",
            }),
          );
        },
      );
      const res = await getGitHubRateLimit();
      expect(res.data).toBeNull();
      expect(res.error).toBe("invalid_token");
    } finally {
      process.env.GITHUB_ACCESS_TOKEN = prev;
    }
  });

  it("returns api_error on other failure", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("network"));
    const res = await getGitHubRateLimit();
    expect(res.data).toBeNull();
    expect(res.error).toBe("api_error");
  });

  it("adds Authorization header when token present (and still handles 200)", async () => {
    const old = process.env.GITHUB_ACCESS_TOKEN;
    process.env.GITHUB_ACCESS_TOKEN = "token123";
    try {
      vi.mocked(global.fetch).mockImplementation(
        (_url, _opts): Promise<Response> => {
          if (!_opts?.headers) {
            throw new Error("Expected Authorization header");
          }
          const authorization = headerRecord(_opts.headers).Authorization;
          expect(authorization).toMatch(/token\s+token123/);
          return Promise.resolve(
            mockFetchResponse({ json: { rate: { limit: 60 } } }),
          );
        },
      );
      const res = await getGitHubRateLimit();
      expect(res.data).toBeTruthy();
      expect(res.error).toBeUndefined();
    } finally {
      process.env.GITHUB_ACCESS_TOKEN = old;
    }
  });

  it("returns api_error on non-401 non-ok response (e.g., 500)", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      mockFetchResponse({
        status: 500,
        statusText: "Internal Server Error",
      }),
    );
    const res = await getGitHubRateLimit();
    expect(res.data).toBeNull();
    expect(res.error).toBe("api_error");
  });
});
