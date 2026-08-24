import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications";
import {
  getEffectiveAppriseProfile,
  sendAppriseDigest,
} from "@/lib/notifications/apprise";
import { sendReleaseDigestEmail } from "@/lib/notifications/email";
import type {
  AppSettings,
  GithubRelease,
  Locale,
  NotificationChannel,
  NotificationMode,
  PendingReleaseNotification,
  Repository,
} from "@/types";

const INITIAL_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60_000;
export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 10;
export const MAX_NOTIFICATION_DELIVERIES_PER_RUN = 20;
export const NOTIFICATION_DELIVERY_CONCURRENCY = 4;
export const ABANDONED_NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const MAX_ABANDONED_NOTIFICATIONS_PER_REPOSITORY = 50;

type ChannelState = {
  attempts: number;
  nextAttemptAt?: string;
  abandonedAt?: string;
};

type NotificationDeliveryOutcome = {
  repositoryId: string;
  notificationId: string;
  channel: NotificationChannel;
  previousAttempts: number;
  status: "sent" | "failed";
  attempts?: number;
  nextAttemptAt?: string;
  abandonedAt?: string;
};

type DeliveryMember = {
  repositoryId: string;
  notification: PendingReleaseNotification;
  previousAttempts: number;
};

type DeliveryWorkUnit = {
  key: string;
  channel: NotificationChannel;
  mode: NotificationMode;
  members: DeliveryMember[];
};

type DeliveryLimits = Pick<
  AppSettings,
  "notificationMaxMessagesPerRun" | "notificationDeliveryConcurrency"
>;

function getChannelState(
  notification: PendingReleaseNotification,
  channel: NotificationChannel,
): ChannelState {
  return (
    notification.channelStates?.[channel] ?? {
      attempts: notification.attempts,
      nextAttemptAt: notification.nextAttemptAt,
      abandonedAt: notification.abandonedAt,
    }
  );
}

