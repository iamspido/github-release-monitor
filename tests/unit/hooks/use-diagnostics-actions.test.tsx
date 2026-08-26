// @vitest-environment jsdom
import { act, type ChangeEvent } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiagnosticsActions } from "@/hooks/use-diagnostics-actions";
import type { AppriseStatus, UpdateNotificationState } from "@/types";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  checkApprise: vi.fn(),
  reloadIfStale: vi.fn(),
  sendApprise: vi.fn(),
  sendEmail: vi.fn(),
  setupTestRepository: vi.fn(),
  toast: vi.fn(),
  triggerReleaseCheck: vi.fn(),
  triggerUpdateCheck: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  checkAppriseStatusAction: (...args: unknown[]) => mocks.checkApprise(...args),
  sendTestAppriseAction: (...args: unknown[]) => mocks.sendApprise(...args),
  sendTestEmailAction: (...args: unknown[]) => mocks.sendEmail(...args),
  setupTestRepositoryAction: (...args: unknown[]) =>
    mocks.setupTestRepository(...args),
  triggerAppUpdateCheckAction: (...args: unknown[]) =>
    mocks.triggerUpdateCheck(...args),
  triggerReleaseCheckAction: (...args: unknown[]) =>
    mocks.triggerReleaseCheck(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/server-action-error", () => ({
  reloadIfServerActionStale: (...args: unknown[]) =>
    mocks.reloadIfStale(...args),
}));

type DiagnosticsController = ReturnType<typeof useDiagnosticsActions>;

const initialAppriseStatus: AppriseStatus = { status: "not_configured" };
const initialUpdateNotice: UpdateNotificationState = {
  latestVersion: null,
  latestReleaseTitle: null,
  latestSecurityVersion: null,
  currentVersion: "2.3.0",
  lastCheckedAt: null,
  lastCheckError: null,
  hasUpdate: false,
  isDismissed: false,
  isSecurityUpdate: false,
  shouldNotify: false,
};

function Harness({
  onRender,
}: {
  onRender: (controller: DiagnosticsController) => void;
}) {
  const controller = useDiagnosticsActions({
    initialAppriseStatus,
    initialUpdateNotice,
    t: (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key),
  });
  onRender(controller);
  return null;
}

describe("useDiagnosticsActions", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let controller!: DiagnosticsController;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    vi.clearAllMocks();
    mocks.reloadIfStale.mockReturnValue(false);
    mocks.sendEmail.mockResolvedValue({ success: true });
    mocks.sendApprise.mockResolvedValue({ success: true });
    mocks.checkApprise.mockResolvedValue({ status: "ok" });
    mocks.setupTestRepository.mockResolvedValue({
      success: true,
      message: "Repository ready",
    });
    mocks.triggerReleaseCheck.mockResolvedValue({
      success: true,
      message: "Release check complete",
    });
    mocks.triggerUpdateCheck.mockResolvedValue({
      notice: initialUpdateNotice,
    });

    await act(async () => {
      root.render(
        <Harness
          onRender={(nextController) => {
            controller = nextController;
          }}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function run(action: () => void) {
    await act(async () => {
      action();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function changeEmail(value: string) {
    controller.handleEmailChange({
      target: { value },
    } as ChangeEvent<HTMLInputElement>);
  }

  it("validates custom email and sends a valid address", async () => {
    await run(() => changeEmail("invalid"));
    expect(controller.isEmailInvalid).toBe(true);

    await run(() => controller.handleSendTestEmail());
    expect(mocks.sendEmail).not.toHaveBeenCalled();

    await run(() => changeEmail("alerts@example.test"));
    expect(controller.isEmailInvalid).toBe(false);
    await run(() => controller.handleSendTestEmail());

    expect(mocks.sendEmail).toHaveBeenCalledWith("alerts@example.test");
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "toast_email_success_title",
      description: "toast_email_success_description",
    });
  });

  it("shows server and exception errors for test email delivery", async () => {
    mocks.sendEmail.mockResolvedValueOnce({
      success: false,
      error: "SMTP rejected",
    });
    await run(() => changeEmail(""));
    await run(() => controller.handleSendTestEmail());

    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "toast_email_error_title",
      description: "SMTP rejected",
      variant: "destructive",
    });

    mocks.sendEmail.mockRejectedValueOnce(new Error("offline"));
    await run(() => controller.handleSendTestEmail());
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "toast_email_error_title",
      description: "toast_email_error_description",
      variant: "destructive",
    });
  });

  it("handles Apprise send results and refreshes its status", async () => {
    await run(() => controller.handleSendTestApprise());
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "toast_apprise_success_title",
      description: "toast_apprise_success_description",
    });

    mocks.sendApprise.mockResolvedValueOnce({
      success: false,
      error: "Apprise rejected",
    });
    await run(() => controller.handleSendTestApprise());
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "toast_apprise_error_title",
      description: "Apprise rejected",
      variant: "destructive",
    });

    await run(() => controller.handleRefreshAppriseStatus());
    expect(controller.appriseStatus).toEqual({ status: "ok" });
  });

  it("updates the displayed release notice and reports update errors", async () => {
    const availableNotice: UpdateNotificationState = {
      ...initialUpdateNotice,
      latestVersion: "2.4.0",
      hasUpdate: true,
      shouldNotify: true,
    };
    mocks.triggerUpdateCheck.mockResolvedValueOnce({
      notice: availableNotice,
    });

    await run(() => controller.handleManualUpdateCheck());
    expect(controller.updateNotice).toEqual(availableNotice);
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "toast_success_title",
      description: 'toast_update_available_description:{"version":"2.4.0"}',
    });

    const failedNotice = {
      ...availableNotice,
      lastCheckError: "GitHub unavailable",
    };
    mocks.triggerUpdateCheck.mockResolvedValueOnce({ notice: failedNotice });
    await run(() => controller.handleManualUpdateCheck());
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "toast_error_title",
      description:
        'toast_update_error_description:{"error":"GitHub unavailable"}',
      variant: "destructive",
    });
  });

  it.each([
    ["test repository", "handleSetupTestRepo", "setupTestRepository"],
    ["release check", "handleTriggerReleaseCheck", "triggerReleaseCheck"],
  ] as const)(
    "shows action results for %s",
    async (_label, handlerName, mockName) => {
      await run(() => controller[handlerName]());
      expect(mocks[mockName]).toHaveBeenCalledOnce();
      expect(mocks.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "toast_success_title",
          variant: "default",
          ...(handlerName === "handleSetupTestRepo"
            ? {
                "data-result": "success",
                "data-testid": "test-repository-result",
              }
            : {}),
        }),
      );

      mocks[mockName].mockResolvedValueOnce({
        success: false,
        message: "Action failed",
      });
      await run(() => controller[handlerName]());
      expect(mocks.toast).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "toast_error_title",
          description: "Action failed",
          variant: "destructive",
          ...(handlerName === "handleSetupTestRepo"
            ? {
                "data-result": "error",
                "data-testid": "test-repository-result",
              }
            : {}),
        }),
      );
    },
  );

  it("suppresses fallback toasts when a stale action triggers a reload", async () => {
    mocks.sendApprise.mockRejectedValueOnce(new Error("stale"));
    mocks.reloadIfStale.mockReturnValueOnce(true);

    await run(() => controller.handleSendTestApprise());

    expect(mocks.reloadIfStale).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
