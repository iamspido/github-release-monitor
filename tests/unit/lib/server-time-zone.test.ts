import { describe, expect, it, vi } from "vitest";

const { warnMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: () => ({
      warn: warnMock,
    }),
  },
}));

import { getServerTimeZone } from "@/lib/server-time-zone";

describe("server timezone", () => {
  it("uses a valid configured IANA timezone", () => {
    expect(getServerTimeZone("Europe/Berlin", "UTC")).toBe("Europe/Berlin");
  });

  it("uses the runtime timezone when TZ is missing", () => {
    expect(getServerTimeZone(undefined, "America/New_York")).toBe(
      "America/New_York",
    );
  });

  it("falls back after an invalid configured timezone", () => {
    expect(getServerTimeZone("Invalid/Timezone", "UTC")).toBe("UTC");
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining("Invalid server timezone"),
      expect.any(RangeError),
    );
  });

  it("warns and uses UTC when no timezone source can be resolved", () => {
    expect(getServerTimeZone(undefined, "Invalid/Runtime")).toBe("UTC");
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining("Invalid runtime timezone"),
      expect.any(RangeError),
    );
  });
});
