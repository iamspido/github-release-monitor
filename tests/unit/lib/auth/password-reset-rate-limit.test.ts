import {
  clearPasswordResetRateLimitForTests,
  consumePasswordResetRequest,
} from "@/lib/auth/password-reset-rate-limit";

describe("password reset request rate limit", () => {
  beforeEach(() => {
    clearPasswordResetRateLimitForTests();
  });

  it("allows three requests per minute and returns an exact retry delay", () => {
    expect(
      consumePasswordResetRequest("192.0.2.1", "admin", 1_000).allowed,
    ).toBe(true);
    expect(
      consumePasswordResetRequest("192.0.2.1", "admin", 2_000).allowed,
    ).toBe(true);
    expect(
      consumePasswordResetRequest("192.0.2.1", "admin", 3_000).allowed,
    ).toBe(true);

    expect(consumePasswordResetRequest("192.0.2.1", "admin", 4_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 57,
    });
    expect(consumePasswordResetRequest("192.0.2.1", "admin", 61_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("keeps different client addresses independent", () => {
    for (let count = 0; count < 3; count += 1) {
      consumePasswordResetRequest("192.0.2.1", `user-${count}`, count);
    }

    expect(
      consumePasswordResetRequest("192.0.2.1", "fourth-user", 3).allowed,
    ).toBe(false);
    expect(
      consumePasswordResetRequest("192.0.2.2", "another-user", 3).allowed,
    ).toBe(true);
  });

  it("keeps unknown client addresses independent by identifier", () => {
    for (let count = 0; count < 3; count += 1) {
      consumePasswordResetRequest("unknown", "first-user", count);
    }

    expect(
      consumePasswordResetRequest("unknown", "second-user", 3).allowed,
    ).toBe(true);
    expect(
      consumePasswordResetRequest("unknown", "first-user", 3).allowed,
    ).toBe(false);
  });

  it("limits one identifier across different or spoofed client addresses", () => {
    for (let count = 0; count < 3; count += 1) {
      consumePasswordResetRequest(
        `192.0.2.${count + 1}`,
        "Admin@Example.Test",
        count,
      );
    }

    expect(
      consumePasswordResetRequest("192.0.2.99", "admin@example.test", 3)
        .allowed,
    ).toBe(false);
  });
});
