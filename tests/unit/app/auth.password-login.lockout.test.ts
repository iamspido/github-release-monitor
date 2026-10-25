import { createHmac } from "node:crypto";
import { formatWithOptions } from "node:util";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real login route and Better Auth instance lock out online guessing per
// address and per identifier across addresses, also when concurrent (CWE-307).

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/auth/db", () => ({
  authDbPath: ":memory:",
  getAuthDb: () => holder.db,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

const ORIGIN = "http://localhost:3000";
const PASSWORD = "MemberPassword1-long";
const EMAIL = "member@lockout.example.test";
const USERNAME = "lockout_member";
const OTHER_EMAIL = "other@lockout.example.test";
const OTHER_USERNAME = "lockout_other";
const HOME = "198.51.100.7";
const NO_ADDRESS = null;
const START = new Date("2026-10-24T08:00:00.000Z");
const LOCKOUT_MS = 15 * 60 * 1_000;
const BURST = 12;

type LoginAnswer = {
  errorKey?: string;
  redirectTo?: string;
  requiresTwoFactor?: boolean;
};

let logged: string[] = [];
let warned: string[] = [];

const loginStores = globalThis as typeof globalThis & {
  _authLoginAttempts?: Map<string, unknown>;
  _authLoginOverflowAttempts?: Map<string, unknown>;
  _authLoginAttemptsInFlight?: Map<string, number>;
  _authLoginAttemptWaiters?: Set<() => void>;
};
const database = () => holder.db as InstanceType<typeof Database>;
const sessions = () =>
  (
    database().prepare("SELECT count(*) AS count FROM session").get() as {
      count: number;
    }
  ).count;
const wrong = (n: number) => `Wrong${n}Password-long`;
const address = (n: number) => `203.0.113.${n}`;
const lockoutLines = () =>
  logged.filter((line) => line.includes("lockout activated"));
const count = (values: unknown[]) =>
  values.reduce<Record<string, number>>((all, value) => {
    all[String(value)] = (all[String(value)] ?? 0) + 1;
    return all;
  }, {});
const leftInFlight = () => loginStores._authLoginAttemptsInFlight?.size ?? 0;
const cookieHeader = (setCookies: string[]) =>
  setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
const hasSessionCookie = (setCookies: string[]) =>
  setCookies.some((cookie) => /session_token=[^;]/.test(cookie));

function totp(base32: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const at = digest[digest.length - 1] & 0xf;
  const code = (digest.readUInt32BE(at) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

async function member(email = EMAIL, username = USERNAME) {
  const { setupAuth } = await import("@/lib/auth");
  await setupAuth.api.signUpEmail({
    body: { name: "Member", email, password: PASSWORD, username } as never,
  });
}

async function countPasswordChecks() {
  const { auth } = await import("@/lib/auth");
  const byEmail = vi.spyOn(auth.api, "signInEmail");
  const byUsername = vi.spyOn(auth.api, "signInUsername");
  return () => byEmail.mock.calls.length + byUsername.mock.calls.length;
}

async function login(
  identifier: string,
  password: string,
  ip: string | typeof NO_ADDRESS,
) {
  const route = await import("@/app/api/login/password/route");
  const response = await route.POST(
    new Request(`${ORIGIN}/api/login/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        ...(ip === NO_ADDRESS ? {} : { "x-forwarded-for": ip }),
      },
      body: JSON.stringify({ identifier, password, locale: "en" }),
    }),
  );
  return {
    status: response.status,
    answer: (await response.json()) as LoginAnswer,
    cookies: response.headers.getSetCookie(),
  };
}

async function authRoute(
  method: "GET" | "POST",
  action: string,
  options: { body?: unknown; cookie?: string; ip?: string } = {},
) {
  const route = await import("@/app/api/auth/[...all]/route");
  return route[method](
    new Request(`${ORIGIN}/api/auth/${action}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": options.ip ?? HOME,
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      ...(method === "POST"
        ? { body: JSON.stringify(options.body ?? {}) }
        : {}),
    }),
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
  vi.stubEnv("AUTH_TRUST_PROXY_HEADERS", "true");
  loginStores._authLoginAttempts?.clear();
  loginStores._authLoginOverflowAttempts?.clear();
  loginStores._authLoginAttemptsInFlight = undefined;
  loginStores._authLoginAttemptWaiters = undefined;
  holder.db = new Database(":memory:");
  const { ensureAuthDatabaseReady } = await import("@/lib/auth");
  await ensureAuthDatabaseReady();
  logged = [];
  warned = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      const line = formatWithOptions({ depth: 8 }, ...args);
      logged.push(line);
      if (method === "warn") warned.push(line);
    });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  database().close();
});