export function enqueuePendingNotification(
  repository: Repository,
  release: GithubRelease,
  locale: Locale,
  settings: AppSettings,
  channels: NotificationChannel[],
  batchId?: string,
): boolean {
  if (channels.length === 0) {
    logger
      .withScope("Notifications")
      .warn(
        `No notification services (SMTP or Apprise) are configured. Skipping notification for ${repository.id}.`,
      );
    return false;
  }

  const id = `${encodeURIComponent(repository.id)}:${encodeURIComponent(
    release.tag_name,
  )}`;
  const existing = repository.pendingNotifications?.find(
    (notification) => notification.id === id,
  );
  if (existing) {
    const addedChannels = channels.filter(
      (channel) => !existing.channels.includes(channel),
    );
    existing.channels = Array.from(
      new Set([...existing.channels, ...channels]),
    );
    existing.channelStates = {
      ...existing.channelStates,
      ...Object.fromEntries(
        addedChannels.map((channel) => [channel, { attempts: 0 }]),
      ),
    };
    return false;
  }

  const notification: PendingReleaseNotification = {
    id,
    batchId,
    repository: {
      id: repository.id,
      url: repository.url,
      appriseTags: repository.appriseTags,
      appriseFormat: repository.appriseFormat,
    },
    release: { ...release },
    locale,
    settings: {
      timeFormat: settings.timeFormat,
      emailIncludeReleaseNotes: settings.emailIncludeReleaseNotes,
      emailNotificationMode: settings.emailNotificationMode ?? "per_release",
      appriseIncludeReleaseNotes: settings.appriseIncludeReleaseNotes,
      appriseNotificationMode:
        settings.appriseNotificationMode ?? "per_release",
      appriseMaxCharacters: settings.appriseMaxCharacters,
      appriseTags: settings.appriseTags,
      appriseFormat: settings.appriseFormat,
    },
    channels: [...channels],
    channelStates: Object.fromEntries(
      channels.map((channel) => [channel, { attempts: 0 }]),
    ),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  repository.pendingNotifications = [
    ...(repository.pendingNotifications ?? []),
    notification,
  ];
  return true;
}

function isChannelDue(
  notification: PendingReleaseNotification,
  channel: NotificationChannel,
  nowMs: number,
): boolean {
  const state = getChannelState(notification, channel);
  if (
    state.abandonedAt ||
    state.attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS
  ) {
    return false;
  }
  const nextAttemptMs = state.nextAttemptAt
    ? Date.parse(state.nextAttemptAt)
    : Number.NEGATIVE_INFINITY;
  return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= nowMs;
}

function getFullyAbandonedAt(
  notification: PendingReleaseNotification,
): string | undefined {
  const abandonedTimes = notification.channels.map(
    (channel) => getChannelState(notification, channel).abandonedAt,
  );
  if (abandonedTimes.some((value) => !value)) return undefined;
  return abandonedTimes.sort().at(-1);
}

export function pruneAbandonedNotifications(
  repositories: Repository[],
  now = new Date(),
): { repositories: Repository[]; changed: boolean } {
  const nowMs = now.getTime();
  let changed = false;
  const updatedRepositories = repositories.map((repository) => {
    const pendingNotifications = repository.pendingNotifications;
    if (!pendingNotifications?.length) return repository;
    const retainedAbandoned = new Set(
      pendingNotifications
        .map((notification) => ({
          notification,
          abandonedAt: getFullyAbandonedAt(notification),
        }))
        .filter(({ abandonedAt }) => {
          if (!abandonedAt) return false;
          const abandonedAtMs = Date.parse(abandonedAt);
          return (
            Number.isFinite(abandonedAtMs) &&
            abandonedAtMs <= nowMs &&
            nowMs - abandonedAtMs <= ABANDONED_NOTIFICATION_RETENTION_MS
          );
        })
        .sort(
          (a, b) =>
            Date.parse(b.abandonedAt ?? "") - Date.parse(a.abandonedAt ?? ""),
        )
        .slice(0, MAX_ABANDONED_NOTIFICATIONS_PER_REPOSITORY)
        .map(({ notification }) => notification),
    );
    const retained = pendingNotifications.filter(
      (notification) =>
        !getFullyAbandonedAt(notification) ||
        retainedAbandoned.has(notification),
    );
    if (retained.length === pendingNotifications.length) return repository;
    changed = true;
    return {
      ...repository,
      pendingNotifications: retained.length > 0 ? retained : undefined,
    };
  });
  return { repositories: updatedRepositories, changed };
}

function getDeliveryMode(
  notification: PendingReleaseNotification,
  channel: NotificationChannel,
): NotificationMode {
  return channel === "email"
    ? (notification.settings.emailNotificationMode ?? "per_release")
    : (notification.settings.appriseNotificationMode ?? "per_release");
}

function getBatchCompatibilityKey(
  notification: PendingReleaseNotification,
  channel: NotificationChannel,
): string {
  const common = {
    batchId: notification.batchId,
    locale: notification.locale,
    timeFormat: notification.settings.timeFormat,
  };
  if (channel === "email") {
    return JSON.stringify({
      ...common,
      includeNotes: notification.settings.emailIncludeReleaseNotes !== false,
    });
  }
  const profile = getEffectiveAppriseProfile(
    notification.repository,
    notification.settings,
  );
  return JSON.stringify({
    ...common,
    includeNotes: notification.settings.appriseIncludeReleaseNotes !== false,
    maxCharacters: notification.settings.appriseMaxCharacters ?? 0,
    ...profile,
  });
}

function buildDeliveryWorkUnits(
  repositories: Repository[],
  nowMs: number,
): DeliveryWorkUnit[] {
  const units = new Map<string, DeliveryWorkUnit>();
  for (const repository of repositories) {
    for (const notification of repository.pendingNotifications ?? []) {
      for (const channel of notification.channels) {
        if (!isChannelDue(notification, channel, nowMs)) continue;
        const requestedMode = getDeliveryMode(notification, channel);
        const mode =
          requestedMode === "batch" && notification.batchId
            ? "batch"
            : "per_release";
        const key =
          mode === "batch"
            ? `${channel}:batch:${getBatchCompatibilityKey(notification, channel)}`
            : `${channel}:per_release:${repository.id}:${notification.id}`;
        const unit = units.get(key) ?? { key, channel, mode, members: [] };
        unit.members.push({
          repositoryId: repository.id,
          notification,
          previousAttempts: getChannelState(notification, channel).attempts,
        });
        units.set(key, unit);
      }
    }
  }
  return [...units.values()];
}

async function sendDeliveryWorkUnit(unit: DeliveryWorkUnit): Promise<void> {
  const first = unit.members[0]?.notification;
  if (!first) return;
  const items = unit.members.map(({ notification }) => ({
    repository: notification.repository,
    release: notification.release,
  }));
  const useDigest = unit.mode === "batch" && items.length > 1;
  if (unit.channel === "email") {
    if (useDigest) {
      await sendReleaseDigestEmail(
        items,
        first.locale,
        first.settings.timeFormat,
        first.settings.emailIncludeReleaseNotes !== false,
      );
    } else {
      await sendNotification(
        first.repository,
        first.release,
        first.locale,
        first.settings,
        ["email"],
      );
    }
    return;
  }
  if (useDigest) {
    await sendAppriseDigest(
      items,
      first.locale,
      first.settings,
      getEffectiveAppriseProfile(first.repository, first.settings),
    );
  } else {
    await sendNotification(
      first.repository,
      first.release,
      first.locale,
      first.settings,
      ["apprise"],
    );
  }
}

export async function attemptPendingNotifications(
  repositories: Repository[],
  now = new Date(),
  limits: DeliveryLimits = {},
): Promise<{
  outcomes: NotificationDeliveryOutcome[];
  notificationsSent: number;
}> {
  const maxMessages = Math.min(
    Math.max(
      0,
      Math.round(
        limits.notificationMaxMessagesPerRun ??
          MAX_NOTIFICATION_DELIVERIES_PER_RUN,
      ),
    ),
    10_000,
  );
  const concurrency = Math.min(
    Math.max(
      1,
      Math.round(
        limits.notificationDeliveryConcurrency ??
          NOTIFICATION_DELIVERY_CONCURRENCY,
      ),
    ),
    50,
  );
  const allUnits = buildDeliveryWorkUnits(repositories, now.getTime());
  const units = maxMessages === 0 ? allUnits : allUnits.slice(0, maxMessages);
  const outcomes: NotificationDeliveryOutcome[] = [];
  let notificationsSent = 0;
  let nextUnitIndex = 0;

  async function worker() {
    while (nextUnitIndex < units.length) {
      const unit = units[nextUnitIndex++];
      let failure: unknown;
      try {
        await sendDeliveryWorkUnit(unit);
        notificationsSent++;
      } catch (error: unknown) {
        failure = error;
      }
      for (const member of unit.members) {
        if (failure === undefined) {
          outcomes.push({
            repositoryId: member.repositoryId,
            notificationId: member.notification.id,
            channel: unit.channel,
            previousAttempts: member.previousAttempts,
            status: "sent",
          });
          continue;
        }
        const attempts = member.previousAttempts + 1;
        const abandoned = attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS;
        const retryDelay = Math.min(
          INITIAL_RETRY_DELAY_MS * 2 ** Math.min(attempts - 1, 16),
          MAX_RETRY_DELAY_MS,
        );
        outcomes.push({
          repositoryId: member.repositoryId,
          notificationId: member.notification.id,
          channel: unit.channel,
          previousAttempts: member.previousAttempts,
          status: "failed",
          attempts,
          nextAttemptAt: abandoned
            ? undefined
            : new Date(now.getTime() + retryDelay).toISOString(),
          abandonedAt: abandoned ? now.toISOString() : undefined,
        });
      }
      if (failure !== undefined) {
        const message =
          failure instanceof Error
            ? failure.message
            : String(failure ?? "unknown");
        logger
          .withScope("Notifications")
          .error(
            `Notification delivery group '${unit.key}' failed: ${message}`,
            failure instanceof Error ? failure : undefined,
          );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, units.length) }, () => worker()),
  );
  return { outcomes, notificationsSent };
}

