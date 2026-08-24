// vitest globals are enabled via vitest.config.ts

const { sendNotificationMock, sendEmailDigestMock, sendAppriseDigestMock } =
  vi.hoisted(() => ({
    sendNotificationMock: vi.fn(),
    sendEmailDigestMock: vi.fn(),
    sendAppriseDigestMock: vi.fn(),
  }));

vi.mock("@/lib/notifications", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications")>();
  return {
    ...actual,
    sendNotification: sendNotificationMock,
  };
});

vi.mock("@/lib/notifications/email", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications/email")>();
  return { ...actual, sendReleaseDigestEmail: sendEmailDigestMock };
});

vi.mock("@/lib/notifications/apprise", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications/apprise")>();
  return { ...actual, sendAppriseDigest: sendAppriseDigestMock };
});

import {
  ABANDONED_NOTIFICATION_RETENTION_MS,
  deliverPendingNotifications,
  enqueuePendingNotification,
  MAX_ABANDONED_NOTIFICATIONS_PER_REPOSITORY,
  MAX_NOTIFICATION_DELIVERIES_PER_RUN,
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
  NOTIFICATION_DELIVERY_CONCURRENCY,
} from "@/lib/notifications/pending-deliveries";
import type { PendingReleaseNotification, Repository } from "@/types";

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
    sendEmailDigestMock.mockReset();
    sendAppriseDigestMock.mockReset();
  });

  it("snapshots both notification modes and release-notes settings", () => {
    const repository: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
    };

    expect(
      enqueuePendingNotification(
        repository,
        createPendingNotification("repo").release,
        "en",
        {
          timeFormat: "24h",
          locale: "en",
          refreshInterval: 10,
          cacheInterval: 5,
          releasesPerPage: 30,
          parallelRepoFetches: 1,
          releaseChannels: ["stable"],
          emailIncludeReleaseNotes: false,
          emailNotificationMode: "batch",
          appriseIncludeReleaseNotes: false,
          appriseNotificationMode: "batch",
        },
        ["email", "apprise"],
      ),
    ).toBe(true);
    expect(repository.pendingNotifications?.[0].settings).toMatchObject({
      emailIncludeReleaseNotes: false,
      emailNotificationMode: "batch",
      appriseIncludeReleaseNotes: false,
      appriseNotificationMode: "batch",
    });
  });

  it("sends all releases from one email batch as one message", async () => {
    sendEmailDigestMock.mockResolvedValue(undefined);
    const repositories = createRepositories(100);
    for (const repository of repositories) {
      const notification = repository.pendingNotifications?.[0];
      if (!notification) throw new Error("Expected pending notification");
      notification.batchId = "check-1";
      notification.settings.emailNotificationMode = "batch";
    }

    const result = await deliverPendingNotifications(repositories);

    expect(sendEmailDigestMock).toHaveBeenCalledOnce();
    expect(sendEmailDigestMock.mock.calls[0][0]).toHaveLength(100);
    expect(result.notificationsSent).toBe(1);
    expect(
      result.repositories.some(
        (repository) => repository.pendingNotifications?.length,
      ),
    ).toBe(false);
  });

  it("uses the existing per-release delivery for singleton batch work units", async () => {
    sendNotificationMock.mockResolvedValue(undefined);
    const notification = createPendingNotification("repo");
    notification.channels = ["email", "apprise"];
    notification.batchId = "check-1";
    notification.settings.emailNotificationMode = "batch";
    notification.settings.appriseNotificationMode = "batch";
    const repository: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      pendingNotifications: [notification],
    };

    const result = await deliverPendingNotifications([repository]);

    expect(sendEmailDigestMock).not.toHaveBeenCalled();
    expect(sendAppriseDigestMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(
      sendNotificationMock.mock.calls.map((call) => call[4]).sort(),
    ).toEqual([["apprise"], ["email"]]);
    expect(result.notificationsSent).toBe(2);
    expect(result.repositories[0].pendingNotifications).toBeUndefined();
  });

  it("processes an unlimited run with the configured rolling concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    sendNotificationMock.mockImplementation(async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
    });

    const result = await deliverPendingNotifications(
      createRepositories(25),
      new Date(),
      {
        notificationMaxMessagesPerRun: 0,
        notificationDeliveryConcurrency: 3,
      },
    );

    expect(result.notificationsSent).toBe(25);
    expect(maximumActive).toBe(3);
  });

  it("keeps only a failed channel and does not resend a successful channel", async () => {
    const notification = createPendingNotification("repo");
    notification.channels = ["email", "apprise"];
    const repository: Repository = {
      id: "owner/repo",
      url: "https://github.com/owner/repo",
      pendingNotifications: [notification],
    };
    sendNotificationMock.mockImplementation(
      async (_repository, _release, _locale, _settings, channels: string[]) => {
        if (channels.includes("apprise")) throw new Error("Apprise down");
      },
    );

    const first = await deliverPendingNotifications(
      [repository],
      new Date("2026-07-14T12:00:00.000Z"),
    );
    expect(first.notificationsSent).toBe(1);
    expect(first.repositories[0].pendingNotifications?.[0].channels).toEqual([
      "apprise",
    ]);

    sendNotificationMock.mockClear();
    sendNotificationMock.mockResolvedValue(undefined);
    const retryAt = new Date("2026-07-14T12:02:00.000Z");
    const second = await deliverPendingNotifications(
      first.repositories,
      retryAt,
    );
    expect(second.notificationsSent).toBe(1);
    expect(sendNotificationMock).toHaveBeenCalledOnce();
    expect(sendNotificationMock.mock.calls[0][4]).toEqual(["apprise"]);
  });

  it("delivers singleton Apprise groups with different tags separately", async () => {
    sendNotificationMock.mockResolvedValue(undefined);
    const repositories = createRepositories(2);
    repositories.forEach((repository, index) => {
      const notification = repository.pendingNotifications?.[0];
      if (!notification) throw new Error("Expected pending notification");
      notification.channels = ["apprise"];
      notification.batchId = "check-1";
      notification.settings.appriseNotificationMode = "batch";
      notification.repository.appriseTags = `target-${index}`;
    });

    const result = await deliverPendingNotifications(repositories);

    expect(sendAppriseDigestMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(sendNotificationMock.mock.calls.map((call) => call[4])).toEqual([
      ["apprise"],
      ["apprise"],
    ]);
    expect(result.notificationsSent).toBe(2);
  });

  it("delivers singleton Apprise groups with different formats separately", async () => {
    sendNotificationMock.mockResolvedValue(undefined);
    const repositories = createRepositories(2);
    repositories.forEach((repository, index) => {
      const notification = repository.pendingNotifications?.[0];
      if (!notification) throw new Error("Expected pending notification");
      notification.channels = ["apprise"];
      notification.batchId = "check-1";
      notification.settings.appriseNotificationMode = "batch";
      notification.repository.appriseTags = "shared-target";
      notification.repository.appriseFormat = index === 0 ? "text" : "markdown";
    });

    const result = await deliverPendingNotifications(repositories);

    expect(sendAppriseDigestMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(
      sendNotificationMock.mock.calls
        .map((call) => call[0].appriseFormat)
        .sort(),
    ).toEqual(["markdown", "text"]);
    expect(result.notificationsSent).toBe(2);
  });

  it("combines compatible Apprise entries into one batch", async () => {
    sendAppriseDigestMock.mockResolvedValue(undefined);
    const repositories = createRepositories(2);
    repositories.forEach((repository) => {
      const notification = repository.pendingNotifications?.[0];
      if (!notification) throw new Error("Expected pending notification");
      notification.channels = ["apprise"];
      notification.batchId = "check-1";
      notification.settings.appriseNotificationMode = "batch";
      notification.repository.appriseTags = "shared-target";
      notification.repository.appriseFormat = "markdown";
    });

    const result = await deliverPendingNotifications(repositories);

    expect(sendAppriseDigestMock).toHaveBeenCalledOnce();
    expect(sendAppriseDigestMock.mock.calls[0][0]).toHaveLength(2);
    expect(result.notificationsSent).toBe(1);
  });

  it("counts an email batch and a compatible Apprise batch as two messages", async () => {
    sendEmailDigestMock.mockResolvedValue(undefined);
    sendAppriseDigestMock.mockResolvedValue(undefined);
    const repositories = createRepositories(2);
    repositories.forEach((repository) => {
      const notification = repository.pendingNotifications?.[0];
      if (!notification) throw new Error("Expected pending notification");
      notification.channels = ["email", "apprise"];
      notification.batchId = "check-1";
      notification.settings.emailNotificationMode = "batch";
      notification.settings.appriseNotificationMode = "batch";
    });

    const result = await deliverPendingNotifications(repositories);

    expect(sendEmailDigestMock).toHaveBeenCalledOnce();
    expect(sendAppriseDigestMock).toHaveBeenCalledOnce();
    expect(result.notificationsSent).toBe(2);
    expect(result.repositories[0].pendingNotifications).toBeUndefined();
    expect(result.repositories[1].pendingNotifications).toBeUndefined();
  });

  it("retries only a failed batch channel", async () => {
    sendEmailDigestMock.mockResolvedValue(undefined);
    sendAppriseDigestMock.mockRejectedValueOnce(new Error("Apprise down"));
    const repositories = createRepositories(2);
    repositories.forEach((repository) => {
      const notification = repository.pendingNotifications?.[0];
      if (!notification) throw new Error("Expected pending notification");
      notification.channels = ["email", "apprise"];
      notification.batchId = "check-1";
      notification.settings.emailNotificationMode = "batch";
      notification.settings.appriseNotificationMode = "batch";
    });

    const first = await deliverPendingNotifications(
      repositories,
      new Date("2026-07-14T12:00:00.000Z"),
    );

    expect(first.notificationsSent).toBe(1);
    expect(sendEmailDigestMock).toHaveBeenCalledOnce();
    expect(sendAppriseDigestMock).toHaveBeenCalledOnce();
    expect(
      first.repositories.map(
        (repository) => repository.pendingNotifications?.[0].channels,
      ),
    ).toEqual([["apprise"], ["apprise"]]);

    sendAppriseDigestMock.mockResolvedValueOnce(undefined);
    const second = await deliverPendingNotifications(
      first.repositories,
      new Date("2026-07-14T12:02:00.000Z"),
    );

    expect(second.notificationsSent).toBe(1);
    expect(sendEmailDigestMock).toHaveBeenCalledOnce();
    expect(sendAppriseDigestMock).toHaveBeenCalledTimes(2);
    expect(
      second.repositories.some(
        (repository) => repository.pendingNotifications?.length,
      ),
    ).toBe(false);
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
    expect(result.notificationsSent).toBe(MAX_NOTIFICATION_DELIVERIES_PER_RUN);
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

  it("removes abandoned deliveries after the retention period", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const notification = createPendingNotification(
      "expired",
      MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
    );
    notification.abandonedAt = new Date(
      now.getTime() - ABANDONED_NOTIFICATION_RETENTION_MS - 1,
    ).toISOString();

    const result = await deliverPendingNotifications(
      [
        {
          id: "owner/repo",
          url: "https://github.com/owner/repo",
          pendingNotifications: [notification],
        },
      ],
      now,
    );

    expect(result.changed).toBe(true);
    expect(result.repositories[0].pendingNotifications).toBeUndefined();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("keeps only the newest bounded set of abandoned deliveries", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const pendingNotifications = Array.from(
      { length: MAX_ABANDONED_NOTIFICATIONS_PER_REPOSITORY + 2 },
      (_, index) => {
        const notification = createPendingNotification(
          `abandoned-${index}`,
          MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
        );
        notification.abandonedAt = new Date(
          now.getTime() - index * 1_000,
        ).toISOString();
        return notification;
      },
    );

    const result = await deliverPendingNotifications(
      [
        {
          id: "owner/repo",
          url: "https://github.com/owner/repo",
          pendingNotifications,
        },
      ],
      now,
    );

    expect(result.repositories[0].pendingNotifications).toHaveLength(
      MAX_ABANDONED_NOTIFICATIONS_PER_REPOSITORY,
    );
    expect(
      result.repositories[0].pendingNotifications?.map(({ id }) => id),
    ).not.toContain(
      `abandoned-${MAX_ABANDONED_NOTIFICATIONS_PER_REPOSITORY + 1}`,
    );
  });
});