describe("account-wide password login limit", () => {
  it.each([
    ["unset (2.x compatibility default)", undefined],
    ["true", "true"],
  ] as const)(
    "with AUTH_TRUST_PROXY_HEADERS %s, 20 wrong passwords from 20 client addresses lock the account; later attempts are refused unchecked",
    async (_trust, trust) => {
      vi.stubEnv("AUTH_TRUST_PROXY_HEADERS", trust);
      await member();
      const passwordChecks = await countPasswordChecks();
      logged = [];

      const failures: LoginAnswer[] = [];
      for (let n = 1; n <= 20; n += 1)
        failures.push((await login(EMAIL, wrong(n), address(n))).answer);
      const checkedFailures = passwordChecks();
      const attemptLines = logged
        .map((line) =>
          line.match(/attempts=(\d+)\/(\d+), remaining_before_lockout=(\d+)/),
        )
        .filter((match) => match !== null)
        .map(([, failed, limit, remaining]) => ({
          failed: Number(failed),
          limit: Number(limit),
          remaining: Number(remaining),
        }));
      const later = [
        await login(EMAIL, wrong(21), address(21)),
        await login(EMAIL.toUpperCase(), wrong(22), address(22)),
        await login(EMAIL, PASSWORD, address(23)),
      ];

      expect({
        failures: failures.map((answer) => answer.errorKey),
        checkedFailures,
        lockoutLines: lockoutLines().map(
          (line) => line.match(/after \d+\/\d+ failed attempts/)?.[0],
        ),
        lastAttemptLine: attemptLines.at(-1),
        everyAttemptLineUsesItsBucketLimit: attemptLines.every(
          (line) => line.failed + line.remaining === line.limit,
        ),
        later: later.map((attempt) => [
          attempt.status,
          attempt.answer.errorKey,
        ]),
        laterSessionCookies: later.filter((attempt) =>
          hasSessionCookie(attempt.cookies),
        ).length,
        checkedInTotal: passwordChecks(),
      }).toEqual({
        failures: [
          ...Array.from({ length: 19 }, () => "error_invalid_credentials"),
          "error_too_many_attempts",
        ],
        checkedFailures: 20,
        lockoutLines: ["after 20/20 failed attempts"],
        lastAttemptLine: { failed: 19, limit: 20, remaining: 1 },
        everyAttemptLineUsesItsBucketLimit: true,
        later: [
          [429, "error_too_many_attempts"],
          [429, "error_too_many_attempts"],
          [429, "error_too_many_attempts"],
        ],
        laterSessionCookies: 0,
        checkedInTotal: 20,
      });
    },
    60_000,
  );

  it("refuses the right password from a fresh address while the account is locked and accepts it once the lockout has expired", {
    timeout: 60_000,
  }, async () => {
    await member();
    for (let n = 1; n <= 20; n += 1) await login(EMAIL, wrong(n), address(n));
    const passwordChecks = await countPasswordChecks();

    const whileLocked = await login(EMAIL, PASSWORD, address(30));
    const checkedWhileLocked = passwordChecks();
    vi.setSystemTime(START.getTime() + LOCKOUT_MS + 1_000);
    const afterLockout = await login(EMAIL, PASSWORD, address(31));

    expect({
      whileLocked: [whileLocked.status, whileLocked.answer],
      whileLockedSessionCookie: hasSessionCookie(whileLocked.cookies),
      checkedWhileLocked,
      afterLockout: [afterLockout.status, afterLockout.answer],
      afterLockoutSessionCookie: hasSessionCookie(afterLockout.cookies),
    }).toEqual({
      whileLocked: [429, { errorKey: "error_too_many_attempts" }],
      whileLockedSessionCookie: false,
      checkedWhileLocked: 0,
      afterLockout: [200, { redirectTo: "/en/" }],
      afterLockoutSessionCookie: true,
    });
  });

  it("a successful login clears the account's failures from every address but keeps the failures of its own address", {
    timeout: 60_000,
  }, async () => {
    await member();
    await member(OTHER_EMAIL, OTHER_USERNAME);
    for (let n = 1; n <= 18; n += 1) await login(EMAIL, wrong(n), address(n));
    await login(EMAIL, wrong(19), HOME);

    const success = await login(EMAIL, PASSWORD, HOME);
    const again: LoginAnswer[] = [];
    for (let n = 1; n <= 19; n += 1)
      again.push((await login(EMAIL, wrong(100 + n), address(100 + n))).answer);
    const home: LoginAnswer[] = [];
    for (let n = 1; n <= 4; n += 1)
      home.push((await login(OTHER_EMAIL, wrong(200 + n), HOME)).answer);

    expect({
      success: [success.status, success.answer],
      again: count(again.map((answer) => answer.errorKey)),
      home: home.map((answer) => answer.errorKey),
    }).toEqual({
      success: [200, { redirectTo: "/en/" }],
      again: { error_invalid_credentials: 19 },
      home: [
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_too_many_attempts",
      ],
    });
  });

  it("the successful login of an account whose email address shares the first 128 characters of another's keeps the other account's failures, which lock it at 20", {
    timeout: 60_000,
  }, async () => {
    const sharedStart = `member@${"a".repeat(60)}.${"b".repeat(60)}`;
    const target = `${sharedStart}.target.test`;
    const own = `${sharedStart}.own.test`;
    await member(target, "long_target");
    await member(own, "long_own");

    const failures: LoginAnswer[] = [];
    for (let n = 1; n <= 19; n += 1)
      failures.push((await login(target, wrong(n), address(n))).answer);
    const ownSuccess = await login(own, PASSWORD, address(40));
    logged = [];
    const twentieth = await login(target, wrong(20), address(20));
    const passwordChecks = await countPasswordChecks();
    const targetRight = await login(target, PASSWORD, address(30));
    const checkedWhileLocked = passwordChecks();
    const ownAgain = await login(own, PASSWORD, address(41));

    expect({
      sharedStartLength: sharedStart.length,
      failures: count(failures.map((answer) => answer.errorKey)),
      ownSuccess: [ownSuccess.status, ownSuccess.answer],
      twentieth: [twentieth.status, twentieth.answer.errorKey],
      lockoutLines: lockoutLines().map(
        (line) => line.match(/after \d+\/\d+ failed attempts/)?.[0],
      ),
      targetRight: [targetRight.status, targetRight.answer],
      targetRightSessionCookie: hasSessionCookie(targetRight.cookies),
      checkedWhileLocked,
      ownAgain: [ownAgain.status, ownAgain.answer],
    }).toEqual({
      sharedStartLength: 128,
      failures: { error_invalid_credentials: 19 },
      ownSuccess: [200, { redirectTo: "/en/" }],
      twentieth: [401, "error_too_many_attempts"],
      lockoutLines: ["after 20/20 failed attempts"],
      targetRight: [429, { errorKey: "error_too_many_attempts" }],
      targetRightSessionCookie: false,
      checkedWhileLocked: 0,
      ownAgain: [200, { redirectTo: "/en/" }],
    });
  });

  it("keeps the per-address limit of five failures across accounts", {
    timeout: 60_000,
  }, async () => {
    const passwordChecks = await countPasswordChecks();

    const answers: LoginAnswer[] = [];
    for (let n = 1; n <= 6; n += 1)
      answers.push(
        (await login(`nobody${n}@lockout.example.test`, wrong(n), HOME)).answer,
      );

    expect({
      answers: answers.map((answer) => answer.errorKey),
      checked: passwordChecks(),
    }).toEqual({
      answers: [
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_too_many_attempts",
        "error_too_many_attempts",
      ],
      checked: 5,
    });
  });

  it("without a trusted client address keeps the identifier limit of five failures", {
    timeout: 60_000,
  }, async () => {
    vi.stubEnv("AUTH_TRUST_PROXY_HEADERS", "false");
    await member();
    const passwordChecks = await countPasswordChecks();

    const answers: LoginAnswer[] = [];
    for (let n = 1; n <= 6; n += 1)
      answers.push((await login(EMAIL, wrong(n), address(n))).answer);

    expect({
      answers: answers.map((answer) => answer.errorKey),
      checked: passwordChecks(),
      lockoutLines: lockoutLines().map(
        (line) => line.match(/after \d+\/\d+ failed attempts/)?.[0],
      ),
    }).toEqual({
      answers: [
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_too_many_attempts",
        "error_too_many_attempts",
      ],
      checked: 5,
      lockoutLines: ["after 5/5 failed attempts"],
    });
  });
});

