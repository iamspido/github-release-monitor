import { NextRequest } from "next/server";

const users = vi.hoisted(
  () =>
    [] as Array<{
      email: string;
      username: string;
    }>,
);

const queryAllMock = vi.hoisted(() =>
  vi.fn((email: string, username: string) =>
    users
      .filter(
        (user) =>
          user.email.toLowerCase() === email.toLowerCase() ||
          user.username.toLowerCase() === username.toLowerCase(),
      )
      .map((user) => ({ email: user.email }))
      .slice(0, 2),
  ),
);
const logDebugMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/db", () => ({
  getAuthDb: () => ({
    prepare: () => ({ all: queryAllMock }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withScope: () => ({
      debug: logDebugMock,
    }),
  },
}));

import {
  normalizePasswordResetIdentifier,
  readPasswordResetIdentifierFromRequest,
  resolvePasswordResetEmail,
  rewritePasswordResetIdentifierRequest,
} from "@/lib/auth/password-reset-identifier";

describe("password reset identifiers", () => {
  beforeEach(() => {
    users.length = 0;
    queryAllMock.mockClear();
    logDebugMock.mockClear();
  });

  it.each(["Admin", "ADMIN@example.test"])(
    "resolves an existing account by %s",
    (identifier) => {
      users.push({
        email: "Admin@Example.Test",
        username: "admin",
      });

      expect(resolvePasswordResetEmail(identifier)).toBe("admin@example.test");
      expect(queryAllMock).toHaveBeenCalledWith(
        identifier.toLowerCase(),
        identifier.toLowerCase(),
      );
      expect(logDebugMock).toHaveBeenCalledWith(
        expect.stringMatching(
          /result='matched'.*masked='[aA]\*\*\*(?:@example\.test)?'.*identifier_hash='[a-f0-9]{12}'/,
        ),
      );
    },
  );

  it("removes invisible copy-and-paste artifacts from email identifiers", () => {
    const pastedEmail = "\u200e Admin\u00a0@\u200bExample.Test\ufeff \u200f";

    expect(normalizePasswordResetIdentifier(pastedEmail)).toBe(
      "admin@example.test",
    );
    users.push({ email: "admin@example.test", username: "admin" });
    expect(resolvePasswordResetEmail(pastedEmail)).toBe("admin@example.test");
    expect(logDebugMock).toHaveBeenCalledWith(
      expect.stringContaining("result='matched'"),
    );
  });

  it("does not remove ordinary internal whitespace from usernames", () => {
    expect(normalizePasswordResetIdentifier("admin user")).toBe("admin user");
  });

  it("reads and normalizes an identifier without consuming the request", async () => {
    const request = new Request(
      "http://localhost/api/auth/request-password-reset",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: " Admin@Example.Test " }),
      },
    );

    await expect(readPasswordResetIdentifierFromRequest(request)).resolves.toBe(
      "admin@example.test",
    );
    await expect(request.json()).resolves.toEqual({
      email: " Admin@Example.Test ",
    });
  });

  it("uses an empty rate-limit identifier for malformed request bodies", async () => {
    const request = new Request(
      "http://localhost/api/auth/request-password-reset",
      {
        method: "POST",
        body: "not-json",
      },
    );

    await expect(readPasswordResetIdentifierFromRequest(request)).resolves.toBe(
      "",
    );
  });

  it("uses an unregistered valid email for unknown and ambiguous identifiers", () => {
    const unknownEmail = resolvePasswordResetEmail("missing");
    expect(unknownEmail).toMatch(
      /^password-reset-[0-9a-f-]+@invalid\.example$/,
    );
    expect(unknownEmail).not.toContain("missing");
    expect(logDebugMock).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /result='not_found'.*type='username'.*masked='m\*\*\*'.*identifier_hash='[a-f0-9]{12}'/,
      ),
    );

    users.push(
      { email: "first@example.test", username: "shared" },
      { email: "second@example.test", username: "shared" },
    );
    expect(resolvePasswordResetEmail("shared")).toMatch(
      /^password-reset-[0-9a-f-]+@invalid\.example$/,
    );
    expect(logDebugMock).toHaveBeenLastCalledWith(
      expect.stringContaining("result='ambiguous'"),
    );
  });

  it("masks unknown email addresses in diagnostic logs", () => {
    resolvePasswordResetEmail("Missing.Person@Example.Test");

    expect(logDebugMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /result='not_found'.*type='email'.*masked='m\*\*\*@example\.test'.*identifier_hash='[a-f0-9]{12}'/,
      ),
    );
    expect(logDebugMock.mock.calls.flat().join(" ")).not.toContain(
      "missing.person@example.test",
    );
  });

  it("does not forward an invalid stored email to Better Auth", () => {
    users.push({ email: "not-an-email", username: "legacy" });

    expect(resolvePasswordResetEmail("legacy")).toMatch(
      /^password-reset-[0-9a-f-]+@invalid\.example$/,
    );
    expect(logDebugMock).toHaveBeenCalledWith(
      expect.stringContaining("result='invalid_stored_email'"),
    );
  });

  it("rewrites only the identifier while preserving reset request metadata", async () => {
    users.push({ email: "admin@example.test", username: "admin" });
    const request = new Request(
      "http://localhost/api/auth/request-password-reset",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=value",
        },
        body: JSON.stringify({
          email: "Admin",
          redirectTo: "/en/reset-password",
        }),
      },
    );

    const rewritten = await rewritePasswordResetIdentifierRequest(request);

    await expect(rewritten.json()).resolves.toEqual({
      email: "admin@example.test",
      redirectTo: "/en/reset-password",
    });
    expect(rewritten.headers.get("cookie")).toBe("session=value");
    expect(await request.json()).toEqual({
      email: "Admin",
      redirectTo: "/en/reset-password",
    });
  });

  it("converts a NextRequest into a plain Request before forwarding it", async () => {
    users.push({ email: "admin@example.test", username: "admin" });
    const request = new NextRequest(
      "http://localhost/api/auth/request-password-reset",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=value",
        },
        body: JSON.stringify({
          email: "admin",
          redirectTo: "/en/reset-password",
        }),
      },
    );

    const rewritten = await rewritePasswordResetIdentifierRequest(request);

    expect(rewritten).toBeInstanceOf(Request);
    expect(rewritten).not.toBeInstanceOf(NextRequest);
    expect(rewritten.url).toBe(request.url);
    expect(rewritten.method).toBe("POST");
    expect(rewritten.headers.get("cookie")).toBe("session=value");
    await expect(rewritten.json()).resolves.toEqual({
      email: "admin@example.test",
      redirectTo: "/en/reset-password",
    });
  });

  it("leaves malformed request bodies for Better Auth to reject", async () => {
    const request = new Request(
      "http://localhost/api/auth/request-password-reset",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      },
    );

    await expect(rewritePasswordResetIdentifierRequest(request)).resolves.toBe(
      request,
    );
    expect(queryAllMock).not.toHaveBeenCalled();
  });
});