export function applyPendingNotificationDeliveryOutcomes(
  repositories: Repository[],
  outcomes: NotificationDeliveryOutcome[],
): { repositories: Repository[]; changed: boolean } {
  if (outcomes.length === 0) return { repositories, changed: false };
  const outcomeMap = new Map(
    outcomes.map((outcome) => [
      `${outcome.repositoryId}\u0000${outcome.notificationId}\u0000${outcome.channel}`,
      outcome,
    ]),
  );
  let changed = false;
  const updatedRepositories = repositories.map((repository) => {
    if (!repository.pendingNotifications?.length) return repository;
    let repositoryChanged = false;
    const remaining: PendingReleaseNotification[] = [];
    for (const notification of repository.pendingNotifications) {
      const states: Partial<Record<NotificationChannel, ChannelState>> = {};
      const channels: NotificationChannel[] = [];
      for (const channel of notification.channels) {
        const currentState = getChannelState(notification, channel);
        const outcome = outcomeMap.get(
          `${repository.id}\u0000${notification.id}\u0000${channel}`,
        );
        if (!outcome || outcome.previousAttempts !== currentState.attempts) {
          channels.push(channel);
          states[channel] = currentState;
          continue;
        }
        changed = true;
        repositoryChanged = true;
        if (outcome.status === "failed") {
          channels.push(channel);
          states[channel] = {
            attempts: outcome.attempts ?? currentState.attempts + 1,
            nextAttemptAt: outcome.nextAttemptAt,
            abandonedAt: outcome.abandonedAt,
          };
        }
      }
      if (channels.length === 0) continue;
      const stateValues = channels.flatMap((channel) => {
        const state = states[channel];
        return state ? [state] : [];
      });
      const activeNextAttempts = stateValues
        .filter((state) => !state.abandonedAt)
        .map((state) => state.nextAttemptAt)
        .filter((value): value is string => Boolean(value))
        .sort();
      const abandonedTimes = stateValues
        .map((state) => state.abandonedAt)
        .filter((value): value is string => Boolean(value))
        .sort();
      remaining.push({
        ...notification,
        channels,
        channelStates: states,
        attempts: Math.max(...stateValues.map((state) => state.attempts)),
        nextAttemptAt: activeNextAttempts[0],
        abandonedAt:
          abandonedTimes.length === stateValues.length
            ? abandonedTimes.at(-1)
            : undefined,
      });
    }
    if (!repositoryChanged) return repository;
    return {
      ...repository,
      pendingNotifications: remaining.length > 0 ? remaining : undefined,
    };
  });
  return { repositories: updatedRepositories, changed };
}

export async function deliverPendingNotifications(
  repositories: Repository[],
  now = new Date(),
  limits: DeliveryLimits = {},
): Promise<{
  repositories: Repository[];
  changed: boolean;
  notificationsSent: number;
}> {
  const initiallyPruned = pruneAbandonedNotifications(repositories, now);
  const delivery = await attemptPendingNotifications(
    initiallyPruned.repositories,
    now,
    limits,
  );
  const applied = applyPendingNotificationDeliveryOutcomes(
    initiallyPruned.repositories,
    delivery.outcomes,
  );
  const finallyPruned = pruneAbandonedNotifications(applied.repositories, now);
  return {
    repositories: finallyPruned.repositories,
    changed:
      initiallyPruned.changed || applied.changed || finallyPruned.changed,
    notificationsSent: delivery.notificationsSent,
  };
}
