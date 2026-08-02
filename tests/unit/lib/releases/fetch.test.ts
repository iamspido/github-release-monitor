import { discardResponseWithTimeout } from "@/lib/http/fetch-with-timeout";
import {
  fetchJsonResponseWithRetryAuthChain,
  fetchResponseWithRetryAuthChain,
} from "@/lib/releases/fetch";
import { installFetchMock, mockFetchResponse } from "../../helpers/fetch";

describe("release fetch authentication chains", () => {
  const fetchBackup = global.fetch;
  const authChain = [
    {
      mode: "token" as const,
      options: { headers: { Authorization: "token x" } },
    },
    {
      mode: "bearer" as const,
      options: { headers: { Authorization: "Bearer x" } },
    },
    { mode: "none" as const, options: {} },
  ];

  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    global.fetch = fetchBackup;
  });

  it("stops JSON auth fallback on a rate-limited 403 response", async () => {
    const response = mockFetchResponse({
      status: 403,
      headers: { "retry-after": "60" },
      text: "slow down",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(response);

    const result = await fetchJsonResponseWithRetryAuthChain<unknown>(
      "https://api.example.test/data",
      authChain,
    );

    expect(result.mode).toBe("token");
    expect(result.response).toBe(response);
    expect(global.fetch).toHaveBeenCalledOnce();
    await discardResponseWithTimeout(response);
  });

  it("stops raw-response auth fallback on a rate-limited 403 response", async () => {
    const response = mockFetchResponse({
      status: 403,
      headers: { "retry-after": "60" },
      text: "slow down",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(response);

    const result = await fetchResponseWithRetryAuthChain(
      "https://api.example.test/data",
      authChain,
    );

    expect(result.mode).toBe("token");
    expect(result.response).toBe(response);
    expect(global.fetch).toHaveBeenCalledOnce();
    await discardResponseWithTimeout(response);
  });
});
