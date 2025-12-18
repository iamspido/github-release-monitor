// vitest globals enabled

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  unstable_cache: (fn: any) => fn,
  updateTag: () => {},
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

describe("resolveRepoProvidersAction", () => {
  const fetchBackup = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    // @ts-ignore
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = fetchBackup;
    delete process.env.GITHUB_ACCESS_TOKEN;
    delete process.env.CODEBERG_ACCESS_TOKEN;
  });

  it("returns only the provider that exists", async () => {
    const actions = await import("@/app/actions");

    // @ts-ignore
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);
    expect(res.candidates).toEqual([
      {
        provider: "github",
        id: "github:owner/repo",
        canonicalRepoUrl: "https://github.com/owner/repo",
      },
    ]);
  });

  it("returns multiple candidates when they all exist", async () => {
    const actions = await import("@/app/actions");

    // @ts-ignore
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK" });

    const res = await actions.resolveRepoProvidersAction("owner/repo");
    expect(res.success).toBe(true);
    expect(res.candidates.map((c) => c.provider).sort()).toEqual([
      "codeberg",
      "github",
    ]);
  });

  it("does nothing for non-shorthand inputs", async () => {
    const actions = await import("@/app/actions");

    const res = await actions.resolveRepoProvidersAction(
      "https://github.com/owner/repo",
    );
    expect(res.success).toBe(true);
    expect(res.candidates).toEqual([]);
    expect((global.fetch as any).mock.calls.length).toBe(0);
  });
});

