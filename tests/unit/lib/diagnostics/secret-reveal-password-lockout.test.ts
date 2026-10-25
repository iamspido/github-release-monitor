import { formatWithOptions } from "node:util";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real secret-reveal confirmation, checked by a real Better Auth instance,
// is limited like the password login: one lockout bucket per user (CWE-307).

const holder = vi.hoisted(() => ({
  db: undefined as unknown,
  cookie: "",
  ip: "198.51.100.7",
}));
vi.mock("@/lib/auth/db", () => ({
  authDbPath: ":memory:",
  getAuthDb: () => holder.db,
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      cookie: holder.cookie,
      origin: "http://localhost:3000",
      "x-forwarded-for": holder.ip,
    }),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

const ORIGIN = "http://localhost:3000";
const PASSWORD = "MemberPassword1-long";
const EMAIL = "member@reveal.example.test";
const HOME = "198.51.100.7";
const OTHER = "203.0.113.9";
const MAIL_PASSWORD = "mail-secret";
const START = new Date("2026-10-24T08:00:00.000Z");
const LOCKOUT_MS = 15 * 60 * 1_000;

let logged: string[] = [];

const loginStores = globalThis as typeof globalThis & {
  _authLoginAttempts?: Map<string, unknown>;
  _authLoginOverflowAttempts?: Map<string, unknown>;
  _authLoginAttemptsInFlight?: Map<string, number>;
  _authLoginAttemptWaiters?: Set<() => void>;
};
const wrong = (n: number) => `Wrong${n}Password-long`;
const leftInFlight = () => loginStores._authLoginAttemptsInFlight?.size ?? 0;
const lockoutLines = () =>
  logged.filter((line) => line.includes("lockout activated"));
const outcome = (result: { success: boolean; errorKey?: string }) =>
  result.success ? "revealed" : result.errorKey;

async function signedInMember() {
  const { auth, setupAuth } = await import("@/lib/auth");
  await setupAuth.api.signUpEmail({
    body: {
      name: "Member",
      email: EMAIL,
      password: PASSWORD,
      username: "reveal_member",
    } as never,
  });
  const signedIn = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  holder.cookie = signedIn.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function countPasswordChecks() {
  const { auth } = await import("@/lib/auth");
  const signIn = vi.spyOn(auth.api, "signInEmail");
  return () => signIn.mock.calls.length;
}

async function reveal(currentPassword: string) {
  const { revealMailPasswordActionImpl } = await import(
    "@/lib/diagnostics/notification-config"
  );
  return revealMailPasswordActionImpl({ currentPassword });
}

async function login(identifier: string, password: string, ip: string) {
  const route = await import("@/app/api/login/password/route");
  const response = await route.POST(
    new Request(`${ORIGIN}/api/login/password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ identifier, password, locale: "en" }),
    }),
  );
  const answer = (await response.json()) as { errorKey?: string };
  return [response.status, answer.errorKey ?? "signed in"] as const;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
  vi.stubEnv("AUTH_TRUST_PROXY_HEADERS", "true");
  vi.stubEnv("MAIL_PASSWORD", MAIL_PASSWORD);
  loginStores._authLoginAttempts = undefined;
  loginStores._authLoginOverflowAttempts = undefined;
  loginStores._authLoginAttemptsInFlight = undefined;
  loginStores._authLoginAttemptWaiters = undefined;
  holder.db = new Database(":memory:");
  holder.cookie = "";
  holder.ip = HOME;
  const { ensureAuthDatabaseReady } = await import("@/lib/auth");
  await ensureAuthDatabaseReady();
  logged = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(formatWithOptions({ depth: 8 }, ...args));
    });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  (holder.db as InstanceType<typeof Database>).close();
});

describe("secret reveal current-password confirmation lockout", () => {
  it("refuses the sixth wrong current password and the right one unchecked while locked, and accepts the right one once the lockout has expired", {
    timeout: 60_000,
  }, async () => {
    await signedInMember();
    const passwordChecks = await countPasswordChecks();
    logged = [];

    const answers: (string | undefined)[] = [];
    for (let n = 1; n <= 6; n += 1)
      answers.push(outcome(await reveal(wrong(n))));
    const checkedWrong = passwordChecks();
    const whileLocked = await reveal(PASSWORD);
    const checkedWhileLocked = passwordChecks() - checkedWrong;
    const lockouts = lockoutLines().length;
    vi.setSystemTime(START.getTime() + LOCKOUT_MS + 1_000);
    const afterLockout = await reveal(PASSWORD);

    expect({
      answers,
      checkedWrong,
      whileLocked,
      checkedWhileLocked,
      lockouts,
      afterLockout,
      leftInFlight: leftInFlight(),
    }).toEqual({
      answers: [
        "error_current_password_invalid",
        "error_current_password_invalid",
        "error_current_password_invalid",
        "error_current_password_invalid",
        "error_too_many_attempts",
        "error_too_many_attempts",
      ],
      checkedWrong: 5,
      whileLocked: { success: false, errorKey: "error_too_many_attempts" },
      checkedWhileLocked: 0,
      lockouts: 1,
      afterLockout: { success: true, value: MAIL_PASSWORD },
      leftInFlight: 0,
    });
  });

  it("counts apart from the login: the right current password clears only the confirmation's failures, and a locked confirmation leaves the login open", {
    timeout: 60_000,
  }, async () => {
    await signedInMember();
    for (let n = 1; n <= 4; n += 1) await login(EMAIL, wrong(n), HOME);

    const before: (string | undefined)[] = [];
    for (let n = 1; n <= 4; n += 1)
      before.push(outcome(await reveal(wrong(10 + n))));
    const right = outcome(await reveal(PASSWORD));
    const after: (string | undefined)[] = [];
    for (let n = 1; n <= 5; n += 1)
      after.push(outcome(await reveal(wrong(20 + n))));
    const fifthLoginFailure = await login(EMAIL, wrong(5), HOME);
    const loginElsewhere = await login(EMAIL, PASSWORD, OTHER);

    expect({
      before,
      right,
      after,
      fifthLoginFailure,
      loginElsewhere,
    }).toEqual({
      before: Array.from({ length: 4 }, () => "error_current_password_invalid"),
      right: "revealed",
      after: [
        "error_current_password_invalid",
        "error_current_password_invalid",
        "error_current_password_invalid",
        "error_current_password_invalid",
        "error_too_many_attempts",
      ],
      fifthLoginFailure: [401, "error_too_many_attempts"],
      loginElsewhere: [200, "signed in"],
    });
  });

  it("books nothing for a check that fails on the server's side and releases its reservation", {
    timeout: 60_000,
  }, async () => {
    await signedInMember();
    const { auth } = await import("@/lib/auth");
    const failing = vi
      .spyOn(auth.api, "signInEmail")
      .mockRejectedValue(new Error("database unavailable"));

    const failed = [
      outcome(await reveal(wrong(1))),
      outcome(await reveal(wrong(2))),
    ];
    failing.mockRestore();
    const inFlightAfterFailures = leftInFlight();
    const bookedStepUpKeys = [
      ...(loginStores._authLoginAttempts?.keys() ?? []),
    ].filter((key) => key.startsWith("step-up:")).length;
    const right = outcome(await reveal(PASSWORD));

    expect({
      failed,
      inFlightAfterFailures,
      bookedStepUpKeys,
      right,
    }).toEqual({
      failed: ["error_reveal_failed", "error_reveal_failed"],
      inFlightAfterFailures: 0,
      bookedStepUpKeys: 0,
      right: "revealed",
    });
  });
});