describe("password login without a client address", () => {
  it.each([
    ["unset (2.x compatibility default)", undefined],
    ["true", "true"],
  ] as const)(
    "with AUTH_TRUST_PROXY_HEADERS %s, once 20 wrong passwords from 20 client addresses have locked the account, requests without a client address are refused unchecked, the right password included, until the lockout has expired",
    async (_trust, trust) => {
      vi.stubEnv("AUTH_TRUST_PROXY_HEADERS", trust);
      await member();
      for (let n = 1; n <= 20; n += 1) await login(EMAIL, wrong(n), address(n));
      const passwordChecks = await countPasswordChecks();

      const withoutAddress = [
        await login(EMAIL, wrong(21), NO_ADDRESS),
        await login(EMAIL, PASSWORD, NO_ADDRESS),
        await login(EMAIL.toUpperCase(), PASSWORD, NO_ADDRESS),
      ];
      const checkedWhileLocked = passwordChecks();
      vi.setSystemTime(START.getTime() + LOCKOUT_MS + 1_000);
      const afterLockout = await login(EMAIL, PASSWORD, NO_ADDRESS);

      expect({
        withoutAddress: withoutAddress.map((attempt) => [
          attempt.status,
          attempt.answer,
        ]),
        sessionCookies: withoutAddress.filter((attempt) =>
          hasSessionCookie(attempt.cookies),
        ).length,
        checkedWhileLocked,
        afterLockout: [afterLockout.status, afterLockout.answer],
        afterLockoutSessionCookie: hasSessionCookie(afterLockout.cookies),
        leftInFlight: leftInFlight(),
      }).toEqual({
        withoutAddress: [
          [429, { errorKey: "error_too_many_attempts" }],
          [429, { errorKey: "error_too_many_attempts" }],
          [429, { errorKey: "error_too_many_attempts" }],
        ],
        sessionCookies: 0,
        checkedWhileLocked: 0,
        afterLockout: [200, { redirectTo: "/en/" }],
        afterLockoutSessionCookie: true,
        leftInFlight: 0,
      });
    },
    60_000,
  );

  it("a wrong password without a client address counts toward the account-wide limit and can activate its lockout", {
    timeout: 60_000,
  }, async () => {
    await member();
    for (let n = 1; n <= 19; n += 1) await login(EMAIL, wrong(n), address(n));
    logged = [];

    const withoutAddress = await login(EMAIL, wrong(20), NO_ADDRESS);
    const passwordChecks = await countPasswordChecks();
    const fromFreshAddress = await login(EMAIL, PASSWORD, address(30));

    expect({
      withoutAddress: [withoutAddress.status, withoutAddress.answer.errorKey],
      lockoutLines: lockoutLines().map(
        (line) => line.match(/after \d+\/\d+ failed attempts/)?.[0],
      ),
      fromFreshAddress: [
        fromFreshAddress.status,
        fromFreshAddress.answer.errorKey,
      ],
      checkedWhileLocked: passwordChecks(),
    }).toEqual({
      withoutAddress: [401, "error_too_many_attempts"],
      lockoutLines: ["after 20/20 failed attempts"],
      fromFreshAddress: [429, "error_too_many_attempts"],
      checkedWhileLocked: 0,
    });
  });

  it("the right password without a client address clears the account's failures from every address", {
    timeout: 60_000,
  }, async () => {
    await member();
    for (let n = 1; n <= 19; n += 1) await login(EMAIL, wrong(n), address(n));

    const success = await login(EMAIL, PASSWORD, NO_ADDRESS);
    const again: LoginAnswer[] = [];
    for (let n = 1; n <= 19; n += 1)
      again.push((await login(EMAIL, wrong(100 + n), address(100 + n))).answer);

    expect({
      success: [success.status, success.answer],
      again: count(again.map((answer) => answer.errorKey)),
    }).toEqual({
      success: [200, { redirectTo: "/en/" }],
      again: { error_invalid_credentials: 19 },
    });
  });

  it("keeps the identifier limit of five failures for requests without a client address", {
    timeout: 60_000,
  }, async () => {
    await member();
    const passwordChecks = await countPasswordChecks();
    logged = [];

    const answers: LoginAnswer[] = [];
    for (let n = 1; n <= 6; n += 1)
      answers.push((await login(EMAIL, wrong(n), NO_ADDRESS)).answer);
    const checked = passwordChecks();
    const fromAddress = await login(EMAIL, PASSWORD, address(30));

    expect({
      answers: answers.map((answer) => answer.errorKey),
      checked,
      lockoutLines: lockoutLines().map(
        (line) => line.match(/after \d+\/\d+ failed attempts/)?.[0],
      ),
      fromAddress: [fromAddress.status, fromAddress.answer],
    }).toEqual({
      answers: [
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_too_many_attempts",
        "error_too_many_attempts",
      ],
      checked: 5,
      lockoutLines: ["after 5/5 failed attempts"],
      fromAddress: [200, { redirectTo: "/en/" }],
    });
  });

  it("with AUTH_TRUST_PROXY_HEADERS false the identifier limit of five locks first in every window, so 20 wrong passwords over four lockouts never lock the account-wide bucket", {
    timeout: 60_000,
  }, async () => {
    vi.stubEnv("AUTH_TRUST_PROXY_HEADERS", "false");
    await member();
    const passwordChecks = await countPasswordChecks();
    logged = [];

    const rounds: (string | undefined)[][] = [];
    for (let round = 0; round < 4; round += 1) {
      vi.setSystemTime(START.getTime() + round * (LOCKOUT_MS + 1_000));
      const answers: (string | undefined)[] = [];
      for (let n = 1; n <= 6; n += 1) {
        const attempt = 10 * round + n;
        answers.push(
          (await login(EMAIL, wrong(attempt), address(attempt))).answer
            .errorKey,
        );
      }
      rounds.push(answers);
    }
    const checked = passwordChecks();
    vi.setSystemTime(START.getTime() + 4 * (LOCKOUT_MS + 1_000));
    const right = await login(EMAIL, PASSWORD, address(99));

    expect({
      rounds,
      checked,
      lockoutLines: lockoutLines().map(
        (line) => line.match(/after \d+\/\d+ failed attempts/)?.[0],
      ),
      attemptLineLimits: [
        ...new Set(
          logged
            .map((line) => line.match(/attempts=\d+\/(\d+),/)?.[1])
            .filter((limit) => limit !== undefined),
        ),
      ],
      right: [right.status, right.answer],
    }).toEqual({
      rounds: Array.from({ length: 4 }, () => [
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_invalid_credentials",
        "error_too_many_attempts",
        "error_too_many_attempts",
      ]),
      checked: 20,
      lockoutLines: Array.from(
        { length: 4 },
        () => "after 5/5 failed attempts",
      ),
      attemptLineLimits: ["5"],
      right: [200, { redirectTo: "/en/" }],
    });
  });
});

