import { describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_DELIVERY_TRACKING_HEADER,
  beginAuthEmailDeliveryTracking,
  consumeAuthEmailDeliveryStatus,
  runTrackedAuthEmailDelivery,
} from "@/lib/auth/email-delivery-status";

function trackedRequest(trackingId: string) {
  return new Request("http://localhost/api/auth/change-email", {
    headers: { [AUTH_EMAIL_DELIVERY_TRACKING_HEADER]: trackingId },
  });
}

describe("auth email delivery status", () => {
  it("records successful callback delivery", async () => {
    const trackingId = beginAuthEmailDeliveryTracking();

    await runTrackedAuthEmailDelivery(trackedRequest(trackingId), async () =>
      Promise.resolve(),
    );

    expect(consumeAuthEmailDeliveryStatus(trackingId)).toBe("sent");
    expect(consumeAuthEmailDeliveryStatus(trackingId)).toBeNull();
  });

  it("records callback failures before rethrowing them to Better Auth", async () => {
    const trackingId = beginAuthEmailDeliveryTracking();

    await expect(
      runTrackedAuthEmailDelivery(trackedRequest(trackingId), async () => {
        throw new Error("smtp unavailable");
      }),
    ).rejects.toThrow("smtp unavailable");

    expect(consumeAuthEmailDeliveryStatus(trackingId)).toBe("failed");
  });
});
