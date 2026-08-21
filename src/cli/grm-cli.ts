import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { username } from "better-auth/plugins";
import { normalizeLocale } from "@/i18n/config";
import { getCanonicalRoutePath } from "@/i18n/routing";
import { migrateAuthAccountIdentities } from "@/lib/auth/account-identity-migration";
import { getAuthSecret } from "@/lib/auth/config";
import { getAuthDb } from "@/lib/auth/db";
import { getPasswordResetTokenTtlConfig } from "@/lib/auth/password-reset-config";
import { normalizePasswordResetIdentifier } from "@/lib/auth/password-reset-identifier";
import { acquireAuthSetupBootstrapLock } from "@/lib/auth/setup-lock";
import {
  isPasswordPolicyValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { isUsernamePolicyValid } from "@/lib/username-policy";

const EXIT_INPUT = 2;
const EXIT_NOT_FOUND = 3;
const EXIT_CONFLICT = 4;
const EXIT_DATABASE = 5;
const MAX_DISPLAY_NAME_LENGTH = 100;
const SIGN_UP_CONFLICT_CODES = new Set([
  "user_already_exists",
  "email_already_exists",
  "email_already_in_use",
  "email_in_use",
  "username_already_exists",
  "username_already_in_use",
  "username_in_use",
  "username_taken",
]);

type CliError = Error & { exitCode?: number };
type CliOptions = Record<string, string | boolean>;

function fail(message: string, exitCode: number): never {
  const error = new Error(message) as CliError;
  error.exitCode = exitCode;
  throw error;
}

function printHelp() {
  process.stdout.write(`GitHub Release Monitor administration CLI

Usage:
  grm-cli.mjs auth reset-password --user <username-or-email>
  grm-cli.mjs auth create-user --username <username> --email <email> [--name <name>] [--prompt-password]
  grm-cli.mjs auth delete-user --user <username-or-email> [--yes]

Commands:
  auth reset-password  Print a short-lived, single-use password reset link.
  auth create-user     Create an internal user with full application access.
  auth delete-user     Permanently delete an internal user and their auth data.

Options:
  --user <value>       Existing username or email address.
  --username <value>   Username for a new user.
  --email <value>      Email address for a new user.
  --name <value>       Optional display name.
  --prompt-password    Read and confirm the new password without terminal echo.
  --yes                Skip the interactive delete confirmation.
  --help               Show this help.
`);
}

function parseOptions(args: string[]) {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      fail(`Unexpected argument: ${argument}`, EXIT_INPUT);
    }
    const name = argument.slice(2);
    if (name === "prompt-password" || name === "yes" || name === "help") {
      options[name] = true;
      continue;
    }
    if (!["user", "username", "email", "name"].includes(name)) {
      fail(`Unknown option: --${name}`, EXIT_INPUT);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${name}`, EXIT_INPUT);
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function getRequiredOption(options: CliOptions, name: string) {
  const value = options[name];
  if (typeof value !== "string" || !value.trim()) {
    fail(`Missing required option: --${name}`, EXIT_INPUT);
  }
  return value.trim();
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isDisplayNameValid(value: string) {
  return (
    value.length <= MAX_DISPLAY_NAME_LENGTH &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

async function getAuthApiErrorCode(response: Response) {
  try {
    const payload = (await response.clone().json()) as {
      code?: unknown;
      error?: unknown;
    };
    const normalize = (value: unknown) =>
      typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalize(payload.code) || normalize(payload.error);
  } catch {
    return "";
  }
}

function rejectUnsupportedOptions(
  options: CliOptions,
  supportedOptions: ReadonlySet<string>,
) {
  const unsupported = Object.keys(options).find(
    (name) => !supportedOptions.has(name),
  );
  if (unsupported) {
    fail(`Option --${unsupported} is not valid for this command.`, EXIT_INPUT);
  }
}

async function getConfiguredLocale() {
  try {
    const settingsPath = path.join(process.cwd(), "data", "settings.json");
    const payload = JSON.parse(await fs.readFile(settingsPath, "utf8")) as {
      locale?: unknown;
    };
    return normalizeLocale(payload.locale);
  } catch {
    return normalizeLocale(undefined);
  }
}

function getBaseUrl() {
  const raw = process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_BASE_URL;
  if (!raw) {
    fail(
      "BETTER_AUTH_URL is required to generate password reset links.",
      EXIT_INPUT,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail(
      "BETTER_AUTH_URL must be a valid absolute HTTP or HTTPS URL.",
      EXIT_INPUT,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail(
      "BETTER_AUTH_URL must be a valid absolute HTTP or HTTPS URL.",
      EXIT_INPUT,
    );
  }
  return parsed.origin;
}

async function createCliAuth() {
  const secret = getAuthSecret();
  if (secret.length < 32) {
    fail("BETTER_AUTH_SECRET must contain at least 32 characters.", EXIT_INPUT);
  }
  const baseURL = getBaseUrl();
  const locale = await getConfiguredLocale();
  const resetPath = getCanonicalRoutePath("/reset-password", locale);
  const redirectTo = new URL(`/${locale}${resetPath}`, baseURL).toString();
  const resetLinks: string[] = [];
  const ttlConfig = getPasswordResetTokenTtlConfig();
  const ttl = ttlConfig.value;
  if (ttlConfig.usedFallback) {
    process.stderr.write(
      `Invalid AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS; using ${ttl} seconds. Expected an integer between 60 and 86400.\n`,
    );
  }
  const config = {
    database: getAuthDb(),
    secret,
    baseURL,
    plugins: [username()],
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: ttl,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async (payload: { url: string }) => {
        resetLinks.push(payload.url);
      },
    },
  };
  migrateAuthAccountIdentities();
  const migrations = await getMigrations(config);
  await migrations.runMigrations();
  return {
    auth: betterAuth(config),
    redirectTo,
    takeResetLink: () => resetLinks.shift() || null,
  };
}

type UserRow = { id: string; email: string; username?: string | null };

function findUser(identifier: string): UserRow | null {
  const normalized = normalizePasswordResetIdentifier(identifier);
  const rows = getAuthDb()
    .prepare(
      "SELECT id, email, username FROM user WHERE lower(email) = lower(?) OR lower(username) = lower(?) LIMIT 2",
    )
    .all(normalized, normalized) as UserRow[];
  if (rows.length > 1) {
    fail(
      "The identifier matches more than one account; use the email address.",
      EXIT_CONFLICT,
    );
  }
  return rows[0] || null;
}

function countUsers() {
  const row = getAuthDb().prepare("SELECT count(*) AS count FROM user").get() as
    | { count?: number | bigint }
    | undefined;
  const count = Number(row?.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    fail("Could not determine the number of existing accounts.", EXIT_DATABASE);
  }
  return count;
}

function findUserConflict(usernameValue: string, email: string) {
  return getAuthDb()
    .prepare(
      "SELECT email, username FROM user WHERE lower(email) = lower(?) OR lower(username) = lower(?) LIMIT 1",
    )
    .get(email, usernameValue) as
    | { email?: string | null; username?: string | null }
    | undefined;
}

async function requestResetLink(identifier: string) {
  const cliAuth = await createCliAuth();
  const user = findUser(identifier);
  if (!user) {
    fail(`No account found for '${identifier}'.`, EXIT_NOT_FOUND);
  }
  await cliAuth.auth.api.requestPasswordReset({
    body: { email: user.email, redirectTo: cliAuth.redirectTo },
  });
  const resetLink = cliAuth.takeResetLink();
  if (!resetLink) {
    fail("Better Auth did not generate a password reset link.", EXIT_DATABASE);
  }
  return resetLink;
}

function createRandomPassword() {
  for (;;) {
    const candidate = `A1a${randomBytes(24).toString("base64url")}`;
    if (isPasswordPolicyValid(candidate)) return candidate;
  }
}

async function readTerminalLine(label: string, echoInput: boolean) {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    !process.stdin.setRawMode
  ) {
    fail(
      "Interactive input requires an interactive TTY (use docker exec -it).",
      EXIT_INPUT,
    );
  }
  const input = process.stdin;
  const output = process.stdout;
  const previousRawMode = input.isRaw ?? false;
  output.write(label);
  input.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    let settled = false;
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("SIGHUP", onSignal);
      process.off("SIGQUIT", onSignal);
      process.off("SIGTSTP", onSignal);
      try {
        input.setRawMode?.(previousRawMode);
      } catch {
        // The stream may already be closed; all listeners still need cleanup.
      }
      input.pause();
      output.write("\n");
    };
    const finish = (result: { value: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ("error" in result) {
        reject(result.error);
      } else {
        resolve(result.value);
      }
    };
    const cancellationError = (message: string) =>
      Object.assign(new Error(message), { exitCode: EXIT_INPUT });
    const onEnd = () => {
      finish({ error: cancellationError("Interactive input ended.") });
    };
    const onError = () => {
      finish({ error: cancellationError("Interactive input failed.") });
    };
    const onSignal = () => {
      finish({ error: cancellationError("Interactive input cancelled.") });
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (
          character === "\u0003" ||
          character === "\u001a" ||
          character === "\u001c"
        ) {
          finish({ error: cancellationError("Interactive input cancelled.") });
          return;
        }
        if (character === "\u0004") {
          finish({ error: cancellationError("Interactive input ended.") });
          return;
        }
        if (character === "\r" || character === "\n") {
          finish({ value });
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (echoInput) output.write("\b \b");
          }
        } else if (character >= " ") {
          value += character;
          if (echoInput) output.write(character);
        }
      }
    };
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    process.once("SIGHUP", onSignal);
    process.once("SIGQUIT", onSignal);
    process.once("SIGTSTP", onSignal);
    try {
      input.setRawMode(true);
      input.resume();
    } catch {
      finish({
        error: cancellationError("Interactive input could not start."),
      });
    }
  });
}

async function promptForPassword() {
  const password = await readTerminalLine("New password: ", false);
  const confirmation = await readTerminalLine("Confirm password: ", false);
  if (password !== confirmation) {
    fail("The entered passwords do not match.", EXIT_INPUT);
  }
  if (!isPasswordPolicyValid(password)) {
    fail(
      `Password must contain ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters with uppercase, lowercase, a number, and no whitespace.`,
      EXIT_INPUT,
    );
  }
  return password;
}

async function confirmUserDeletion(user: UserRow) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "delete-user requires an interactive TTY unless --yes is provided (use docker exec -it).",
      EXIT_INPUT,
    );
  }
  const expected = user.username?.trim() || user.email.trim();
  process.stdout.write(
    `This permanently deletes account '${expected}' (${user.email}) and all of its authentication data.\n`,
  );
  const confirmation = await readTerminalLine(
    `Type '${expected}' to confirm: `,
    true,
  );
  if (confirmation.trim() !== expected) {
    fail("Account deletion cancelled: confirmation did not match.", EXIT_INPUT);
  }
}

async function deleteUser(options: CliOptions) {
  const identifier = getRequiredOption(options, "user");
  const cliAuth = await createCliAuth();
  const user = findUser(identifier);
  if (!user) {
    fail(`No account found for '${identifier}'.`, EXIT_NOT_FOUND);
  }
  if (countUsers() <= 1) {
    fail("The last remaining account cannot be deleted.", EXIT_CONFLICT);
  }
  if (options.yes !== true) {
    await confirmUserDeletion(user);
  }

  const context = await cliAuth.auth.$context;
  const accountMutationLock = await acquireAuthSetupBootstrapLock({
    source: "cli:delete-user",
  });
  if (accountMutationLock.status !== "acquired") {
    fail(
      "Another authentication account operation is in progress; try again.",
      EXIT_CONFLICT,
    );
  }
  try {
    const lockedUser = findUser(identifier);
    if (!lockedUser) {
      fail(`No account found for '${identifier}'.`, EXIT_NOT_FOUND);
    }
    if (lockedUser.id !== user.id) {
      fail(
        "The selected account changed while waiting for the operation lock; no account was deleted.",
        EXIT_CONFLICT,
      );
    }
    if (countUsers() <= 1) {
      fail("The last remaining account cannot be deleted.", EXIT_CONFLICT);
    }
    await context.internalAdapter.deleteUser(lockedUser.id);
  } finally {
    await accountMutationLock.release();
  }
  process.stdout.write(
    `Account '${user.username || user.email}' was permanently deleted.\n`,
  );
}

async function createUser(options: CliOptions) {
  const usernameValue = normalizePasswordResetIdentifier(
    getRequiredOption(options, "username"),
  );
  const email = normalizePasswordResetIdentifier(
    getRequiredOption(options, "email"),
  );
  const nameValue = typeof options.name === "string" ? options.name.trim() : "";
  if (!isUsernamePolicyValid(usernameValue)) {
    fail(
      "Username must use 3-30 letters, numbers, underscores, or dots.",
      EXIT_INPUT,
    );
  }
  if (!isLikelyEmail(email)) {
    fail("The email address is invalid.", EXIT_INPUT);
  }
  if (!isDisplayNameValid(nameValue)) {
    fail(
      `Display name must contain at most ${MAX_DISPLAY_NAME_LENGTH} characters and no control characters.`,
      EXIT_INPUT,
    );
  }
  const cliAuth = await createCliAuth();
  const conflict = findUserConflict(usernameValue, email);
  if (conflict) {
    fail("The username or email address is already in use.", EXIT_CONFLICT);
  }

  const prompted = options["prompt-password"] === true;
  const password = prompted
    ? await promptForPassword()
    : createRandomPassword();
  const signUpBody: {
    email: string;
    password: string;
    username: string;
    name: string;
  } = {
    email,
    password,
    username: usernameValue,
    name: nameValue || usernameValue,
  };
  const response = await cliAuth.auth.api.signUpEmail({
    body: signUpBody,
    asResponse: true,
  });
  if (!response.ok) {
    const errorCode = await getAuthApiErrorCode(response);
    if (response.status === 409 || SIGN_UP_CONFLICT_CODES.has(errorCode)) {
      fail("The username or email address is already in use.", EXIT_CONFLICT);
    }
    if (response.status >= 400 && response.status < 500) {
      fail(
        `Account creation input was rejected with status ${response.status}${errorCode ? ` (${errorCode})` : ""}.`,
        EXIT_INPUT,
      );
    }
    fail(
      `Account creation failed with status ${response.status}.`,
      EXIT_DATABASE,
    );
  }
  const signUpResult = (await response.json().catch(() => null)) as {
    user?: { id?: unknown } | null;
  } | null;
  if (typeof signUpResult?.user?.id !== "string") {
    if (findUserConflict(usernameValue, email)) {
      fail("The username or email address is already in use.", EXIT_CONFLICT);
    }
    fail("Account creation returned no created user.", EXIT_DATABASE);
  }

  process.stdout.write(
    `Account '${usernameValue}' created. This account has full application access.\n`,
  );
  if (prompted) return;

  await cliAuth.auth.api.requestPasswordReset({
    body: { email, redirectTo: cliAuth.redirectTo },
  });
  const resetLink = cliAuth.takeResetLink();
  if (!resetLink) {
    fail(
      "The account was created, but no password reset link was generated. Run reset-password for the new account.",
      EXIT_DATABASE,
    );
  }
  process.stdout.write(
    `Set the account password using this one-time link:\n${resetLink}\n`,
  );
}

export async function runCli(args: string[]) {
  if (args.length === 0 || args.includes("--help")) {
    printHelp();
    return;
  }
  if (
    args[0] !== "auth" ||
    !["reset-password", "create-user", "delete-user"].includes(args[1])
  ) {
    fail("Unknown command. Run with --help for usage.", EXIT_INPUT);
  }
  const options = parseOptions(args.slice(2));
  if (args[1] === "reset-password") {
    rejectUnsupportedOptions(options, new Set(["user"]));
    const identifier = getRequiredOption(options, "user");
    const resetLink = await requestResetLink(identifier);
    process.stdout.write(`Password reset link (single use):\n${resetLink}\n`);
    return;
  }
  if (args[1] === "delete-user") {
    rejectUnsupportedOptions(options, new Set(["user", "yes"]));
    await deleteUser(options);
    return;
  }
  rejectUnsupportedOptions(
    options,
    new Set(["username", "email", "name", "prompt-password"]),
  );
  await createUser(options);
}

const entryPath = process.argv[1];
const isDirectExecution = Boolean(
  entryPath &&
    import.meta.url === pathToFileURL(path.resolve(entryPath)).toString(),
);

if (isDirectExecution) {
  runCli(process.argv.slice(2)).catch((error: CliError) => {
    process.stderr.write(`${error.message || "CLI operation failed."}\n`);
    process.exitCode = error.exitCode || EXIT_DATABASE;
  });
}
