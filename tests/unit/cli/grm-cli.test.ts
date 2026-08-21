import { isPasswordPolicyValid } from "@/lib/password-policy";

type UserRow = {
  id: string;
  email: string;
  username: string;
};

const state = vi.hoisted(() => ({
  users: [] as UserRow[],
  resetCounter: 0,
  signUpStatus: 200,
  signUpErrorCode: null as string | null,
  signUpReturnsUser: true,
  deletedUserIds: [] as string[],
  signUpBodies: [] as Array<{
    email: string;
    name: string;
    password: string;
    username: string;
  }>,
  authConfigs: [] as Array<{
    emailAndPassword: {
      autoSignIn?: boolean;
      maxPasswordLength?: number;
      resetPasswordTokenExpiresIn?: number;
    };
  }>,
  migrationsRun: vi.fn(async () => undefined),
  accountMutationLockStatus: "acquired" as "acquired" | "busy",
  onAccountMutationLockAcquired: null as (() => void) | null,
  accountMutationLockRelease: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/setup-lock", () => ({
  acquireAuthSetupBootstrapLock: vi.fn(async () => {
    if (state.accountMutationLockStatus === "busy") {
      return {
        status: "busy" as const,
        release: async () => undefined,
      };
    }
    state.onAccountMutationLockAcquired?.();
    return {
      status: "acquired" as const,
      release: state.accountMutationLockRelease,
    };
  }),
}));

const database = {
  prepare: vi.fn((sql: string) => ({
    all: (email: string, username: string) => {
      if (!sql.includes("SELECT id, email, username")) return [];
      return state.users
        .filter(
          (user) =>
            user.email.toLowerCase() === email.toLowerCase() ||
            user.username.toLowerCase() === username.toLowerCase(),
        )
        .slice(0, 2);
    },
    get: (email?: string, username?: string) => {
      if (sql.includes("SELECT count(*) AS count")) {
        return { count: state.users.length };
      }
      return state.users.find(
        (user) =>
          user.email.toLowerCase() === email?.toLowerCase() ||
          user.username.toLowerCase() === username?.toLowerCase(),
      );
    },
  })),
};

vi.mock("@/lib/auth/db", () => ({
  getAuthDb: () => database,
}));

vi.mock("@/lib/auth/config", () => ({
  getAuthSecret: () => "s".repeat(64),
}));

vi.mock("@/i18n/config", () => ({
  normalizeLocale: () => "en",
}));

vi.mock("@/i18n/routing", () => ({
  getCanonicalRoutePath: () => "/reset-password",
}));

vi.mock("better-auth/db/migration", () => ({
  getMigrations: async () => ({ runMigrations: state.migrationsRun }),
}));

vi.mock("better-auth/plugins", () => ({
  username: () => ({ id: "username" }),
}));

vi.mock("@/lib/auth/account-identity-migration", () => ({
  migrateAuthAccountIdentities: vi.fn(),
}));

vi.mock("better-auth", () => ({
  betterAuth: (config: {
    emailAndPassword: {
      autoSignIn?: boolean;
      sendResetPassword: (payload: { url: string }) => Promise<void>;
    };
  }) => {
    state.authConfigs.push(config);
    return {
      $context: Promise.resolve({
        internalAdapter: {
          deleteUser: async (userId: string) => {
            state.deletedUserIds.push(userId);
            const index = state.users.findIndex((user) => user.id === userId);
            if (index >= 0) state.users.splice(index, 1);
          },
        },
      }),
      api: {
        requestPasswordReset: async () => {
          state.resetCounter += 1;
          await config.emailAndPassword.sendResetPassword({
            url: `http://localhost:3000/api/auth/reset-password/token-${state.resetCounter}?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fen%2Freset-password`,
          });
        },
        signUpEmail: async ({
          body,
        }: {
          body: {
            email: string;
            name: string;
            password: string;
            username: string;
          };
        }) => {
          if (state.signUpReturnsUser && state.signUpStatus < 400) {
            state.signUpBodies.push(body);
            state.users.push({
              id: `user-${state.users.length + 1}`,
              email: body.email,
              username: body.username,
            });
          }
          return Response.json(
            state.signUpReturnsUser && state.signUpStatus < 400
              ? { user: { id: state.users.at(-1)?.id } }
              : { user: null, code: state.signUpErrorCode },
            { status: state.signUpStatus },
          );
        },
      },
    };
  },
}));

