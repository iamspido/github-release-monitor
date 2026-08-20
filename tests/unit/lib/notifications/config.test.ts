import { getReleaseMonitorUrl } from "@/lib/notifications/config";

describe("notification URL configuration", () => {
  it("builds a localized monitor URL from the canonical browser URL", () => {
    expect(
      getReleaseMonitorUrl("pt-BR", {
        BETTER_AUTH_URL:
          "https://ignored:secret@monitor.example/base?source=old#section",
      }),
    ).toBe("https://monitor.example/pt-BR");
  });

  it("supports the legacy Better Auth base URL fallback", () => {
    expect(
      getReleaseMonitorUrl("de", {
        BETTER_AUTH_BASE_URL: "https://monitor.example/",
      }),
    ).toBe("https://monitor.example/de");
  });

  it.each([undefined, "not a URL", "file:///tmp/monitor"])(
    "omits an unusable canonical URL: %s",
    (configuredUrl) => {
      expect(
        getReleaseMonitorUrl("en", { BETTER_AUTH_URL: configuredUrl }),
      ).toBeUndefined();
    },
  );
});
