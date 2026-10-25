// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";

interface MockSelectProps {
  children?: ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  value?: string;
}

interface MockSelectItemProps {
  children?: ReactNode;
  value: string;
}

const updateSettingsMock = vi.fn();
const routerPushMock = vi.fn();
const toastMock = vi.fn();
const translateMock = (key: string) => key;

vi.mock("next-intl", () => ({
  useTranslations: () => translateMock,
}));

vi.mock("@/app/settings/actions", () => ({
  updateSettingsPatchAction: (...args: unknown[]) =>
    updateSettingsMock(...args),
  deleteAllRepositoriesAction: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/hooks/use-network", () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, disabled, onValueChange, value }: MockSelectProps) => (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: MockSelectItemProps) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null,
}));

import { SettingsForm } from "@/components/settings-form";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const settings: AppSettings = {
  timeFormat: "24h",
  locale: "en",
  refreshInterval: 10,
  cacheInterval: 5,
  releasesPerPage: 30,
  parallelRepoFetches: 1,
  releaseChannels: ["stable"],
};

type PatternKey = "includeRegex" | "excludeRegex" | "customSecurityPatterns";

const storedPatterns: ReadonlyArray<{
  field: string;
  key: PatternKey;
  label: string;
  stored: string;
  refused: string;
  error: string;
}> = [
  {
    field: "include filter",
    key: "includeRegex",
    label: "include_regex_label",
    stored: "^v(?=\\d)",
    refused: "^v(?!0)",
    error: "regex_error_invalid",
  },
  {
    field: "exclude filter",
    key: "excludeRegex",
    label: "exclude_regex_label",
    stored: "-(?!final)",
    refused: "-(?!rc)",
    error: "regex_error_invalid",
  },
  {
    field: "custom security lines",
    key: "customSecurityPatterns",
    label: "custom_security_patterns_label",
    stored: "CVE-\n/advisory/y",
    refused: "CVE-\n/advisory(?!-draft)/i",
    error: "security_patterns_error_invalid",
  },
];

const savedResult = {
  success: true,
  message: { title: "ok", description: "ok" },
};