describe("password login with a full lockout store", () => {
  it.each([
    ["without a client address", NO_ADDRESS],
    ["from a fixed client address", HOME],
  ] as const)(
    "a store full of unlocked buckets with two failures each still locks wrong passwords %s at the fifth failure and refuses the right one unchecked",
    async (_from, ip) => {
      await member();
      const { MAX_LOGIN_RATE_LIMIT_ENTRIES, registerFailedLoginAttempt } =
        await import("@/lib/auth/login-rate-limit");
      const { getLoginRequestContext } = await import(
        "@/lib/auth/request-context"
      );
      for (let n = 0; n < MAX_LOGIN_RATE_LIMIT_ENTRIES / 2; n += 1) {
        const { rateLimitKey } = getLoginRequestContext(
          new Headers(),
          `filler${n}@lockout.example.test`,
        );
        registerFailedLoginAttempt(rateLimitKey, Date.now());
        registerFailedLoginAttempt(rateLimitKey, Date.now());
      }
      const filled = loginStores._authLoginAttempts?.size;
      const passwordChecks = await countPasswordChecks();
      logged = [];

      const answers: (string | undefined)[] = [];
      for (let n = 1; n <= 8; n += 1)
        answers.push((await login(EMAIL, wrong(n), ip)).answer.errorKey);
      const checked = passwordChecks();
      const right = await login(EMAIL, PASSWORD, ip);

      expect({
        filled,
        answers,
        checked,
        lockoutLines: lockoutLines().map(
          (line) => line.match(/after \d+\/\d+ failed attempts/)?.[0],
        ),
        right: [right.status, right.answer],
        rightSessionCookie: hasSessionCookie(right.cookies),
        checkedInTotal: passwordChecks(),
        leftInFlight: leftInFlight(),
      }).toEqual({
        filled: MAX_LOGIN_RATE_LIMIT_ENTRIES,
        answers: [
          ...Array.from({ length: 4 }, () => "error_invalid_credentials"),
          ...Array.from({ length: 4 }, () => "error_too_many_attempts"),
        ],
        checked: 5,
        lockoutLines: ["after 5/5 failed attempts"],
        right: [429, { errorKey: "error_too_many_attempts" }],
        rightSessionCookie: false,
        checkedInTotal: 5,
        leftInFlight: 0,
      });
    },
    60_000,
  );
});

