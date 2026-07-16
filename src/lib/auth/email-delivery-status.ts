import { randomUUID } from "node:crypto";

export const AUTH_EMAIL_DELIVERY_TRACKING_HEADER =
  "x-grm-auth-email-delivery-id";

export type AuthEmailDeliveryStatus = "pending" | "sent" | "failed";

const trackedDeliveries = new Map<string, AuthEmailDeliveryStatus>();

export function beginAuthEmailDeliveryTracking() {
  const trackingId = randomUUID();
  trackedDeliveries.set(trackingId, "pending");
  return trackingId;
}

export async function runTrackedAuthEmailDelivery(
  request: Request | undefined,
  deliver: () => Promise<void>,
) {
  const trackingId = request?.headers.get(AUTH_EMAIL_DELIVERY_TRACKING_HEADER);

  try {
    await deliver();
    if (trackingId && trackedDeliveries.get(trackingId) === "pending") {
      trackedDeliveries.set(trackingId, "sent");
    }
  } catch (error) {
    if (trackingId && trackedDeliveries.has(trackingId)) {
      trackedDeliveries.set(trackingId, "failed");
    }
    throw error;
  }
}

export function consumeAuthEmailDeliveryStatus(trackingId: string) {
  const status = trackedDeliveries.get(trackingId) ?? null;
  trackedDeliveries.delete(trackingId);
  return status;
}
