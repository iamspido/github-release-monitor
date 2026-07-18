import { describe, expect, it } from "vitest";
import {
  MAX_REPOSITORY_DISPLAY_NAME_LENGTH,
  normalizeRepositoryDisplayName,
} from "@/lib/repositories/display-name";

describe("normalizeRepositoryDisplayName", () => {
  it("trims valid names and treats blank names as unset", () => {
    expect(normalizeRepositoryDisplayName("  Production  ")).toEqual({
      success: true,
      displayName: "Production",
    });
    expect(normalizeRepositoryDisplayName("   ")).toEqual({
      success: true,
      displayName: undefined,
    });
  });

  it("rejects names that are too long or contain control characters", () => {
    expect(
      normalizeRepositoryDisplayName(
        "x".repeat(MAX_REPOSITORY_DISPLAY_NAME_LENGTH + 1),
      ),
    ).toEqual({ success: false });
    expect(normalizeRepositoryDisplayName("invalid\nname")).toEqual({
      success: false,
    });
  });
});