describe("empty password login input", () => {
  it("is refused without a check and without booking a failure, so empty passwords and empty identifiers lock neither an account nor an address", {
    timeout: 60_000,
  }, async () => {
    await member(EMAIL, "unknown");
    const passwordChecks = await countPasswordChecks();
    logged = [];
    const answers = async (
      attempts: ReadonlyArray<
        readonly [identifier: string, password: string, ip: string]
      >,
    ) => {
      const all: string[] = [];
      for (const [identifier, password, ip] of attempts) {
        const { status, answer } = await login(identifier, password, ip);
        all.push(`${status} ${answer.errorKey}`);
      }
      return count(all);
    };
    const times = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

    const emptyPasswords = await answers(
      times(25).map((n) => [EMAIL, "", address(n)] as const),
    );
    const emptyIdentifiers = await answers(
      times(25).map((n) => ["", wrong(n), address(100 + n)] as const),
    );
    const fromOneAddress = await answers(
      times(25).map(() => [EMAIL, "", HOME] as const),
    );
    const checked = passwordChecks();
    const stored = loginStores._authLoginAttempts?.size ?? 0;
    const invalidInputLines = logged.filter((line) =>
      line.includes("(invalid input)"),
    ).length;
    const lockouts = lockoutLines().length;
    const byEmail = await login(EMAIL, PASSWORD, HOME);
    const byUsername = await login("unknown", PASSWORD, HOME);

    expect({
      emptyPasswords,
      emptyIdentifiers,
      fromOneAddress,
      checked,
      stored,
      invalidInputLines,
      lockouts,
      byEmail: [byEmail.status, byEmail.answer],
      byUsername: [byUsername.status, byUsername.answer],
      leftInFlight: leftInFlight(),
    }).toEqual({
      emptyPasswords: { "400 error_invalid_credentials": 25 },
      emptyIdentifiers: { "400 error_invalid_credentials": 25 },
      fromOneAddress: { "400 error_invalid_credentials": 25 },
      checked: 0,
      stored: 0,
      invalidInputLines: 75,
      lockouts: 0,
      byEmail: [200, { redirectTo: "/en/" }],
      byUsername: [200, { redirectTo: "/en/" }],
      leftInFlight: 0,
    });
  });
});

