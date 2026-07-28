import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type MessageFormatElement,
  parse,
  TYPE,
} from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { englishLocale, locales } from "../../../src/i18n/config";

type Dict = Record<string, unknown>;

function flattenKeys(obj: Dict, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenKeys(v as Dict, key));
    } else if (typeof v === "string") {
      out[key] = v;
    }
  }
  return out;
}

function extractPlaceholderSignatures(s: string): Set<string> {
  const out = new Set<string>();

  const visit = (elements: MessageFormatElement[]) => {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.argument:
          out.add(`argument:${element.value}`);
          break;
        case TYPE.number:
          out.add(`number:${element.value}`);
          break;
        case TYPE.date:
          out.add(`date:${element.value}`);
          break;
        case TYPE.time:
          out.add(`time:${element.value}`);
          break;
        case TYPE.plural:
          out.add(`plural:${element.value}`);
          for (const option of Object.values(element.options)) {
            visit(option.value);
          }
          break;
        case TYPE.select:
          out.add(`select:${element.value}`);
          for (const option of Object.values(element.options)) {
            visit(option.value);
          }
          break;
        case TYPE.tag:
          out.add(`tag:${element.value}`);
          visit(element.children);
          break;
      }
    }
  };

  // Parse with rich-text tag handling enabled, matching the runtime behavior.
  // This also rejects unescaped HTML-like literals such as named regex groups.
  visit(parse(s));
  return out;
}

