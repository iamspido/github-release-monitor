import path from "node:path";
import { build, type Plugin } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { bundleBounded, runBundled } from "../helpers/bounded-run";

// The real e-mail check and password login answer within two seconds in a
// worker thread on values the former pattern needed seconds or minutes for.

const BUNDLE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 60_000;
const DOT_RUNS = [40_000, 400_000];
const manyDots = (count: number) => `a@${".".repeat(count)}@`;

const ROOT = path.resolve(import.meta.dirname, "../../..");

const ADDRESS_CHECK_SITE = `
  import { isLikelyEmail } from "@/lib/auth/request-context";
  async function run(value: string) {
    return isLikelyEmail(value);
  }
`;

const BETTER_AUTH_STUB = `
  export const passwordChecks = { email: 0, username: 0 };
  export const auth = {
    api: {
      async signInEmail() {
        passwordChecks.email += 1;
        return new Response(null, { status: 401 });
      },
      async signInUsername() {
        passwordChecks.username += 1;
        return new Response(null, { status: 401 });
      },
    },
  };
  export async function ensureAuthDatabaseReady() {}
`;

const LOGIN_SITE = `
  import { parentPort } from "node:worker_threads";
  import { passwordChecks } from "@/lib/auth";
  import { authenticatePassword } from "@/lib/auth/password-login";
  process.env.AUTH_TRUST_PROXY_HEADERS = "true";
  parentPort?.on("message", async (identifier: string) => {
    try {
      const result = await authenticatePassword({
        headers: new Headers({ "x-forwarded-for": "198.51.100.23" }),
        identifier,
        password: "Wrong-password-1",
      });
      parentPort?.postMessage({
        value: {
          ok: result.ok,
          errorKey: result.ok ? null : result.errorKey,
          status: result.ok ? null : result.status,
          passwordChecks,
        },
      });
    } catch (error) {
      parentPort?.postMessage({ error: String(error) });
    }
  });
  parentPort?.postMessage("ready");
`;

function stubbedBetterAuth(): Plugin {
  return {
    name: "better-auth-stub",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^@\/lib\/auth$/ }, (args) => ({
        path: args.path,
        namespace: "better-auth-stub",
      }));
      pluginBuild.onLoad(
        { filter: /.*/, namespace: "better-auth-stub" },
        () => ({
          contents: BETTER_AUTH_STUB,
          loader: "ts",
        }),
      );
    },
  };
}

async function bundleLogin(): Promise<string> {
  const bundle = await build({
    stdin: {
      contents: LOGIN_SITE,
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "login-site.ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "node24",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    external: ["better-sqlite3", "next", "next/*"],
    plugins: [stubbedBetterAuth()],
    logLevel: "silent",
  });
  return bundle.outputFiles[0].text;
}

type LoginAnswer = {
  ok: boolean;
  errorKey: string | null;
  status: number | null;
  passwordChecks: { email: number; username: number };
};

const refusedOnce = (by: "email" | "username") => ({
  ok: false,
  errorKey: "error_invalid_credentials",
  status: 401,
  passwordChecks: {
    email: by === "email" ? 1 : 0,
    username: by === "username" ? 1 : 0,
  },
});

describe("the e-mail address check answers in linear time", () => {
  let bundle = "";
  beforeAll(async () => {
    bundle = await bundleBounded(ADDRESS_CHECK_SITE);
  }, BUNDLE_TIMEOUT_MS);

  it.each(DOT_RUNS)(
    "a value of an @, %i dots and a final @ is no address, within the deadline",
    async (count) => {
      const result = await runBundled<boolean>(bundle, manyDots(count));

      expect(result).toEqual({ finished: true, value: false });
    },
    TEST_TIMEOUT_MS,
  );
});

describe("the password login classifies its identifier in linear time", () => {
  let bundle = "";
  beforeAll(async () => {
    bundle = await bundleLogin();
  }, BUNDLE_TIMEOUT_MS);

  it.each(DOT_RUNS)(
    "an identifier of an @, %i dots and a final @ is refused within the deadline after one password check, by username",
    async (count) => {
      const result = await runBundled<LoginAnswer>(bundle, manyDots(count));

      expect(result).toEqual({
        finished: true,
        value: refusedOnce("username"),
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an identifier in the shape of an address signs in by email address up to 254 characters and by username above",
    async () => {
      const longest = `${"a".repeat(64)}@${"b".repeat(184)}.test`;
      const tooLong = `${"a".repeat(64)}@${"b".repeat(185)}.test`;

      const answers = {
        [longest.length]: await runBundled<LoginAnswer>(bundle, longest),
        [tooLong.length]: await runBundled<LoginAnswer>(bundle, tooLong),
      };

      expect(answers).toEqual({
        254: { finished: true, value: refusedOnce("email") },
        255: { finished: true, value: refusedOnce("username") },
      });
    },
    TEST_TIMEOUT_MS,
  );
});
