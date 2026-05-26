// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronTimeSelect } from "@/components/cron-time-select";

interface MockSelectProps {
  children?: ReactNode;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  value?: string;
}

interface MockChildrenProps {
  children?: ReactNode;
}

interface MockSelectItemProps extends MockChildrenProps {
  value: string;
}

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
  SelectTrigger: ({ children }: MockChildrenProps) => <>{children}</>,
  SelectContent: ({ children }: MockChildrenProps) => <>{children}</>,
  SelectItem: ({ children, value }: MockSelectItemProps) => (
    <option value={value}>{children}</option>
  ),
  SelectValue: () => null,
}));

const labels = {
  hour: "Hour",
  minute: "Minute",
  period: "Period",
  am: "AM",
  pm: "PM",
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function setSelectValue(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function getSelects(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll("select"),
  ) as HTMLSelectElement[];
}

describe("CronTimeSelect", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function render(timeFormat: "12h" | "24h", value = "08:00") {
    act(() => {
      root.render(
        <CronTimeSelect
          ids={{ hour: "hour", minute: "minute", period: "period" }}
          labels={labels}
          value={value}
          onChange={onChange}
          timeFormat={timeFormat}
        />,
      );
    });
  }

  it("renders 24-hour selects without AM/PM", () => {
    render("24h");
    const selects = getSelects(container);
    const hourOptions = Array.from(selects[0].options).map(
      (option) => option.value,
    );

    expect(selects).toHaveLength(2);
    expect(selects[0].value).toBe("08");
    expect(selects[1].value).toBe("00");
    expect(hourOptions).toHaveLength(24);
    expect(hourOptions[0]).toBe("00");
    expect(hourOptions[23]).toBe("23");
  });

  it("renders 12-hour selects with AM/PM", () => {
    render("12h");
    const selects = getSelects(container);
    const hourOptions = Array.from(selects[0].options).map(
      (option) => option.value,
    );

    expect(selects).toHaveLength(3);
    expect(selects[0].value).toBe("8");
    expect(selects[1].value).toBe("00");
    expect(selects[2].value).toBe("AM");
    expect(hourOptions).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
  });

  it("falls back to 08:00 when the value is invalid", () => {
    render("24h", "not-a-time");
    const selects = getSelects(container);

    expect(selects[0].value).toBe("08");
    expect(selects[1].value).toBe("00");
  });

  it("converts 9 PM to 21:00", () => {
    render("12h", "09:00");
    const [, , periodSelect] = getSelects(container);

    act(() => {
      setSelectValue(periodSelect, "PM");
    });

    expect(onChange).toHaveBeenCalledWith("21:00");
  });

  it("converts 12 AM to 00:00", () => {
    render("12h", "12:00");
    const [, , periodSelect] = getSelects(container);

    act(() => {
      setSelectValue(periodSelect, "AM");
    });

    expect(onChange).toHaveBeenCalledWith("00:00");
  });
});