import { runCli } from "@/cli/grm-cli";

function expectCliError(error: unknown, exitCode: number, message: RegExp) {
  expect(error).toMatchObject({ exitCode });
  expect((error as Error).message).toMatch(message);
}

describe("administration CLI", () => {
  const originalEnv = { ...process.env };
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let ttySetRawMode: ReturnType<typeof vi.fn> | null = null;

  async function runWithMockTty(
    lines: string[],
    operation: () => Promise<void>,
  ) {
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdinSetRawMode = Object.getOwnPropertyDescriptor(
      process.stdin,
      "setRawMode",
    );
    const stdoutIsTty = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY",
    );
    let lineIndex = 0;
    ttySetRawMode = vi.fn((enabled: boolean) => {
      if (enabled) {
        const line = lines[lineIndex] ?? "\u0004";
        lineIndex += 1;
        queueMicrotask(() => process.stdin.emit("data", `${line}\r`));
      }
      return process.stdin;
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "setRawMode", {
      configurable: true,
      value: ttySetRawMode,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      await operation();
    } finally {
      if (stdinIsTty) {
        Object.defineProperty(process.stdin, "isTTY", stdinIsTty);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }
      if (stdinSetRawMode) {
        Object.defineProperty(process.stdin, "setRawMode", stdinSetRawMode);
      } else {
        Reflect.deleteProperty(process.stdin, "setRawMode");
      }
      if (stdoutIsTty) {
        Object.defineProperty(process.stdout, "isTTY", stdoutIsTty);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.users.length = 0;
    state.signUpBodies.length = 0;
    state.deletedUserIds.length = 0;
    state.authConfigs.length = 0;
    state.resetCounter = 0;
    state.signUpStatus = 200;
    state.signUpErrorCode = null;
    state.signUpReturnsUser = true;
    state.accountMutationLockStatus = "acquired";
    state.onAccountMutationLockAcquired = null;
    ttySetRawMode = null;
    process.env = {
      ...originalEnv,
      BETTER_AUTH_URL: "http://localhost:3000",
      AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS: "900",
    };
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    process.env = { ...originalEnv };
  });

  it("lists all administration commands in help output", async () => {
    await runCli(["--help"]);

    const output = stdoutWrite.mock.calls.flat().join("");
    expect(output).toContain("auth reset-password");
    expect(output).toContain("auth create-user");
    expect(output).toContain("auth delete-user");
  });

  it.each([
    ["Admin", "username"],
    ["admin@example.test", "email"],
    [
      "\u200e Admin\u00a0@\u200bExample.Test\ufeff \u200f",
      "email with copy-and-paste artifacts",
    ],
  ])("looks up existing accounts by %s (%s)", async (identifier) => {
    state.users.push({
      id: "user-1",
      email: "admin@example.test",
      username: "admin",
    });

    await runCli(["auth", "reset-password", "--user", identifier]);

    const output = stdoutWrite.mock.calls.flat().join("");
    expect(output).toContain("token-1");
    expect(output).not.toContain("s".repeat(64));
    expect(state.migrationsRun).toHaveBeenCalledOnce();
    expect(
      state.authConfigs.at(-1)?.emailAndPassword.resetPasswordTokenExpiresIn,
    ).toBe(900);
  });

  it("warns when an invalid reset token lifetime falls back to the default", async () => {
    process.env.AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS = "invalid";
    state.users.push({
      id: "user-1",
      email: "admin@example.test",
      username: "admin",
    });

    await runCli(["auth", "reset-password", "--user", "admin"]);

    expect(stderrWrite.mock.calls.flat().join("")).toContain(
      "using 900 seconds",
    );
    expect(
      state.authConfigs.at(-1)?.emailAndPassword.resetPasswordTokenExpiresIn,
    ).toBe(900);
  });

  it("rejects non-HTTP Better Auth URLs as input errors", async () => {
    process.env.BETTER_AUTH_URL = "file:///tmp/app";

    await expect(
      runCli(["auth", "reset-password", "--user", "admin"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 2, /HTTP or HTTPS/);
      return true;
    });
    expect(state.migrationsRun).not.toHaveBeenCalled();
  });

  it.each([
    [
      ["auth", "reset-password", "--user", "admin", "--name", "ignored"],
      "--name",
    ],
    [
      [
        "auth",
        "create-user",
        "--username",
        "new_user",
        "--email",
        "new@example.test",
        "--user",
        "ignored",
      ],
      "--user",
    ],
    [["auth", "delete-user", "--user", "admin", "--name", "ignored"], "--name"],
  ])(
    "rejects options unsupported by the selected command",
    async (args, option) => {
      await expect(runCli(args)).rejects.toSatisfy((error: unknown) => {
        expectCliError(error, 2, new RegExp(`${option} is not valid`));
        return true;
      });
      expect(state.migrationsRun).not.toHaveBeenCalled();
    },
  );

  it("reports unknown and ambiguous account identifiers", async () => {
    await expect(
      runCli(["auth", "reset-password", "--user", "missing"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 3, /No account found/);
      return true;
    });

    state.users.push(
      {
        id: "user-1",
        email: "shared@example.test",
        username: "first",
      },
      {
        id: "user-2",
        email: "second@example.test",
        username: "shared@example.test",
      },
    );
    await expect(
      runCli(["auth", "reset-password", "--user", "shared@example.test"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 4, /more than one account/);
      return true;
    });
  });

  it("deletes an account selected by username without prompting when --yes is set", async () => {
    state.users.push(
      {
        id: "user-1",
        email: "admin@example.test",
        username: "admin",
      },
      {
        id: "user-2",
        email: "old@example.test",
        username: "old_admin",
      },
    );

    await runCli(["auth", "delete-user", "--user", "OLD_ADMIN", "--yes"]);

    expect(state.deletedUserIds).toEqual(["user-2"]);
    expect(state.users.map((user) => user.id)).toEqual(["user-1"]);
    expect(stdoutWrite.mock.calls.flat().join("")).toContain(
      "Account 'old_admin' was permanently deleted.",
    );
  });

  it("deletes an account selected by email after exact interactive confirmation", async () => {
    state.users.push(
      {
        id: "user-1",
        email: "admin@example.test",
        username: "admin",
      },
      {
        id: "user-2",
        email: "old@example.test",
        username: "old_admin",
      },
    );

    await runWithMockTty(["old_admin"], () =>
      runCli(["auth", "delete-user", "--user", "old@example.test"]),
    );

    expect(state.deletedUserIds).toEqual(["user-2"]);
    expect(stdoutWrite.mock.calls.flat().join("")).toContain(
      "Type 'old_admin' to confirm: old_admin",
    );
  });

  it("refuses to delete the last remaining account", async () => {
    state.users.push({
      id: "user-1",
      email: "admin@example.test",
      username: "admin",
    });

    await expect(
      runCli(["auth", "delete-user", "--user", "admin", "--yes"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 4, /last remaining account/);
      return true;
    });
    expect(state.deletedUserIds).toHaveLength(0);
  });

  it("rechecks last-account protection after acquiring the mutation lock", async () => {
    state.users.push(
      {
        id: "user-1",
        email: "admin@example.test",
        username: "admin",
      },
      {
        id: "user-2",
        email: "old@example.test",
        username: "old_admin",
      },
    );
    state.onAccountMutationLockAcquired = () => {
      state.users.splice(0, 1);
    };

    await expect(
      runCli(["auth", "delete-user", "--user", "old_admin", "--yes"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 4, /last remaining account/);
      return true;
    });
    expect(state.deletedUserIds).toHaveLength(0);
    expect(state.accountMutationLockRelease).toHaveBeenCalledOnce();
  });

  it("fails closed when another account mutation holds the lock", async () => {
    state.users.push(
      {
        id: "user-1",
        email: "admin@example.test",
        username: "admin",
      },
      {
        id: "user-2",
        email: "old@example.test",
        username: "old_admin",
      },
    );
    state.accountMutationLockStatus = "busy";

    await expect(
      runCli(["auth", "delete-user", "--user", "old_admin", "--yes"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 4, /operation is in progress/);
      return true;
    });
    expect(state.deletedUserIds).toHaveLength(0);
  });

  it("requires a TTY for deletion unless --yes is set", async () => {
    state.users.push(
      {
        id: "user-1",
        email: "admin@example.test",
        username: "admin",
      },
      {
        id: "user-2",
        email: "old@example.test",
        username: "old_admin",
      },
    );

    await expect(
      runCli(["auth", "delete-user", "--user", "old_admin"]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 2, /requires an interactive TTY/);
      return true;
    });
    expect(state.deletedUserIds).toHaveLength(0);
  });

  it("cancels deletion when the interactive confirmation does not match", async () => {
    state.users.push(
      {
        id: "user-1",
        email: "admin@example.test",
        username: "admin",
      },
      {
        id: "user-2",
        email: "old@example.test",
        username: "old_admin",
      },
    );

    await expect(
      runWithMockTty(["wrong_user"], () =>
        runCli(["auth", "delete-user", "--user", "old_admin"]),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 2, /confirmation did not match/);
      return true;
    });
    expect(state.deletedUserIds).toHaveLength(0);
  });

  it("creates a user with an unknown strong password and prints a reset link", async () => {
    await runCli([
      "auth",
      "create-user",
      "--username",
      "New.User",
      "--email",
      "NEW@example.test",
      "--name",
      "New User",
    ]);

    expect(state.signUpBodies).toHaveLength(1);
    const body = state.signUpBodies[0];
    expect(body).toMatchObject({
      username: "new.user",
      email: "new@example.test",
      name: "New User",
    });
    expect(isPasswordPolicyValid(body.password)).toBe(true);
    const output = stdoutWrite.mock.calls.flat().join("");
    expect(output).toContain("full application access");
    expect(output).toContain("token-1");
    expect(output).not.toContain(body.password);
    expect(state.authConfigs.at(-1)?.emailAndPassword.autoSignIn).toBe(false);
    expect(state.authConfigs.at(-1)?.emailAndPassword.maxPasswordLength).toBe(
      128,
    );
  });

  it("removes copy-and-paste artifacts from new usernames and email addresses", async () => {
    await runCli([
      "auth",
      "create-user",
      "--username",
      "\u200eNew.User\ufeff",
      "--email",
      "\u200e New\u00a0@\u200bExample.Test\ufeff \u200f",
    ]);

    expect(state.signUpBodies[0]).toMatchObject({
      username: "new.user",
      email: "new@example.test",
    });
  });

  it.each([
    [400, null, 2, /input was rejected/],
    [409, null, 4, /already in use/],
    [422, "username_already_exists", 4, /already in use/],
    [422, "invalid_email", 2, /invalid_email/],
    [500, null, 5, /status 500/],
  ])(
    "maps account creation status %i and code %s to exit code %i",
    async (status, errorCode, exitCode, message) => {
      state.signUpStatus = status;
      state.signUpErrorCode = errorCode;

      await expect(
        runCli([
          "auth",
          "create-user",
          "--username",
          "new_user",
          "--email",
          "new@example.test",
        ]),
      ).rejects.toSatisfy((error: unknown) => {
        expectCliError(error, exitCode, message);
        return true;
      });
      expect(state.signUpBodies).toHaveLength(0);
    },
  );

  it("treats a successful response without a created user as a conflict when the account appeared concurrently", async () => {
    state.signUpReturnsUser = false;
    const originalPrepare = database.prepare;
    let conflictChecks = 0;
    database.prepare = vi.fn((sql: string) => {
      const statement = originalPrepare(sql);
      if (!sql.includes("SELECT email, username")) return statement;
      return {
        ...statement,
        get: (email?: string, username?: string) => {
          conflictChecks += 1;
          return conflictChecks === 1
            ? undefined
            : {
                id: "concurrent-user",
                email: email || "",
                username: username || "",
              };
        },
      };
    });

    try {
      await expect(
        runCli([
          "auth",
          "create-user",
          "--username",
          "new_user",
          "--email",
          "new@example.test",
        ]),
      ).rejects.toSatisfy((error: unknown) => {
        expectCliError(error, 4, /already in use/);
        return true;
      });
    } finally {
      database.prepare = originalPrepare;
    }
  });

  it("rejects account conflicts and password values in arguments", async () => {
    state.users.push({
      id: "user-1",
      email: "existing@example.test",
      username: "existing",
    });

    await expect(
      runCli([
        "auth",
        "create-user",
        "--username",
        "existing",
        "--email",
        "other@example.test",
      ]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 4, /already in use/);
      return true;
    });

    await expect(
      runCli([
        "auth",
        "create-user",
        "--username",
        "new-user",
        "--email",
        "new@example.test",
        "--password",
        "SecretPassword123",
      ]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 2, /Unknown option: --password/);
      return true;
    });
    expect(state.signUpBodies).toHaveLength(0);
  });

  it("fails safely when password prompting has no TTY", async () => {
    await expect(
      runCli([
        "auth",
        "create-user",
        "--username",
        "prompt_user",
        "--email",
        "prompt@example.test",
        "--prompt-password",
      ]),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 2, /requires an interactive TTY/);
      return true;
    });
    expect(state.signUpBodies).toHaveLength(0);
  });

  it("reads and confirms a password without echo and restores TTY mode", async () => {
    await runWithMockTty(["PromptPassword1", "PromptPassword1"], () =>
      runCli([
        "auth",
        "create-user",
        "--username",
        "prompt_user",
        "--email",
        "prompt@example.test",
        "--prompt-password",
      ]),
    );

    expect(state.signUpBodies[0]?.password).toBe("PromptPassword1");
    expect(stdoutWrite.mock.calls.flat().join("")).not.toContain(
      "PromptPassword1",
    );
    expect(ttySetRawMode?.mock.calls).toEqual([
      [true],
      [false],
      [true],
      [false],
    ]);
  });

  it.each([
    [["PromptPassword1", "DifferentPassword1"], /do not match/],
    [["weak", "weak"], /12-128 characters/],
  ])("rejects invalid prompted passwords", async (lines, message) => {
    await expect(
      runWithMockTty(lines, () =>
        runCli([
          "auth",
          "create-user",
          "--username",
          "prompt_user",
          "--email",
          "prompt@example.test",
          "--prompt-password",
        ]),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 2, message);
      return true;
    });
    expect(state.signUpBodies).toHaveLength(0);
  });

  it("restores TTY mode when password input ends", async () => {
    await expect(
      runWithMockTty(["\u0004"], () =>
        runCli([
          "auth",
          "create-user",
          "--username",
          "prompt_user",
          "--email",
          "prompt@example.test",
          "--prompt-password",
        ]),
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCliError(error, 2, /input ended/);
      return true;
    });
    expect(ttySetRawMode?.mock.calls).toEqual([[true], [false]]);
  });
});
