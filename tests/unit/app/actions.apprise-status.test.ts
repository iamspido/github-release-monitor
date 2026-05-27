// vitest globals enabled

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string, _vars?: Record<string, unknown>) =>
    key,
}));

describe("checkAppriseStatusAction", () => {
  const env = { ...process.env };
  const fetchBackup = global.fetch;
  beforeEach(() => {
    vi.resetModules();
    // @ts-expect-error
    global.fetch = vi.fn();
  });
  afterEach(() => {
    process.env = { ...env };
    global.fetch = fetchBackup;
  });

  it("returns not_configured when APPRISE_URL missing", async () => {
    delete process.env.APPRISE_URL;
    const { checkAppriseStatusAction } = await import("@/app/actions");
    const res = await checkAppriseStatusAction();
    expect(res).toEqual({ status: "not_configured" });
  });

  it("returns ok on 200 response", async () => {
    process.env.APPRISE_URL = "http://apprise.test/notify";
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 200 });
    const { checkAppriseStatusAction } = await import("@/app/actions");
    const res = await checkAppriseStatusAction();
    expect(res).toEqual({ status: "ok" });
  });

  it("returns error with status on non-200", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    // @ts-expect-error
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 503 });
    const { checkAppriseStatusAction } = await import("@/app/actions");
    const res = await checkAppriseStatusAction();
    expect(res.status).toBe("error");
  });

  it("returns error on fetch throw", async () => {
    process.env.APPRISE_URL = "http://apprise.test";
    // @ts-expect-error
    vi.mocked(global.fetch).mockRejectedValue(new Error("network"));
    const { checkAppriseStatusAction } = await import("@/app/actions");
    const res = await checkAppriseStatusAction();
    expect(res.status).toBe("error");
  });
});
