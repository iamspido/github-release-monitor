import { beforeEach, describe, expect, it, vi } from "vitest";

const getLocaleSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/storage/settings", () => ({
  getLocaleSetting: getLocaleSettingMock,
}));

describe("api/settings-locale route", () => {
  beforeEach(() => {
    vi.resetModules();
    getLocaleSettingMock.mockReset();
  });

  it("returns the stored locale", async () => {
    getLocaleSettingMock.mockResolvedValue("ar");
    const { GET, runtime } = await import("@/app/api/settings-locale/route");

    const response = await GET();

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ locale: "ar" });
  });

  it("returns a stable 500 response when settings cannot be read", async () => {
    getLocaleSettingMock.mockRejectedValue(new Error("storage unavailable"));
    const { GET } = await import("@/app/api/settings-locale/route");

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "settings_unavailable",
    });
  });
});