describe("i18n completeness", () => {
  const messagesDirectory = path.join(process.cwd(), "src", "messages");
  const messagesByLocale = Object.fromEntries(
    locales.map((locale) => [
      locale,
      JSON.parse(
        readFileSync(path.join(messagesDirectory, `${locale}.json`), "utf8"),
      ) as Dict,
    ]),
  );
  const referenceFlat = flattenKeys(messagesByLocale[englishLocale]);
  const arabicTechnicalLiteralKeys = new Set([
    "RepositoryForm.placeholder",
    "RepositoryForm.provider_select_github",
    "RepositoryForm.provider_select_gitlab",
    "RepositoryForm.provider_select_codeberg",
    "SettingsPage.two_factor_verify_code_placeholder",
    "SettingsPage.account_email_new_placeholder",
    "SettingsForm.custom_security_patterns_placeholder",
    "SettingsForm.provider_github",
    "SettingsForm.provider_gitlab",
    "SettingsForm.provider_codeberg",
    "SettingsForm.apprise_format_html",
    "SettingsForm.apprise_format_markdown",
    "RepoSettingsDialog.version_tag_pattern_placeholder",
    "TestPage.not_available",
    "LoginPage.setup_token_placeholder",
    "LoginPage.setup_username_placeholder",
    "LoginPage.email_placeholder",
    "LoginPage.social_identifier_placeholder",
    "LoginPage.social_provider_github",
    "LoginPage.social_provider_google",
    "LoginPage.two_factor_login_code_placeholder",
    "RegisterPage.username_placeholder",
    "RegisterPage.email_placeholder",
    "TestRelease.code_inline_code_word",
    "TestRelease.table_row4_notes",
  ]);
  const frenchSharedOrTechnicalLiteralKeys = new Set([
    "Metadata.title",
    "HomePage.title",
    "HomePage.view_mode_compact",
    "RepositoryForm.placeholder",
    "RepositoryForm.provider_select_github",
    "RepositoryForm.provider_select_gitlab",
    "RepositoryForm.provider_select_codeberg",
    "SettingsPage.two_factor_verify_code_placeholder",
    "SettingsForm.provider_github",
    "SettingsForm.provider_gitlab",
    "SettingsForm.provider_codeberg",
    "SettingsForm.security_highlight_color_orange",
    "SettingsForm.custom_security_patterns_placeholder",
    "SettingsForm.refresh_interval_minutes_label",
    "SettingsForm.cron_time_minute_label",
    "SettingsForm.cron_time_am",
    "SettingsForm.cron_time_pm",
    "SettingsForm.apprise_format_markdown",
    "SettingsForm.apprise_format_html",
    "SettingsForm.release_channel_stable",
    "RepoSettingsDialog.version_tag_pattern_placeholder",
    "RepoSettingsDialog.apprise_format_placeholder",
    "Email.from_name_fallback",
    "Email.text_version_label",
    "LoginPage.setup_token_placeholder",
    "LoginPage.setup_username_placeholder",
    "LoginPage.email_placeholder",
    "LoginPage.social_provider_github",
    "LoginPage.social_provider_google",
    "LoginPage.social_identifier_placeholder",
    "LoginPage.two_factor_login_code_placeholder",
    "RegisterPage.username_placeholder",
    "RegisterPage.email_placeholder",
    "TestRelease.code_inline_code_word",
    "TestRelease.table_header_notes",
    "TestRelease.table_row1_notes",
    "TestRelease.table_row4_notes",
  ]);
  const spanishSharedOrTechnicalLiteralKeys = new Set([
    "Metadata.title",
    "HomePage.title",
    "RepositoryForm.placeholder",
    "RepositoryForm.provider_select_github",
    "RepositoryForm.provider_select_gitlab",
    "RepositoryForm.provider_select_codeberg",
    "ReleaseCard.toast_error_title",
    "SettingsPage.two_factor_verify_code_placeholder",
    "SettingsForm.provider_github",
    "SettingsForm.provider_gitlab",
    "SettingsForm.provider_codeberg",
    "SettingsForm.custom_security_patterns_placeholder",
    "SettingsForm.toast_error_title",
    "SettingsForm.apprise_format_markdown",
    "SettingsForm.apprise_format_html",
    "RepoSettingsDialog.version_tag_pattern_placeholder",
    "RepoSettingsDialog.toast_error_title",
    "RepoSettingsDialog.autosave_error",
    "RepoSettingsDialog.apprise_tags_placeholder",
    "RepoSettingsDialog.apprise_format_placeholder",
    "TestPage.toast_error_title",
    "TestPage.toast_apprise_error_title",
    "Email.from_name_fallback",
    "LoginPage.setup_token_placeholder",
    "LoginPage.setup_username_placeholder",
    "LoginPage.email_placeholder",
    "LoginPage.social_provider_github",
    "LoginPage.social_provider_google",
    "LoginPage.social_identifier_placeholder",
    "LoginPage.two_factor_login_code_placeholder",
    "RegisterPage.username_placeholder",
    "RegisterPage.email_placeholder",
    "TestRelease.section_emojis",
    "TestRelease.code_inline_code_word",
    "TestRelease.table_row1_notes",
    "TestRelease.table_row4_notes",
  ]);

  it("detects nested ICU arguments without treating regex quantifiers as arguments", () => {
    expect(
      [
        ...extractPlaceholderSignatures(
          "{count, plural, other {{nested, select, yes {ok} other {no}}}} /x'{4,}'/",
        ),
      ].sort(),
    ).toEqual(["plural:count", "select:nested"]);
  });

  it("includes rich-text tag names in the message signature", () => {
    expect(
      [
        ...extractPlaceholderSignatures(
          "Remove <bold>{repoId}</bold> from <source></source>.",
        ),
      ].sort(),
    ).toEqual(["argument:repoId", "tag:bold", "tag:source"]);
  });

  it("renders ICU-escaped regex examples as their intended literal values", () => {
    const settingsMessages = messagesByLocale[englishLocale].SettingsForm;
    if (!settingsMessages || typeof settingsMessages !== "object") {
      throw new Error("SettingsForm messages are missing.");
    }

    expect(
      parse(
        (settingsMessages as Dict)
          .custom_security_patterns_placeholder as string,
      ),
    ).toEqual([
      {
        type: TYPE.literal,
        value: "breaking\n/CVE-\\d{4}-\\d{4,}/i",
      },
    ]);
    expect(
      parse(
        (messagesByLocale[englishLocale].RepoSettingsDialog as Dict)
          .version_tag_pattern_placeholder as string,
      ),
    ).toEqual([
      {
        type: TYPE.literal,
        value: "^docker/(?<version>\\d+(?:\\.\\d+){2,3})-r(?<revision>\\d+)$",
      },
    ]);
  });

  it("has exactly one message file for every configured locale", () => {
    const messageLocales = readdirSync(messagesDirectory)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort();

    expect(messageLocales).toEqual([...locales].sort());
  });

  it.each(locales.filter((locale) => locale !== englishLocale))(
    "%s has all English keys and no extra keys",
    (locale) => {
      const localizedFlat = flattenKeys(messagesByLocale[locale]);
      const referenceKeys = new Set(Object.keys(referenceFlat));
      const localizedKeys = new Set(Object.keys(localizedFlat));

      const missing: string[] = [];
      for (const key of referenceKeys) {
        if (!localizedKeys.has(key)) missing.push(key);
      }

      const extra: string[] = [];
      for (const key of localizedKeys) {
        if (!referenceKeys.has(key)) extra.push(key);
      }

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    },
  );

  it.each(locales.filter((locale) => locale !== englishLocale))(
    "%s placeholders match English",
    (locale) => {
      const localizedFlat = flattenKeys(messagesByLocale[locale]);
      const commonKeys = Object.keys(referenceFlat).filter(
        (key) => key in localizedFlat,
      );
      const mismatches: Array<{
        key: string;
        reference: string[];
        localized: string[];
      }> = [];

      for (const key of commonKeys) {
        const reference = Array.from(
          extractPlaceholderSignatures(referenceFlat[key]),
        ).sort();
        const localized = Array.from(
          extractPlaceholderSignatures(localizedFlat[key]),
        ).sort();
        if (reference.join("|") !== localized.join("|")) {
          mismatches.push({ key, reference, localized });
        }
      }

      expect(mismatches).toEqual([]);
    },
  );

  it("contains Arabic script in every translatable Arabic message", () => {
    const arabicFlat = flattenKeys(messagesByLocale.ar);
    const withoutArabic = Object.entries(arabicFlat)
      .filter(([key]) => !arabicTechnicalLiteralKeys.has(key))
      .filter(([, value]) => !/[\u0600-\u06ff]/u.test(value))
      .map(([key]) => key);

    expect(withoutArabic).toEqual([]);
  });

  it("keeps only shared or technical French messages identical to English", () => {
    const frenchFlat = flattenKeys(messagesByLocale.fr);
    const unchanged = Object.entries(frenchFlat)
      .filter(([key, value]) => referenceFlat[key] === value)
      .map(([key]) => key)
      .sort();

    expect(unchanged).toEqual(
      Array.from(frenchSharedOrTechnicalLiteralKeys).sort(),
    );
  });

  it("keeps only shared or technical Spanish messages identical to English", () => {
    const spanishFlat = flattenKeys(messagesByLocale.es);
    const unchanged = Object.entries(spanishFlat)
      .filter(([key, value]) => referenceFlat[key] === value)
      .map(([key]) => key)
      .sort();

    expect(unchanged).toEqual(
      Array.from(spanishSharedOrTechnicalLiteralKeys).sort(),
    );
  });
});
