import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemStatus } from "@/types";

const scopedLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  withScope: vi.fn(() => scopedLogger),
};

vi.mock("@/lib/logger", () => ({ logger: scopedLogger }));
vi.mock("@/lib/storage/system-status", () => ({
  updateSystemStatus: vi.fn(),
}));

function status(overrides: Partial<SystemStatus> = {}): SystemStatus {
  return {
    latestKnownVersion: null,
    latestReleaseTitle: null,
    latestReleaseIsSecurity: null,
    latestSecurityVersion: null,
    lastCheckedAt: null,
    dismissedVersion: null,
    lastCheckError: null,
    ...overrides,
  };
}

function release(
  overrides: Partial<{
    tag_name: string;
    name: string | null;
    body: string | null;
    prerelease: boolean;
    draft: boolean;
  }> = {},
) {
  return {
    tag_name: "v2.0.0",
    name: "Version 2.0.0",
    body: null,
    prerelease: false,
    draft: false,
    ...overrides,
  };
}

describe("runtime/update-check", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("checks every stable version newer than the installed version", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify([
            release({ tag_name: "v2.5.0", name: "Version 2.5.0" }),
            release({
              tag_name: "v2.4.0",
              name: "Version 2.4.0",
              body: "Fixes GHSA-abcd-1234-wxyz.",
            }),
            release({
              tag_name: "v2.3.0-rc.1",
              name: "Security prerelease",
              body: "CVE-2026-12345",
              prerelease: true,
            }),
            release({
              tag_name: "v2.2.0",
              name: "Security draft",
              body: "CVE-2026-23456",
              draft: true,
            }),
            release({
              tag_name: "v1.9.0",
              name: "Old security release",
              body: "CVE-2026-34567",
            }),
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    const previousStatus = status({
      latestKnownVersion: "v2.5.0",
      latestReleaseTitle: "Version 2.5.0",
      latestReleaseIsSecurity: false,
      dismissedVersion: "v2.5.0",
    });
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(previousStatus),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    const result = await runApplicationUpdateCheck("2.0.0");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/iamspido/github-release-monitor/releases?per_page=100&page=1",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result).toEqual({
      latestKnownVersion: "v2.5.0",
      latestReleaseTitle: "Version 2.5.0",
      latestReleaseIsSecurity: false,
      latestSecurityVersion: "v2.4.0",
      lastCheckedAt: "2026-08-25T00:00:00.000Z",
      dismissedVersion: null,
      lastCheckError: null,
    });
  });

  it("paginates until every release has been checked", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      release({
        tag_name: `v3.0.0-rc.${index + 1}`,
        prerelease: true,
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstPage), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            release({
              tag_name: "v2.1.0",
              name: "Version 2.1.0",
              body: "Fixes a vulnerability.",
            }),
            release({ tag_name: "v2.0.0" }),
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(status()),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    const result = await runApplicationUpdateCheck("2.0.0");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
    expect(result.latestKnownVersion).toBe("v2.1.0");
    expect(result.latestSecurityVersion).toBe("v2.1.0");
    expect(result.latestReleaseIsSecurity).toBe(true);
  });

  it("fails without persisting when the release list exceeds the page limit", async () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      release({ tag_name: `v2.${index + 1}.0` }),
    );
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(page), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const updateSystemStatusMock = vi.fn();
    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) => {
      const current = status({
        lastCheckError: null,
      });
      const updated = updater(current);
      updateSystemStatusMock();
      return updated;
    });

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );

    const result = await runApplicationUpdateCheck("2.0.0");

    expect(result.lastCheckError).toBe("release_list_exceeds_5_pages");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("page=5");
    expect(updateSystemStatusMock).toHaveBeenCalledOnce();
  });

  it("keeps a dismissal when the latest pending security version is unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              release({ tag_name: "v2.5.0", name: "Version 2.5.0" }),
              release({ tag_name: "v2.4.0", body: "Security update" }),
            ]),
            { status: 200 },
          ),
      ),
    );
    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    const previousStatus = status({
      latestKnownVersion: "v2.5.0",
      latestReleaseIsSecurity: false,
      latestSecurityVersion: "v2.4.0",
      dismissedVersion: "v2.5.0",
    });
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(previousStatus),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    const result = await runApplicationUpdateCheck("2.0.0");

    expect(result.dismissedVersion).toBe("v2.5.0");
  });

  it("does not flag security releases at or below the installed version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              release({ tag_name: "v2.5.0", name: "Version 2.5.0" }),
              release({
                tag_name: "v2.0.0",
                name: "Old security release",
                body: "CVE-2026-12345",
              }),
            ]),
            { status: 200 },
          ),
      ),
    );
    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(status()),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    const result = await runApplicationUpdateCheck("2.0.0");

    expect(result.latestKnownVersion).toBe("v2.5.0");
    expect(result.latestReleaseIsSecurity).toBe(false);
    expect(result.latestSecurityVersion).toBeNull();
  });

  it("treats equivalent prefixed versions as up to date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([release({ tag_name: "v2.5.0" })]), {
            status: 200,
          }),
      ),
    );
    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(status()),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    await runApplicationUpdateCheck("2.5.0");

    expect(scopedLogger.info).toHaveBeenCalledWith(
      "No newer application release: current=2.5.0 latest=v2.5.0",
    );
    expect(scopedLogger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Update available"),
    );
  });

  it("captures HTTP errors from a later page", async () => {
    const firstPage = Array.from({ length: 100 }, () => release());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstPage), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 503,
          statusText: "Service Unavailable",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    const previousStatus = status();
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(previousStatus),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    const result = await runApplicationUpdateCheck("1.0.0");

    expect(result.lastCheckError).toBe("503 Service Unavailable");
    expect(result.latestKnownVersion).toBeNull();
    expect(scopedLogger.warn).toHaveBeenCalledWith(
      "Update check failed with HTTP error: 503 Service Unavailable",
    );
  });

  it("captures thrown errors and stores an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    const previousStatus = status();
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(previousStatus),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    const result = await runApplicationUpdateCheck("1.0.0");

    expect(result.lastCheckError).toBe("boom");
    expect(scopedLogger.error).toHaveBeenCalledWith(
      "Update check failed with exception:",
      expect.any(Error),
    );
  });

  it("serializes complete update checks", async () => {
    let resolveFirstResponse: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirstResponse = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { updateSystemStatus } = await import("@/lib/storage/system-status");
    vi.mocked(updateSystemStatus).mockImplementation(async (updater) =>
      updater(status()),
    );

    const { runApplicationUpdateCheck } = await import(
      "@/lib/runtime/update-check"
    );
    const firstCheck = runApplicationUpdateCheck("1.0.0");
    const secondCheck = runApplicationUpdateCheck("1.0.0");

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveFirstResponse?.(new Response(JSON.stringify([]), { status: 200 }));
    await Promise.all([firstCheck, secondCheck]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updateSystemStatus).toHaveBeenCalledTimes(2);
  });
});