describe("password login success", () => {
  it("signs in through the application's login, and the catch-all route serves the session", {
    timeout: 60_000,
  }, async () => {
    await member();

    const signedIn = await login(USERNAME, PASSWORD, HOME);
    const session = await authRoute("GET", "get-session", {
      cookie: cookieHeader(signedIn.cookies),
    });
    const sessionAnswer = (await session.json()) as {
      user?: { email?: string };
    } | null;

    expect({
      signedIn: [signedIn.status, signedIn.answer],
      sessionCookie: hasSessionCookie(signedIn.cookies),
      session: [session.status, sessionAnswer?.user?.email],
    }).toEqual({
      signedIn: [200, { redirectTo: "/en/" }],
      sessionCookie: true,
      session: [200, EMAIL],
    });
  });

  it("answers the right password of a two-factor account with a pending sign-in", {
    timeout: 60_000,
  }, async () => {
    await member();
    const { auth } = await import("@/lib/auth");
    const signedIn = await auth.api.signInEmail({
      body: { email: EMAIL, password: PASSWORD },
      asResponse: true,
    });
    const headers = new Headers({
      cookie: cookieHeader(signedIn.headers.getSetCookie()),
    });
    const enabled = await auth.api.enableTwoFactor({
      headers,
      body: { password: PASSWORD },
    });
    if (enabled.method !== "totp") throw new Error("TOTP was not enabled");
    const secret = new URL(enabled.totpURI).searchParams.get("secret") ?? "";
    await auth.api.verifyTOTP({ headers, body: { code: totp(secret) } });

    const pending = await login(EMAIL, PASSWORD, HOME);

    expect({
      pending: [pending.status, pending.answer],
      sessionCookie: hasSessionCookie(pending.cookies),
      twoFactorCookie: pending.cookies.some((cookie) =>
        /two_factor=[^;]/.test(cookie),
      ),
    }).toEqual({
      pending: [200, { requiresTwoFactor: true }],
      sessionCookie: false,
      twoFactorCookie: true,
    });
  });
});

