import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthAccess: vi.fn(),
  getAuthenticatedUserId: vi.fn(),
  getClientIp: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/lib/auth/access", () => ({
  getAuthAccessForHeaders: mocks.getAuthAccess,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getClientIpFromRequest: mocks.getClientIp,
}));
vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUserId: mocks.getAuthenticatedUserId,
}));
vi.mock("@/lib/runtime/update-notice-bus", () => ({
  subscribeToUpdateNotice: mocks.subscribe,
}));

function authAccess(
  authenticationMethod: "Basic" | "AllowUnauthenticated" | "External",
  canMutate: boolean,
) {
  return {
    authenticationMethod,
    isAuthenticated: canMutate,
    canMutate,
    canAccessRestrictedPages: canMutate,
    showLogin: false,
    showLogout: false,
    showSettings: canMutate,
    showTest: canMutate,
  };
}

describe("GET /api/update-notice/stream", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue(null);
    mocks.getClientIp.mockReturnValue("203.0.113.10");
    mocks.subscribe.mockReturnValue(mocks.unsubscribe);
  });

  it("allows the public read-only mode and cleans up the stream", async () => {
    mocks.getAuthAccess.mockResolvedValue(
      authAccess("AllowUnauthenticated", false),
    );
    const request = new Request("http://localhost/api/update-notice/stream");
    const { GET } = await import("@/app/api/update-notice/stream/route");

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(mocks.getAuthenticatedUserId).toHaveBeenCalledWith(request.headers);
    expect(mocks.getClientIp).toHaveBeenCalledWith(request);
    expect(mocks.subscribe).toHaveBeenCalledOnce();

    await response.body?.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("hides the stream from unauthenticated Basic requests", async () => {
    mocks.getAuthAccess.mockResolvedValue(authAccess("Basic", false));
    const { GET } = await import("@/app/api/update-notice/stream/route");

    const response = await GET(
      new Request("http://localhost/api/update-notice/stream"),
    );

    expect(response.status).toBe(404);
    expect(mocks.getAuthenticatedUserId).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("limits identified clients and releases their slots", async () => {
    mocks.getAuthAccess.mockResolvedValue(authAccess("External", true));
    const { GET } = await import("@/app/api/update-notice/stream/route");
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        GET(new Request("http://localhost/api/update-notice/stream")),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 429,
    ]);

    await Promise.all(
      responses.slice(0, 5).map((response) => response.body?.cancel()),
    );
    const recovered = await GET(
      new Request("http://localhost/api/update-notice/stream"),
    );
    expect(recovered.status).toBe(200);
    await recovered.body?.cancel();
  });
});
