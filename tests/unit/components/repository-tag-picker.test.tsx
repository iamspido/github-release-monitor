// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { RepositoryTagPicker } from "@/components/repository-tag-picker";

describe("RepositoryTagPicker", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function setInputValue(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderPicker({
    onTagSelect = vi.fn(() => true),
  }: {
    onTagSelect?: (tag: string) => boolean;
  } = {}) {
    function Harness() {
      const [value, setValue] = React.useState("");
      return (
        <RepositoryTagPicker
          id="repository-tags"
          options={["infra", "media"]}
          selectedTags={[]}
          value={value}
          onValueChange={setValue}
          onTagSelect={onTagSelect}
          onCreateTag={() => false}
          onInputBlur={() => {}}
          placeholder="Tags"
          listboxLabel="Existing tags"
          createOptionLabel={(tag) => `Add ${tag}`}
        />
      );
    }

    act(() => root.render(<Harness />));
    const input = container.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Tag picker input was not rendered.");
    return input;
  }

  it("keeps long pasted input so validation can report it", () => {
    const input = renderPicker();
    const pastedValue = "x".repeat(80);

    act(() => setInputValue(input, pastedValue));

    expect(input.value).toBe(pastedValue);
  });

  it("does not select the first option when Enter is pressed without input", () => {
    const onTagSelect = vi.fn(() => true);
    const input = renderPicker({ onTagSelect });

    act(() => {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onTagSelect).not.toHaveBeenCalled();
  });

  it("does not reclaim focus after a tag is selected", () => {
    let pendingFocus: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        pendingFocus = callback;
        return 1;
      });
    const input = renderPicker();
    const nextInput = document.createElement("textarea");
    document.body.appendChild(nextInput);

    act(() => {
      input.focus();
      setInputValue(input, "med");
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    nextInput.focus();
    act(() => pendingFocus?.(performance.now()));

    expect(document.activeElement).toBe(nextInput);

    nextInput.remove();
    requestAnimationFrame.mockRestore();
  });
});