describe("Better Auth's HTTP password sign-in", () => {
  it.each([
    ["sign-in/email", { email: EMAIL, password: PASSWORD }],
    ["sign-in/username", { username: USERNAME, password: PASSWORD }],
  ] as const)(
    "POST /api/auth/%s with the right password is not offered: 404, no session, one warning without the identifier",
    async (action, body) => {
      await member();
      const sessionsBefore = sessions();
      warned = [];

      const response = await authRoute("POST", action, { body });
      const answer = await response.text();
      const postWarnings = [...warned];
      const sessionsAfterPost = sessions() - sessionsBefore;
      const get = await authRoute("GET", action);

      expect({
        status: response.status,
        sessionCookie: hasSessionCookie(response.headers.getSetCookie()),
        newSessions: sessionsAfterPost,
        answerNamesNoUser:
          !answer.includes(EMAIL) && !answer.includes(USERNAME),
        warnings: postWarnings.length,
        warningNamesTheRoute: postWarnings[0]?.includes(`/api/auth/${action}`),
        warningNamesNoIdentifier: postWarnings.every(
          (line) =>
            !line.includes(EMAIL) &&
            !line.includes(USERNAME) &&
            !line.includes(PASSWORD),
        ),
        getStatus: get.status,
      }).toEqual({
        status: 404,
        sessionCookie: false,
        newSessions: 0,
        answerNamesNoUser: true,
        warnings: 1,
        warningNamesTheRoute: true,
        warningNamesNoIdentifier: true,
        getStatus: 404,
      });
    },
    60_000,
  );
});

describe("concurrent password logins", () => {
  it("of 12 concurrent wrong passwords for one account from one address five are checked and the rest refused unchecked, with one lockout line", {
    timeout: 60_000,
  }, async () => {
    await member();
    const passwordChecks = await countPasswordChecks();
    logged = [];

    const answers = await Promise.all(
      Array.from({ length: BURST }, (_, n) => login(EMAIL, wrong(n), HOME)),
    );
    const checked = passwordChecks();
    const right = await login(EMAIL, PASSWORD, HOME);

    expect({
      checked,
      statuses: count(answers.map((answer) => answer.status)),
      errorKeys: count(answers.map((answer) => answer.answer.errorKey)),
      lockoutLines: lockoutLines().length,
      right: [right.status, right.answer.errorKey],
      leftInFlight: leftInFlight(),
    }).toEqual({
      checked: 5,
      statuses: { 401: 5, 429: BURST - 5 },
      errorKeys: {
        error_invalid_credentials: 4,
        error_too_many_attempts: BURST - 4,
      },
      lockoutLines: 1,
      right: [429, "error_too_many_attempts"],
      leftInFlight: 0,
    });
  });
});
