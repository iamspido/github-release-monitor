import { describe, expect, it } from "vitest";
import {
  isolateAutoText,
  isolateLtrText,
  stripBidiControlCharacters,
} from "@/lib/bidi";

describe("bidi text isolation", () => {
  it("removes embedded directional controls before isolating untrusted text", () => {
    const value = "v1\u2069spoof\u202eright-to-left\u061c";

    expect(stripBidiControlCharacters(value)).toBe("v1spoofright-to-left");
    expect(isolateLtrText(value)).toBe("\u2066v1spoofright-to-left\u2069");
    expect(isolateAutoText(value)).toBe("\u2068v1spoofright-to-left\u2069");
  });

  it("preserves ordinary Arabic and Latin content", () => {
    expect(stripBidiControlCharacters("الإصدار v2.0")).toBe("الإصدار v2.0");
  });
});
