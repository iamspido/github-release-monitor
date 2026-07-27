// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addPasskeyMock = vi.fn();
const deletePasskeyMock = vi.fn();
const listPasskeysMock = vi.fn();

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/client-adapters", () => ({
  addPasskey: (...args: unknown[]) => addPasskeyMock(...args),
  deletePasskey: (...args: unknown[]) => deletePasskeyMock(...args),
  listPasskeys: (...args: unknown[]) => listPasskeysMock(...args),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("PasskeySettingsCard", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    addPasskeyMock.mockReset();
    deletePasskeyMock.mockReset();
    listPasskeysMock.mockReset();
    addPasskeyMock.mockResolvedValue(true);
    deletePasskeyMock.mockResolvedValue(true);
    listPasskeysMock.mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderCard() {
    const { PasskeySettingsCard } = await import(
      "@/components/passkey-settings-card"
    );
    await act(async () => {
      root.render(<PasskeySettingsCard timeFormat="24h" />);
      await Promise.resolve();
    });
  }

  it("loads and renders existing passkeys", async () => {
    listPasskeysMock.mockResolvedValueOnce([
      {
        id: "passkey-1",
        name: "Laptop",
        createdAt: "2026-01-01T12:00:00.000Z",
      },
    ]);

    await renderCard();

    expect(container.textContent).toContain("Laptop");
    expect(container.textContent).toContain("passkeys_created_at");
    expect(listPasskeysMock).toHaveBeenCalledOnce();
  });

  it("creates a named passkey and refreshes the list", async () => {
    listPasskeysMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "passkey-1", name: "Laptop", createdAt: null },
      ]);
    await renderCard();
    const input = container.querySelector("input") as HTMLInputElement;
    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("passkeys_add_button"),
    );

    await act(async () => {
      setInputValue(input, "  Laptop  ");
    });
    await act(async () => {
      addButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addPasskeyMock).toHaveBeenCalledWith("Laptop");
    expect(listPasskeysMock).toHaveBeenCalledTimes(2);
    expect(input.value).toBe("");
    expect(container.textContent).toContain("Laptop");
  });

  it("deletes a passkey and refreshes the list", async () => {
    listPasskeysMock
      .mockResolvedValueOnce([
        { id: "passkey-1", name: "Laptop", createdAt: null },
      ])
      .mockResolvedValueOnce([]);
    await renderCard();
    const deleteButton = container.querySelector(
      'button[aria-label="passkeys_delete_button"]',
    ) as HTMLButtonElement;

    await act(async () => {
      deleteButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deletePasskeyMock).toHaveBeenCalledWith("passkey-1");
    expect(listPasskeysMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("passkeys_empty");
  });

  it.each([
    ["load", "passkeys_error_load"],
    ["create", "passkeys_error_create"],
    ["delete", "passkeys_error_delete"],
  ] as const)("shows the %s error", async (mode, errorKey) => {
    if (mode === "load") {
      listPasskeysMock.mockRejectedValueOnce(new Error("load failed"));
      await renderCard();
    } else {
      listPasskeysMock.mockResolvedValueOnce([
        { id: "passkey-1", name: "Laptop", createdAt: null },
      ]);
      if (mode === "create") addPasskeyMock.mockResolvedValueOnce(false);
      if (mode === "delete") deletePasskeyMock.mockResolvedValueOnce(false);
      await renderCard();

      const button =
        mode === "create"
          ? Array.from(container.querySelectorAll("button")).find((candidate) =>
              candidate.textContent?.includes("passkeys_add_button"),
            )
          : container.querySelector(
              'button[aria-label="passkeys_delete_button"]',
            );
      await act(async () => {
        (button as HTMLButtonElement | null)?.click();
        await Promise.resolve();
      });
    }

    expect(container.textContent).toContain(errorKey);
  });
});
