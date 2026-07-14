// vitest globals are enabled via vitest.config.ts

const { sendNotificationMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
}));

vi.mock("@/lib/notifications", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    sendNotification: sendNotificationMock,
  };
});

import {
  deliverPendingNotifications,
  MAX_NOTIFICATION_DELIVERIES_PER_RUN,
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
  NOTIFICATION_DELIVERY_CONCURRENCY,
} from "@/lib/notifications/pending-deliveries";
import type {
  PendingReleaseNotification,
  Repository,
} from "@/types";

function createPendingNotification(
  id: string,
  attempts = 0,
): PendingReleaseNotification {
  return {
    id,
    repository: { id: `owner/${id}`, url: `https://github.com/owner/${id}` },
    release: {
      id: 1,
      html_url: `https://github.com/owner/${id}/releases/tag/v1`,
      tag_name: "v1",
      name: "v1",
      body: null,
      created_at: "2026-07-14T00:00:00.000Z",
      published_at: "2026-07-14T00:00:00.000Z",
      prerelease: false,
      draft: false,
    },
    locale: "en",
    settings: { timeFormat: "24h" },
    channels: ["email"],
    createdAt: "2026-07-14T00:00:00.000Z",
    attempts,
  };
}

function createRepositories(count: number): Repository[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `owner/repo-${index}`,
    url: `https://github.com/owner/repo-${index}`,
    pendingNotifications: [createPendingNotification(`repo-${index}`)],
  }));
}

describe("notifications/pending-deliveries", () => {
  beforeEach(() => {
    sendNotificationMock.mockReset();
  });

  it("limits each delivery run to a bounded batch", async () => {
    sendNotificationMock.mockResolvedValue(undefined);
    const repositories = createRepositories(
      MAX_NOTIFICATION_DELIVERIES_PER_RUN + 1,
    );

    const result = await deliverPendingNotifications(repositories);

    expect(sendNotificationMock).toHaveBeenCalledTimes(
      MAX_NOTIFICATION_DELIVERIES_PER_RUN,
    );
    expect(result.notificationsSent).toBe(
      MAX_NOTIFICATION_DELIVERIES_PER_RUN,
    );
    expect(
      result.repositories.filter(
        (repository) => repository.pendingNotifications?.length,
      ),
    ).toHaveLength(1);
  });

  it("does not exceed the notification delivery concurrency limit", async () => {
    let activeDeliveries = 0;
    let maximumActiveDeliveries = 0;
    sendNotificationMock.mockImplementation(async () => {
      activeDeliveries++;
      maximumActiveDeliveries = Math.max(
        maximumActiveDeliveries,
        activeDeliveries,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeDeliveries--;
    });

    await deliverPendingNotifications(createRepositories(12));

    expect(maximumActiveDeliveries).toBe(NOTIFICATION_DELIVERY_CONCURRENCY);
  });

  it("abandons a delivery after the maximum attempts and does not retry it", async () => {
    sendNotificationMock.mockRejectedValue(new Error("SMTP unavailable"));
    const now = new Date("2026-07-14T12:00:00.000Z");
    const repositories: Repository[] = [
      {
        id: "owner/repo",
        url: "https://github.com/owner/repo",
        pendingNotifications: [
          createPendingNotification(
            "repo",
            MAX_NOTIFICATION_DELIVERY_ATTEMPTS - 1,
          ),
        ],
      },
    ];

    const failed = await deliverPendingNotifications(repositories, now);
    const abandoned = failed.repositories[0].pendingNotifications?.[0];

    expect(abandoned).toMatchObject({
      attempts: MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
      abandonedAt: now.toISOString(),
    });
    expect(abandoned?.nextAttemptAt).toBeUndefined();

    await deliverPendingNotifications(failed.repositories, now);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });
});