describe("SettingsForm with a stored pattern the engine refuses", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    updateSettingsMock.mockReset();
    updateSettingsMock.mockResolvedValue(savedResult);
    routerPushMock.mockReset();
    toastMock.mockReset();
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function renderForm(currentSettings: AppSettings) {
    await act(async () => {
      root.render(
        <SettingsForm
          currentSettings={currentSettings}
          isAppriseConfigured
          isGithubTokenSet
        />,
      );
    });
  }

  function fieldByLabel(label: string) {
    const labelElement = Array.from(container.querySelectorAll("label")).find(
      (candidate) => candidate.textContent === label,
    );
    const field = labelElement?.htmlFor
      ? document.getElementById(labelElement.htmlFor)
      : null;
    if (
      !(field instanceof HTMLInputElement) &&
      !(field instanceof HTMLTextAreaElement)
    ) {
      throw new Error(`${label} field not rendered`);
    }
    return field;
  }

  async function typeInto(label: string, value: string) {
    const field = fieldByLabel(label);
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
        field,
        value,
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function waitForAutosave() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function fieldMessage(label: string) {
    return fieldByLabel(label).parentElement?.textContent ?? "";
  }

  it.each(storedPatterns)(
    "saves another setting and keeps marking the stored $field",
    async ({ key, label, stored, error }) => {
      await renderForm({ ...settings, [key]: stored });
      expect(fieldByLabel(label).value).toBe(stored);
      expect(fieldMessage(label)).toContain(error);

      await typeInto("releases_per_page_label", "31");
      await waitForAutosave();

      expect(updateSettingsMock).toHaveBeenCalledOnce();
      const patch = updateSettingsMock.mock.calls[0]?.[0];
      expect(patch).toEqual({ releasesPerPage: 31 });
      expect(toastMock).not.toHaveBeenCalled();
      expect(fieldByLabel(label).value).toBe(stored);
      expect(fieldMessage(label)).toContain(error);
    },
  );

  it.each(storedPatterns)(
    "blocks saving once the stored $field is changed to another refused pattern",
    async ({ key, label, stored, refused, error }) => {
      await renderForm({ ...settings, [key]: stored });

      await typeInto(label, refused);
      await waitForAutosave();
      await typeInto("releases_per_page_label", "31");
      await waitForAutosave();

      expect(updateSettingsMock).not.toHaveBeenCalled();
      expect(fieldMessage(label)).toContain(error);
    },
  );

  it("saves again once a changed filter returns to the stored pattern", async () => {
    await renderForm({ ...settings, excludeRegex: "-(?!final)" });

    await typeInto("exclude_regex_label", "-(?!rc)");
    await waitForAutosave();
    expect(updateSettingsMock).not.toHaveBeenCalled();

    await typeInto("exclude_regex_label", "-(?!final)");
    await typeInto("releases_per_page_label", "31");
    await waitForAutosave();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenCalledWith({ releasesPerPage: 31 });
  });

  it("reads the stored filter without surrounding whitespace, as the server compares it", async () => {
    await renderForm({ ...settings, excludeRegex: "-(?!final)" });

    await typeInto("exclude_regex_label", " -(?!final) ");
    await typeInto("releases_per_page_label", "31");
    await waitForAutosave();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenCalledWith({
      excludeRegex: " -(?!final) ",
      releasesPerPage: 31,
    });
    expect(fieldMessage("exclude_regex_label")).toContain(
      "regex_error_invalid",
    );
  });

  it("blocks the former pattern after a valid filter has replaced it", async () => {
    await renderForm({ ...settings, excludeRegex: "-(?!final)" });

    await typeInto("exclude_regex_label", "-rc");
    await waitForAutosave();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      excludeRegex: "-rc",
    });

    await typeInto("exclude_regex_label", "-(?!final)");
    await typeInto("releases_per_page_label", "31");
    await waitForAutosave();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(fieldMessage("exclude_regex_label")).toContain(
      "regex_error_invalid",
    );
  });

  const securityLabel = "custom_security_patterns_label";
  const securityError = "security_patterns_error_invalid";
  const refusedSecurityLine = "/(?<=v)1\\.0/";
  const storedSecurityLines = `${refusedSecurityLine}\ncve`;
  const withStoredSecurityLines = {
    ...settings,
    customSecurityPatterns: storedSecurityLines,
  };

  it("saves a keyword line added next to a stored custom security line and keeps marking the field", async () => {
    await renderForm(withStoredSecurityLines);
    expect(fieldMessage(securityLabel)).toContain(securityError);

    await typeInto(securityLabel, `${storedSecurityLines}\nhotfix`);
    await waitForAutosave();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenCalledWith({
      customSecurityPatterns: `${storedSecurityLines}\nhotfix`,
    });
    expect(toastMock).not.toHaveBeenCalled();
    expect(fieldMessage(securityLabel)).toContain(securityError);
  });

  it("reads each stored custom security line without surrounding whitespace and in any order, as the server compares them", async () => {
    await renderForm(withStoredSecurityLines);
    const lines = `cve\n  ${refusedSecurityLine} \n/HF-\\d+/i`;

    await typeInto(securityLabel, lines);
    await waitForAutosave();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenCalledWith({
      customSecurityPatterns: lines,
    });
  });

  it.each([
    [
      "a stored custom security line changed into another refused line",
      "/(?<=v)1\\.1/\ncve",
    ],
    [
      "a new refused custom security line next to the stored lines",
      `${storedSecurityLines}\nhotfix\n/(?<!rc)\\d+/`,
    ],
  ])("blocks saving with %s", async (_, lines) => {
    await renderForm(withStoredSecurityLines);

    await typeInto(securityLabel, lines);
    await waitForAutosave();

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(fieldMessage(securityLabel)).toContain(securityError);
  });

  it("blocks a refused custom security line added again after a save has removed it", async () => {
    await renderForm(withStoredSecurityLines);

    await typeInto(securityLabel, "cve");
    await waitForAutosave();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(updateSettingsMock).toHaveBeenLastCalledWith({
      customSecurityPatterns: "cve",
    });

    await typeInto(securityLabel, storedSecurityLines);
    await waitForAutosave();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(fieldMessage(securityLabel)).toContain(securityError);
  });
});
