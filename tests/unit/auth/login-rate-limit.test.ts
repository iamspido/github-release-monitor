import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("login rate limit storage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    (globalThis as Record<string, unknown>)._authLoginAttempts = undefined;
    (globalThis as Record<string, unknown>)._authLoginOverflowAttempts =
      undefined;
    (globalThis as Record<string, unknown>)._authLoginAttemptsInFlight =
      undefined;
    (globalThis as Record<string, unknown>)._authLoginAttemptWaiters =
      undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("evicts least-recently-used entries when the store reaches its limit", async () => {
    const {
      getFailedLoginFailures,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    for (let index = 0; index <= MAX_LOGIN_RATE_LIMIT_ENTRIES; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, index);
    }

    const store = (
      globalThis as typeof globalThis & {
        _authLoginAttempts?: Map<string, unknown>;
      }
    )._authLoginAttempts;
    expect(store?.size).toBe(MAX_LOGIN_RATE_LIMIT_ENTRIES);
    expect(getFailedLoginFailures("client:0")).toBe(0);
    expect(
      getFailedLoginFailures(`client:${MAX_LOGIN_RATE_LIMIT_ENTRIES}`),
    ).toBe(1);
  });

  it("runs the full expiry sweep at most once per pruning interval", async () => {
    process.env.AUTH_LOGIN_WINDOW_SECONDS = "1";
    const {
      getFailedLoginFailures,
      pruneFailedLoginState,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    registerFailedLoginAttempt("client:old", 0);
    pruneFailedLoginState(1);
    pruneFailedLoginState(2_000);
    expect(getFailedLoginFailures("client:old")).toBe(1);

    pruneFailedLoginState(60_001);
    expect(getFailedLoginFailures("client:old")).toBe(0);
  });

  it("activates a lockout on the first failure when the limit is one", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    const { isLoginRateLimited, registerFailedLoginAttempt } = await import(
      "@/lib/auth/login-rate-limit"
    );

    const result = registerFailedLoginAttempt("client:locked", 0);

    expect(result.lockoutTriggered).toBe(true);
    expect(isLoginRateLimited("client:locked", 1)).toBe(true);
  });

  it("keeps actively blocked clients recent during LRU eviction", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    const {
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    registerFailedLoginAttempt("client:locked", 0);
    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES - 1; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, index);
    }

    expect(isLoginRateLimited("client:locked", 1)).toBe(true);
    registerFailedLoginAttempt("client:new", 2);

    expect(isLoginRateLimited("client:locked", 2)).toBe(true);
  });

  it("never evicts an active lockout to admit a new client", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "2";
    const {
      getFailedLoginFailures,
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    registerFailedLoginAttempt("client:locked", 0);
    registerFailedLoginAttempt("client:locked", 1);
    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES - 1; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, index + 2);
    }

    registerFailedLoginAttempt("client:new", MAX_LOGIN_RATE_LIMIT_ENTRIES + 2);

    expect(
      isLoginRateLimited("client:locked", MAX_LOGIN_RATE_LIMIT_ENTRIES + 3),
    ).toBe(true);
    expect(getFailedLoginFailures("client:locked")).toBe(2);
    expect(getFailedLoginFailures("client:0")).toBe(0);
    expect(getFailedLoginFailures("client:new")).toBe(1);
  });

  it("scopes overflow lockouts when every primary entry is active", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    const {
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES; index += 1) {
      registerFailedLoginAttempt(`client:${index}`, 0);
    }
    registerFailedLoginAttempt("client:overflow", 1);

    expect(isLoginRateLimited("client:overflow", 2)).toBe(true);
    expect(isLoginRateLimited("client:unseen", 2)).toBe(false);
    expect(isLoginRateLimited("client:overflow", 60_001)).toBe(false);
  });

  it("bounds exact overflow entries without globally blocking new clients", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "1";
    process.env.AUTH_LOGIN_LOCKOUT_SECONDS = "60";
    const {
      isLoginRateLimited,
      MAX_LOGIN_RATE_LIMIT_ENTRIES,
      MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES,
      registerFailedLoginAttempt,
    } = await import("@/lib/auth/login-rate-limit");

    for (let index = 0; index < MAX_LOGIN_RATE_LIMIT_ENTRIES; index += 1) {
      registerFailedLoginAttempt(`client:primary:${index}`, 0);
    }
    for (
      let index = 0;
      index < MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES;
      index += 1
    ) {
      registerFailedLoginAttempt(`client:overflow:${index}`, 1);
    }
    registerFailedLoginAttempt("client:overflow:new", 2);

    const overflowStore = (
      globalThis as typeof globalThis & {
        _authLoginOverflowAttempts?: Map<string, unknown>;
      }
    )._authLoginOverflowAttempts;
    expect(overflowStore?.size).toBe(MAX_LOGIN_RATE_LIMIT_OVERFLOW_ENTRIES);
    expect(isLoginRateLimited("client:primary:0", 3)).toBe(true);
    expect(isLoginRateLimited("client:overflow:0", 3)).toBe(false);
    expect(isLoginRateLimited("client:overflow:new", 3)).toBe(true);
    expect(isLoginRateLimited("client:unseen", 3)).toBe(false);
  });

  it("locks account-wide keys at four times the attempt limit", async () => {
    const { isLoginRateLimited, registerFailedLoginAttempt } = await import(
      "@/lib/auth/login-rate-limit"
    );

    const account = Array.from({ length: 20 }, () =>
      registerFailedLoginAttempt("account:hash", 0),
    );
    const address = Array.from({ length: 5 }, () =>
      registerFailedLoginAttempt("ip:198.51.100.20", 0),
    );

    expect({
      accountActivatedAt:
        account.findIndex((result) => result.lockoutTriggered) + 1,
      accountLimit: account[0]?.limit,
      addressActivatedAt:
        address.findIndex((result) => result.lockoutTriggered) + 1,
      addressLimit: address[0]?.limit,
      accountLocked: isLoginRateLimited("account:hash", 1),
    }).toEqual({
      accountActivatedAt: 20,
      accountLimit: 20,
      addressActivatedAt: 5,
      addressLimit: 5,
      accountLocked: true,
    });
  });

  it("derives the account-wide limit from the bounded attempt limit", async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = "500";
    const { registerFailedLoginAttempt } = await import(
      "@/lib/auth/login-rate-limit"
    );

    const account = Array.from({ length: 80 }, () =>
      registerFailedLoginAttempt("account:hash", 0),
    );
    const address = Array.from({ length: 20 }, () =>
      registerFailedLoginAttempt("ip:198.51.100.20", 0),
    );

    expect({
      accountActivatedAt:
        account.findIndex((result) => result.lockoutTriggered) + 1,
      addressActivatedAt:
        address.findIndex((result) => result.lockoutTriggered) + 1,
    }).toEqual({ accountActivatedAt: 80, addressActivatedAt: 20 });
  });

  it("reports the bucket closest to its lockout with that bucket's own limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { logFailedLoginAttempt, registerFailedLoginAttempt } = await import(
      "@/lib/auth/login-rate-limit"
    );

    for (let index = 0; index < 18; index += 1) {
      registerFailedLoginAttempt([`ip:198.51.100.${index}`, "account:hash"], 0);
    }
    const accountCloser = registerFailedLoginAttempt(
      ["ip:203.0.113.1", "account:hash"],
      0,
    );
    for (let index = 0; index < 3; index += 1) {
      registerFailedLoginAttempt(
        ["ip:203.0.113.2", `account:other${index}`],
        0,
      );
    }
    const addressCloser = registerFailedLoginAttempt(
      ["ip:203.0.113.2", "account:another"],
      0,
    );
    logFailedLoginAttempt({
      identifier: "user@example.test",
      clientIp: "203.0.113.1",
      reason: "invalid_credentials",
      result: accountCloser,
    });

    expect({
      accountCloser,
      addressCloser,
      line: warn.mock.calls.at(-1)?.[0],
    }).toEqual({
      accountCloser: {
        lockoutTriggered: false,
        failures: 19,
        limit: 20,
        attemptsRemaining: 1,
        lockoutRemainingSeconds: 0,
      },
      addressCloser: {
        lockoutTriggered: false,
        failures: 4,
        limit: 5,
        attemptsRemaining: 1,
        lockoutRemainingSeconds: 0,
      },
      line: expect.stringContaining(
        "attempts=19/20, remaining_before_lockout=1.",
      ),
    });
    warn.mockRestore();
  });

  it("activates a lockout once, so a failure on a locked key triggers nothing", async () => {
    const { registerFailedLoginAttempt } = await import(
      "@/lib/auth/login-rate-limit"
    );
    const key = ["identifier:locked"];

    const results = Array.from({ length: 7 }, () =>
      registerFailedLoginAttempt(key, Date.now()),
    );

    expect(results.map((result) => result.lockoutTriggered)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  describe("login attempt reservations", () => {
    const reservationStores = globalThis as typeof globalThis & {
      _authLoginAttemptsInFlight?: Map<string, number>;
    };
    const leftInFlight = () =>
      reservationStores._authLoginAttemptsInFlight?.size ?? 0;
    const settle = () =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

    it("near the limit a further attempt waits for the one in flight: refused unchecked after it fails, admitted after it succeeds", async () => {
      const limit = await import("@/lib/auth/login-rate-limit");
      expect(typeof limit.reserveLoginAttempt).toBe("function");
      const failing = ["identifier:wait-failure"];
      const succeeding = ["identifier:wait-success"];
      for (let index = 0; index < 4; index += 1) {
        limit.registerFailedLoginAttempt(failing, Date.now());
        limit.registerFailedLoginAttempt(succeeding, Date.now());
      }
      const held = async (key: string[]) => {
        let admission: Awaited<
          ReturnType<typeof limit.reserveLoginAttempt>
        > | null = null;
        const promise = limit.reserveLoginAttempt(key).then((result) => {
          admission = result;
          return result;
        });
        await settle();
        return { promise, now: () => admission };
      };

      const first = await limit.reserveLoginAttempt(failing);
      const second = await held(failing);
      const whileFirstInFlight = second.now();
      const failure = first.reservation?.fail();
      const afterFailure = await second.promise;

      const third = await limit.reserveLoginAttempt(succeeding);
      const fourth = await held(succeeding);
      const whileThirdInFlight = fourth.now();
      third.reservation?.succeed();
      const afterSuccess = await fourth.promise;
      afterSuccess.reservation?.release();

      expect({
        firstAdmitted: first.reservation !== null,
        whileFirstInFlight,
        lockoutTriggered: failure?.lockoutTriggered,
        afterFailure: afterFailure.reservation,
        remaining: afterFailure.lockoutRemainingSeconds,
        thirdAdmitted: third.reservation !== null,
        whileThirdInFlight,
        afterSuccess: afterSuccess.reservation !== null,
        leftInFlight: leftInFlight(),
      }).toEqual({
        firstAdmitted: true,
        whileFirstInFlight: null,
        lockoutTriggered: true,
        afterFailure: null,
        remaining: 900,
        thirdAdmitted: true,
        whileThirdInFlight: null,
        afterSuccess: true,
        leftInFlight: 0,
      });
    });

    it.each(["fail", "succeed", "release"] as const)(
      "ends a reservation once: after %s, a further fail or succeed throws and books nothing, and a further release does nothing",
      async (firstEnd) => {
        const limit = await import("@/lib/auth/login-rate-limit");
        const key = ["identifier:ended"];
        limit.registerFailedLoginAttempt(key, Date.now());
        const { reservation } = await limit.reserveLoginAttempt(key);
        if (!reservation) throw new Error("The attempt was not admitted.");
        reservation[firstEnd]();
        const failuresAfterEnd = limit.getFailedLoginFailures(key);
        const outcome = (end: () => unknown) => {
          try {
            end();
            return "returned";
          } catch (error) {
            return error instanceof Error ? "threw an Error" : "threw";
          }
        };

        const furtherFail = outcome(() => reservation.fail());
        const failuresAfterFurtherFail = limit.getFailedLoginFailures(key);
        const furtherSucceed = outcome(() => reservation.succeed());
        const failuresAfterFurtherSucceed = limit.getFailedLoginFailures(key);
        const furtherRelease = outcome(() => reservation.release());

        expect({
          furtherFail,
          failuresAfterFurtherFail,
          furtherSucceed,
          failuresAfterFurtherSucceed,
          furtherRelease,
          leftInFlight: leftInFlight(),
        }).toEqual({
          furtherFail: "threw an Error",
          failuresAfterFurtherFail: failuresAfterEnd,
          furtherSucceed: "threw an Error",
          failuresAfterFurtherSucceed: failuresAfterEnd,
          furtherRelease: "returned",
          leftInFlight: 0,
        });
      },
    );

    it("counts the attempts in flight against each key's own limit", async () => {
      const limit = await import("@/lib/auth/login-rate-limit");
      expect(typeof limit.reserveLoginAttempt).toBe("function");
      const address = ["ip:198.51.100.30"];
      const account = ["account:in-flight"];
      for (let index = 0; index < 3; index += 1) {
        limit.registerFailedLoginAttempt(address, Date.now());
        limit.registerFailedLoginAttempt(account, Date.now());
      }

      const admitted = [
        await limit.reserveLoginAttempt(address),
        await limit.reserveLoginAttempt(address),
        await limit.reserveLoginAttempt(account),
        await limit.reserveLoginAttempt(account),
      ];
      let addressAdmission: Awaited<
        ReturnType<typeof limit.reserveLoginAttempt>
      > | null = null;
      let accountAdmission: Awaited<
        ReturnType<typeof limit.reserveLoginAttempt>
      > | null = null;
      const pendingAddress = limit
        .reserveLoginAttempt(address)
        .then((result) => {
          addressAdmission = result;
          return result;
        });
      const pendingAccount = limit
        .reserveLoginAttempt(account)
        .then((result) => {
          accountAdmission = result;
          return result;
        });
      await settle();
      const addressWaits = addressAdmission === null;
      const accountWaits = accountAdmission === null;
      for (const admission of admitted) admission.reservation?.release();
      (await pendingAddress).reservation?.release();
      (await pendingAccount).reservation?.release();

      expect({
        admitted: admitted.filter((admission) => admission.reservation).length,
        addressWaits,
        accountWaits,
        leftInFlight: leftInFlight(),
      }).toEqual({
        admitted: 4,
        addressWaits: true,
        accountWaits: false,
        leftInFlight: 0,
      });
    });

    it.each([
      [
        "a login without a client address",
        ["identifier:victim", "account:victim"],
      ],
      [
        "a login from a fixed client address",
        ["ip:192.0.2.10", "ip-identifier:192.0.2.10:victim", "account:victim"],
      ],
      ["a current-password confirmation", ["step-up:victim"]],
    ] as const)(
      "a store full of unlocked buckets with two failures each still locks %s at its fifth failure and refuses it unchecked from then on",
      async (_attempt, keys) => {
        const limit = await import("@/lib/auth/login-rate-limit");
        const stores = globalThis as typeof globalThis & {
          _authLoginAttempts?: Map<string, unknown>;
          _authLoginOverflowAttempts?: Map<string, unknown>;
        };
        for (
          let index = 0;
          index < limit.MAX_LOGIN_RATE_LIMIT_ENTRIES / 2;
          index += 1
        ) {
          for (let failure = 0; failure < 2; failure += 1) {
            limit.registerFailedLoginAttempt(
              [`identifier:filler${index}`, `account:filler${index}`],
              Date.now(),
            );
          }
        }
        const filled = stores._authLoginAttempts?.size;

        const answers: string[] = [];
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          limit.registerFailedLoginAttempt(
            [`identifier:fresh${attempt}`, `account:fresh${attempt}`],
            Date.now(),
          );
          const { reservation } = await limit.reserveLoginAttempt(keys);
          if (!reservation) {
            answers.push("refused unchecked");
            continue;
          }
          answers.push(
            reservation.fail().lockoutTriggered ? "locked" : "failed",
          );
        }

        expect({
          filled,
          answers,
          overflow: stores._authLoginOverflowAttempts?.size,
          leftInFlight: leftInFlight(),
        }).toEqual({
          filled: limit.MAX_LOGIN_RATE_LIMIT_ENTRIES,
          answers: [
            ...Array.from({ length: 4 }, () => "failed"),
            "locked",
            ...Array.from({ length: 5 }, () => "refused unchecked"),
          ],
          overflow: 0,
          leftInFlight: 0,
        });
      },
    );
  });
});
