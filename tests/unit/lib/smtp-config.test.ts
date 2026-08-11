import {
  parseSmtpPort,
  parseSmtpTlsRejectUnauthorized,
} from "@/lib/smtp-config";

describe("SMTP configuration", () => {
  it.each([undefined, "", "true", "TRUE", " false ", "0", "invalid"])(
    "keeps TLS certificate verification enabled for %j",
    (value) => {
      expect(parseSmtpTlsRejectUnauthorized(value)).toBe(true);
    },
  );

  it("disables TLS certificate verification only for exact false", () => {
    expect(parseSmtpTlsRejectUnauthorized("false")).toBe(false);
  });

  it("continues to parse valid SMTP ports", () => {
    expect(parseSmtpPort("587")).toBe(587);
  });
});
