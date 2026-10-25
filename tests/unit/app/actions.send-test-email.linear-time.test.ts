import path from "node:path";
import { build, type Plugin } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { runBundled } from "../helpers/bounded-run";

// The real test e-mail action checks a custom recipient within two seconds in a
// worker thread, on values the former pattern needed seconds or minutes for.

const BUNDLE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 60_000;
const DOT_RUNS = [40_000, 400_000];
const manyDots = (count: number) => `a@${".".repeat(count)}@`;

const ROOT = path.resolve(import.meta.dirname, "../../..");

const MAIL_TRANSPORT_STUB = `
  export const sentMessages: unknown[] = [];
  export async function sendEmailMessage(_config: unknown, message: unknown) {
    sentMessages.push(message);
  }
`;

const REQUEST_LOCALE_STUB = `
  export async function getLocale() {
    return "en";
  }
  export async function getTranslations() {
    return (key: string) => key;
  }
`;

const TEST_EMAIL_SITE = `
  import { parentPort } from "node:worker_threads";
  import { sentMessages } from "@/lib/notifications/email-transport";
  import { sendTestEmailAction } from "@/lib/test-release-actions";
  Object.assign(process.env, {
    AUTHENTICATION_METHOD: "External",
    MAIL_HOST: "smtp.example.test",
    MAIL_PORT: "587",
    MAIL_FROM_ADDRESS: "from@example.test",
    MAIL_TO_ADDRESS: "to@example.test",
  });
  parentPort?.on("message", async (customEmail: string) => {
    try {
      const result = await sendTestEmailAction(customEmail);
      parentPort?.postMessage({
        value: { result, sent: sentMessages.length },
      });
    } catch (error) {
      parentPort?.postMessage({ error: String(error) });
    }
  });
  parentPort?.postMessage("ready");
`;

const STUBBED_MODULES = new Map([
  ["@/lib/notifications/email-transport", MAIL_TRANSPORT_STUB],
  ["next-intl/server", REQUEST_LOCALE_STUB],
]);

function stubbedModules(): Plugin {
  return {
    name: "stubbed-modules",
    setup(pluginBuild) {
      pluginBuild.onResolve(
        {
          filter:
            /^(@\/lib\/notifications\/email-transport|next-intl\/server)$/,
        },
        (args) => ({ path: args.path, namespace: "stubbed-module" }),
      );
      pluginBuild.onLoad(
        { filter: /.*/, namespace: "stubbed-module" },
        (args) => ({ contents: STUBBED_MODULES.get(args.path), loader: "ts" }),
      );
    },
  };
}

async function bundleTestEmail(): Promise<string> {
  const bundle = await build({
    stdin: {
      contents: TEST_EMAIL_SITE,
      loader: "ts",
      resolveDir: ROOT,
      sourcefile: "test-email-site.ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "node24",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    external: ["better-sqlite3", "next", "next/*"],
    plugins: [stubbedModules()],
    logLevel: "silent",
  });
  return bundle.outputFiles[0].text;
}

type TestEmailAnswer = {
  result: { success: boolean; error?: string };
  sent: number;
};

describe("the test e-mail checks its custom recipient in linear time", () => {
  let bundle = "";
  beforeAll(async () => {
    bundle = await bundleTestEmail();
  }, BUNDLE_TIMEOUT_MS);

  it.each(DOT_RUNS)(
    "a recipient of an @, %i dots and a final @ is refused as no e-mail address within the deadline, and nothing is sent",
    async (count) => {
      const result = await runBundled<TestEmailAnswer>(bundle, manyDots(count));

      expect(result).toEqual({
        finished: true,
        value: {
          result: { success: false, error: "invalid_email_format" },
          sent: 0,
        },
      });
    },
    TEST_TIMEOUT_MS,
  );
});
