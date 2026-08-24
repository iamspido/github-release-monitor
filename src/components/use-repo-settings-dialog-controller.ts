"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { updateRepositorySettingsAction } from "@/app/actions";
import { useRepoSettingsChangePublisher } from "@/components/use-repo-settings-change-publisher";
import {
  type RepositorySettingsSnapshot,
  type RepositorySettingsSource,
  useRepoSettingsDraft,
} from "@/components/use-repo-settings-draft";
import { useRepositoryTagEditor } from "@/components/use-repository-tag-editor";
import {
  type AutosaveTask,
  useAutosaveController,
} from "@/hooks/use-autosave-controller";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { getLocaleMetadata } from "@/i18n/config";
import { formatRepoIdForDisplay } from "@/lib/repo-id-display";
import { normalizeRepositoryTags } from "@/lib/repositories/tags";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import {
  areSettingsSnapshotsEqual,
  hasRefreshSensitiveRepoSettingChanges,
  hasSettingsSnapshotDrift,
} from "@/lib/settings/form-model";
import {
  shouldSelectAllPreReleaseSubChannels,
  togglePreReleaseSubChannel,
  toggleReleaseChannel,
} from "@/lib/settings/release-channel-fields";
import type {
  AppSettings,
  PreReleaseChannelType,
  ReleaseChannel,
} from "@/types";
import { allPreReleaseTypes } from "@/types";

const DEFERRED_REPOSITORY_SETTING_KEYS = new Set<
  keyof RepositorySettingsSnapshot
>([
  "displayName",
  "releasesPerPage",
  "refreshInterval",
  "cacheInterval",
  "backgroundCheckCron",
  "includeRegex",
  "excludeRegex",
  "versionTagPattern",
  "customPreReleaseMarkers",
  "appriseTags",
]);

export interface RepoSettingsDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  repoId: string;
  availableRepositoryTags?: string[];
  currentRepositoryTags?: string[];
  onRepositoryTagsChange?: (tags: string[]) => void;
  onPinnedChange?: (isPinned: boolean) => void;
  onDisplayNameChange?: (displayName: string | undefined) => void;
  currentRepoSettings?: RepositorySettingsSource;
  globalSettings: AppSettings;
  isAppriseConfigured?: boolean;
}

type RepoSettingsDialogControllerOptions = Omit<
  RepoSettingsDialogProps,
  "isAppriseConfigured"
>;

export function useRepoSettingsDialogController({
  isOpen,
  setIsOpen,
  repoId,
  availableRepositoryTags = [],
  currentRepositoryTags = [],
  onRepositoryTagsChange,
  onPinnedChange,
  onDisplayNameChange,
  currentRepoSettings,
  globalSettings,
}: RepoSettingsDialogControllerOptions) {
  const locale = useLocale();
  const isRtl = getLocaleMetadata(locale).direction === "rtl";
  const { isOnline } = useNetworkStatus();
  const t = useTranslations("RepoSettingsDialog");
  const { toast } = useToast();
  const displayRepoId = formatRepoIdForDisplay(repoId, {
    showProviderPrefix: globalSettings.showProviderPrefixInRepoId ?? true,
    showProviderDomain: globalSettings.showProviderDomainInRepoId ?? true,
  });

  const {
    addRepositoryTags,
    commitRepositoryTagInput,
    draggedRepositoryTagIndex,
    finishRepositoryTagDrag,
    handleRepositoryTagLostPointerCapture,
    handleRepositoryTagPointerCancel,
    handleRepositoryTagPointerDown,
    handleRepositoryTagPointerEnd,
    handleRepositoryTagPointerMove,
    removeRepositoryTag,
    reorderRepositoryTag,
    repositoryTagDragPreview,
    repositoryTagDragPreviewRef,
    repositoryTagDragSize,
    repositoryTagDropIndex,
    repositoryTagError,
    repositoryTagErrorMessage,
    repositoryTagInput,
    repositoryTagListRef,
    repositoryTagOrderAnnouncement,
    repositoryTagSuggestions,
    repositoryTags,
    setRepositoryTagError,
    setRepositoryTagInput,
    setRepositoryTagOrderAnnouncement,
    setRepositoryTags,
  } = useRepositoryTagEditor({
    availableRepositoryTags,
    currentRepositoryTags,
    isOnline,
    isRtl,
  });
  const draft = useRepoSettingsDraft({
    currentRepoSettings,
    globalSettings,
    repositoryTags,
  });
  const {
    appriseFormat,
    appriseTags,
    automationMode,
    cacheDays,
    cacheHours,
    cacheMinutes,
    channels,
    cronError,
    cronExpression,
    cronPreset,
    cronTime,
    cronWeekday,
    customPreReleaseMarkers,
    displayName,
    effectivePreReleaseSubChannels,
    effectiveReleaseSelectionStrategy,
    excludeRegex,
    excludeRegexError,
    hasDisplayNameError,
    hasEmptyCacheFields,
    hasEmptyIntervalFields,
    hydrate: hydrateDraft,
    ids: {
      appriseFormat: appriseFormatId,
      appriseTags: appriseTagsId,
      cacheDays: cacheDaysId,
      cacheHours: cacheHoursId,
      cacheMinutes: cacheMinutesId,
      cacheOverride: cacheOverrideId,
      cronExpression: cronExpressionId,
      cronHour: cronHourId,
      cronMinute: cronMinuteId,
      cronPeriod: cronPeriodId,
      cronPreset: cronPresetId,
      cronWeekday: cronWeekdayId,
      customPreReleaseMarkers: customPreReleaseMarkersId,
      displayName: displayNameId,
      draft: draftId,
      excludeRegex: excludeRegexId,
      includeRegex: includeRegexId,
      intervalDays: intervalDaysId,
      intervalHours: intervalHoursId,
      intervalMinutes: intervalMinutesId,
      isPinned: isPinnedId,
      prerelease: prereleaseId,
      prereleaseSubChannelBase: prereleaseSubChannelBaseId,
      refreshMode: refreshModeId,
      releaseSelectionStrategy: releaseSelectionStrategyId,
      releasesPerPage: releasesPerPageId,
      repositoryTags: repositoryTagsId,
      stable: stableId,
      useGlobalCustomPreReleaseMarkers: useGlobalCustomPreReleaseMarkersId,
      versionTagPattern: versionTagPatternId,
    },
    includeRegex,
    includeRegexError,
    intervalDays,
    intervalError,
    intervalHours,
    intervalMinutes,
    invalidCustomPreReleaseMarkers,
    isCacheInvalid,
    isDraftChecked,
    isPinned,
    isPreReleaseChecked,
    isStableChecked,
    isUsingAllGlobalSettings,
    newSettings,
    preReleaseSubChannels,
    releaseSelectionStrategy,
    releasesPerPage,
    releasesPerPageError,
    resetAutomation,
    setAppriseFormat,
    setAppriseTags,
    setAutomationMode,
    setCacheDays,
    setCacheHours,
    setCacheMinutes,
    setChannels,
    setCronExpression,
    setCronPreset,
    setCronTime,
    setCronWeekday,
    setCustomPreReleaseMarkers,
    setDisplayName,
    setExcludeRegex,
    setIncludeRegex,
    setIntervalDays,
    setIntervalHours,
    setIntervalMinutes,
    setIsPinned,
    setPreReleaseSubChannels,
    setReleaseSelectionStrategy,
    setReleasesPerPage,
    setUseCustomCache,
    setUseGlobalCustomPreReleaseMarkers,
    setVersionTagPattern,
    useCustomCache,
    useDefaultVersionTagPattern,
    useGlobalAppriseFormat,
    useGlobalAppriseTags,
    useGlobalChannels,
    useGlobalCustomPreReleaseMarkers,
    useGlobalReleaseSelection,
    useGlobalReleasesPerPage,
    useGlobalSubChannels,
    versionTagPattern,
    versionTagPatternError,
  } = draft;

  const {
    status: saveStatus,
    setStatus: setSaveStatus,
    hasPending: hasPendingAutosave,
    discardPending: discardPendingAutosave,
    schedule: scheduleAutosave,
    saveNow: saveAutosaveNow,
    flush: flushAutosave,
    pause: pauseAutosave,
    resume: resumeAutosave,
  } = useAutosaveController();
  const saveStatusRef = React.useRef(saveStatus);
  saveStatusRef.current = saveStatus;
  const hasPendingAutosaveRef = React.useRef(hasPendingAutosave);
  hasPendingAutosaveRef.current = hasPendingAutosave;
  const previousDraftSettingsRef = React.useRef<
    RepositorySettingsSnapshot | undefined
  >(undefined);
  const [immediateSaveRevision, requestImmediateSave] = React.useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const handledImmediateSaveRevisionRef = React.useRef(0);
  const skipOpenHydrationAutosaveRef = React.useRef(false);
  const [closeValidationBlocked, setCloseValidationBlocked] =
    React.useState(false);
  const {
    filterSettingsChangedRef,
    flushDisplayNameChange,
    flushPinnedChange,
    flushRepositoryTagsChange,
    isOpenRef,
    publishDisplayNameChange,
    publishPinnedChange,
    publishRepositoryTagsChange,
    refreshAfterClosedSave,
    savedThisSessionRef,
  } = useRepoSettingsChangePublisher({
    isOpen,
    repoId,
    onDisplayNameChange,
    onPinnedChange,
    onRepositoryTagsChange,
  });

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const prevIsOpenRef = React.useRef(isOpen);
  React.useEffect(() => {
    const wasOpen = prevIsOpenRef.current;

    if (wasOpen && !isOpen) {
      finishRepositoryTagDrag();
    }

    // transition: closed -> open
    if (!wasOpen && isOpen) {
      setCloseValidationBlocked(false);

      if (hasPendingAutosave) {
        prevIsOpenRef.current = isOpen;
        return;
      }

      const initialSettings: RepositorySettingsSnapshot = {
        displayName: currentRepoSettings?.displayName ?? undefined,
        isPinned: currentRepoSettings?.isPinned === true,
        tags: currentRepositoryTags,
        releaseChannels: currentRepoSettings?.releaseChannels ?? [],
        preReleaseSubChannels: currentRepoSettings?.preReleaseSubChannels,
        customPreReleaseMarkers: currentRepoSettings?.customPreReleaseMarkers,
        releaseSelectionStrategy: currentRepoSettings?.releaseSelectionStrategy,
        versionTagPattern: currentRepoSettings?.versionTagPattern,
        releasesPerPage: currentRepoSettings?.releasesPerPage ?? null,
        refreshInterval: currentRepoSettings?.refreshInterval ?? null,
        cacheInterval: currentRepoSettings?.cacheInterval ?? null,
        backgroundCheckCron:
          currentRepoSettings?.backgroundCheckCron ?? undefined,
        includeRegex: currentRepoSettings?.includeRegex ?? undefined,
        excludeRegex: currentRepoSettings?.excludeRegex ?? undefined,
        appriseTags: currentRepoSettings?.appriseTags ?? undefined,
        appriseFormat: currentRepoSettings?.appriseFormat ?? undefined,
      };

      skipOpenHydrationAutosaveRef.current = true;
      previousDraftSettingsRef.current = initialSettings;
      queuedSettingsRef.current = null;

      hydrateDraft(initialSettings);
      setRepositoryTags(initialSettings.tags ?? []);
      setRepositoryTagInput("");
      setRepositoryTagError(null);
      finishRepositoryTagDrag();
      setRepositoryTagOrderAnnouncement("");
      setSaveStatus("idle");

      savedThisSessionRef.current = false;
      filterSettingsChangedRef.current = false;

      prevSettingsRef.current = {
        ...initialSettings,
        releasesPerPage: initialSettings.releasesPerPage,
      };
      lastSubmittedSettingsRef.current = prevSettingsRef.current;
    }

    prevIsOpenRef.current = isOpen;
  }, [
    isOpen,
    currentRepoSettings,
    currentRepositoryTags,
    finishRepositoryTagDrag,
    filterSettingsChangedRef,
    hasPendingAutosave,
    hydrateDraft,
    setSaveStatus,
    setRepositoryTags,
    setRepositoryTagOrderAnnouncement,
    setRepositoryTagInput,
    setRepositoryTagError,
    savedThisSessionRef,
  ]);

  React.useEffect(() => {
    if (!isOpen) {
      flushRepositoryTagsChange();
      flushDisplayNameChange();
      flushPinnedChange();
      refreshAfterClosedSave();
    }
  }, [
    isOpen,
    flushRepositoryTagsChange,
    flushDisplayNameChange,
    flushPinnedChange,
    refreshAfterClosedSave,
  ]);

  const prevSettingsRef = React.useRef(newSettings);
  const lastSubmittedSettingsRef = React.useRef(newSettings);
  const queuedSettingsRef = React.useRef<RepositorySettingsSnapshot | null>(
    null,
  );

  const hasNonTagValidationErrors = Boolean(
    hasDisplayNameError ||
      hasEmptyIntervalFields ||
      hasEmptyCacheFields ||
      releasesPerPageError ||
      intervalError ||
      isCacheInvalid ||
      cronError ||
      includeRegexError ||
      excludeRegexError ||
      versionTagPatternError ||
      invalidCustomPreReleaseMarkers.length > 0,
  );
  const hasValidationErrors = Boolean(
    hasNonTagValidationErrors || repositoryTagError,
  );

  const createSaveTask = React.useCallback(
    (settingsSnapshot: RepositorySettingsSnapshot): AutosaveTask =>
      async () => {
        try {
          const previousSettings = prevSettingsRef.current;
          if (
            queuedSettingsRef.current &&
            areSettingsSnapshotsEqual(
              queuedSettingsRef.current,
              settingsSnapshot,
            )
          ) {
            queuedSettingsRef.current = null;
          }
          lastSubmittedSettingsRef.current = settingsSnapshot;
          const result = await updateRepositorySettingsAction(repoId, {
            ...settingsSnapshot,
            // `undefined` properties are omitted while serializing Server
            // Action arguments. Use an empty string so clearing a custom
            // display name remains distinguishable from a partial update.
            displayName: settingsSnapshot.displayName ?? "",
          });

          if (!result.success) {
            if (mountedRef.current) {
              toast({
                title: t("toast_error_title"),
                description: result.error,
                variant: "destructive",
              });
            }
            return false;
          }

          if (
            hasRefreshSensitiveRepoSettingChanges(
              previousSettings,
              settingsSnapshot,
            )
          ) {
            filterSettingsChangedRef.current = true;
          }

          prevSettingsRef.current = settingsSnapshot;
          lastSubmittedSettingsRef.current = settingsSnapshot;
          savedThisSessionRef.current = true;
          publishRepositoryTagsChange(settingsSnapshot.tags ?? []);
          publishDisplayNameChange(settingsSnapshot.displayName);
          publishPinnedChange(settingsSnapshot.isPinned === true);
          if (!isOpenRef.current) refreshAfterClosedSave();
          return true;
        } catch (error: unknown) {
          if (reloadIfServerActionStale(error)) return true;
          if (mountedRef.current) {
            toast({
              title: t("toast_error_title"),
              description: String(error),
              variant: "destructive",
            });
          }
          return false;
        }
      },
    [
      filterSettingsChangedRef,
      isOpenRef,
      publishDisplayNameChange,
      publishPinnedChange,
      publishRepositoryTagsChange,
      refreshAfterClosedSave,
      repoId,
      savedThisSessionRef,
      t,
      toast,
    ],
  );

  React.useEffect(() => {
    if (!isOnline) {
      pauseAutosave();
      return;
    }
    resumeAutosave();
  }, [isOnline, pauseAutosave, resumeAutosave]);

  React.useEffect(() => {
    if (saveStatus === "success" && hasValidationErrors) {
      setSaveStatus("idle");
    }
  }, [hasValidationErrors, saveStatus, setSaveStatus]);

  React.useEffect(() => {
    if (skipOpenHydrationAutosaveRef.current) {
      skipOpenHydrationAutosaveRef.current = false;
      return;
    }

    const previousDraftSettings = previousDraftSettingsRef.current;
    previousDraftSettingsRef.current = newSettings;
    const saveImmediatelyRequested =
      handledImmediateSaveRevisionRef.current !== immediateSaveRevision;
    handledImmediateSaveRevisionRef.current = immediateSaveRevision;
    if (!isOpen) return;

    if (!hasValidationErrors) setCloseValidationBlocked(false);

    const changedKeys = previousDraftSettings
      ? (
          Object.keys(newSettings) as Array<keyof RepositorySettingsSnapshot>
        ).filter(
          (key) =>
            !areSettingsSnapshotsEqual(
              previousDraftSettings[key],
              newSettings[key],
            ),
        )
      : [];

    const hasSettingsDrift = hasSettingsSnapshotDrift(
      prevSettingsRef.current,
      lastSubmittedSettingsRef.current,
      newSettings,
    );
    if (!hasSettingsDrift) {
      if (
        queuedSettingsRef.current &&
        !areSettingsSnapshotsEqual(queuedSettingsRef.current, newSettings)
      ) {
        queuedSettingsRef.current = null;
        discardPendingAutosave("idle");
      }
      return;
    }

    if (hasValidationErrors) {
      queuedSettingsRef.current = null;
      discardPendingAutosave("idle");
      return;
    }

    if (hasPendingAutosaveRef.current) {
      const matchesSubmittedSnapshot = areSettingsSnapshotsEqual(
        lastSubmittedSettingsRef.current,
        newSettings,
      );
      const matchesQueuedSnapshot = areSettingsSnapshotsEqual(
        queuedSettingsRef.current,
        newSettings,
      );
      const shouldRetryFailedSnapshot =
        saveStatusRef.current === "error" && changedKeys.length > 0;

      if (matchesQueuedSnapshot && !shouldRetryFailedSnapshot) return;
      if (matchesSubmittedSnapshot && !shouldRetryFailedSnapshot) {
        if (queuedSettingsRef.current) {
          queuedSettingsRef.current = null;
          discardPendingAutosave("idle");
        }
        return;
      }
    }

    const saveImmediately =
      saveImmediatelyRequested ||
      (changedKeys.length > 0 &&
        changedKeys.every((key) => !DEFERRED_REPOSITORY_SETTING_KEYS.has(key)));
    setCloseValidationBlocked(false);
    const task = createSaveTask(newSettings);
    queuedSettingsRef.current = newSettings;
    if (saveImmediately) saveAutosaveNow(task);
    else scheduleAutosave(task);
  }, [
    discardPendingAutosave,
    createSaveTask,
    hasValidationErrors,
    immediateSaveRevision,
    isOpen,
    newSettings,
    saveAutosaveNow,
    scheduleAutosave,
  ]);

  const handleChannelChange = (channel: ReleaseChannel) => {
    if (!isOnline) return;
    const baseChannels = useGlobalChannels
      ? globalSettings.releaseChannels
      : channels;

    const newChannels = toggleReleaseChannel(baseChannels, channel);

    if (newChannels.length === 0) {
      toast({
        title: t("toast_error_title"),
        description: t("release_channel_error_at_least_one"),
        variant: "destructive",
      });
      return;
    }

    setChannels(newChannels);

    if (
      useGlobalChannels &&
      useGlobalSubChannels &&
      shouldSelectAllPreReleaseSubChannels(channel, newChannels)
    ) {
      setPreReleaseSubChannels(
        globalSettings.preReleaseSubChannels || allPreReleaseTypes,
      );
    }
  };

  const handlePreReleaseSubChannelChange = (
    subChannel: PreReleaseChannelType,
  ) => {
    if (!isOnline) return;
    const baseSubChannels = useGlobalSubChannels
      ? globalSettings.preReleaseSubChannels || allPreReleaseTypes
      : preReleaseSubChannels || [];

    const newSubChannels = togglePreReleaseSubChannel(
      baseSubChannels,
      subChannel,
    );
    setPreReleaseSubChannels(newSubChannels);
  };

  const handleSelectAllPreRelease = () => {
    if (!isOnline) return;
    setPreReleaseSubChannels(allPreReleaseTypes);
  };

  const handleDeselectAllPreRelease = () => {
    if (!isOnline) return;
    setPreReleaseSubChannels([]);
  };

  const focusFirstValidationError = (
    hasTagError = Boolean(repositoryTagError),
  ) => {
    const firstEmptyIntervalId =
      intervalMinutes === ""
        ? intervalMinutesId
        : intervalHours === ""
          ? intervalHoursId
          : intervalDays === ""
            ? intervalDaysId
            : null;
    const firstEmptyCacheId =
      cacheMinutes === ""
        ? cacheMinutesId
        : cacheHours === ""
          ? cacheHoursId
          : cacheDays === ""
            ? cacheDaysId
            : null;
    const targetId = hasDisplayNameError
      ? displayNameId
      : hasTagError
        ? repositoryTagsId
        : hasEmptyIntervalFields
          ? firstEmptyIntervalId
          : hasEmptyCacheFields
            ? firstEmptyCacheId
            : releasesPerPageError
              ? releasesPerPageId
              : intervalError
                ? intervalMinutesId
                : isCacheInvalid
                  ? cacheMinutesId
                  : cronError
                    ? cronPreset === "custom"
                      ? cronExpressionId
                      : cronHourId
                    : includeRegexError
                      ? includeRegexId
                      : excludeRegexError
                        ? excludeRegexId
                        : invalidCustomPreReleaseMarkers.length > 0
                          ? customPreReleaseMarkersId
                          : versionTagPatternError
                            ? versionTagPatternId
                            : null;
    if (!targetId) return;
    window.requestAnimationFrame(() =>
      document.getElementById(targetId)?.focus(),
    );
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      isOpenRef.current = true;
      setIsOpen(true);
      return;
    }

    let settingsSnapshot = newSettings;
    if (repositoryTagInput.trim()) {
      const tagResult = normalizeRepositoryTags([
        ...repositoryTags,
        repositoryTagInput,
      ]);
      if (!tagResult.success) {
        setRepositoryTagError(tagResult.error);
        setCloseValidationBlocked(true);
        focusFirstValidationError(true);
        return;
      }

      settingsSnapshot = { ...newSettings, tags: tagResult.tags };
      setRepositoryTags(tagResult.tags);
      setRepositoryTagInput("");
      setRepositoryTagError(null);
    } else if (repositoryTagError) {
      setCloseValidationBlocked(true);
      focusFirstValidationError(true);
      return;
    }

    const hasUnsavedChanges = hasSettingsSnapshotDrift(
      prevSettingsRef.current,
      lastSubmittedSettingsRef.current,
      settingsSnapshot,
    );
    if (hasNonTagValidationErrors) {
      setCloseValidationBlocked(true);
      focusFirstValidationError(false);
      return;
    }

    if (
      queuedSettingsRef.current &&
      !areSettingsSnapshotsEqual(queuedSettingsRef.current, settingsSnapshot)
    ) {
      queuedSettingsRef.current = null;
      discardPendingAutosave("idle");
    }

    isOpenRef.current = false;
    if (
      hasUnsavedChanges &&
      (!hasPendingAutosave ||
        (!areSettingsSnapshotsEqual(
          lastSubmittedSettingsRef.current,
          settingsSnapshot,
        ) &&
          !areSettingsSnapshotsEqual(
            queuedSettingsRef.current,
            settingsSnapshot,
          )))
    ) {
      queuedSettingsRef.current = settingsSnapshot;
      saveAutosaveNow(createSaveTask(settingsSnapshot));
    } else {
      flushAutosave();
    }
    setIsOpen(false);
  };

  const handleAutosaveBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (
      !hasValidationErrors &&
      (event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement) &&
      event.target.getAttribute("role") !== "combobox"
    ) {
      flushAutosave();
    }
  };

  const handleAutosaveKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (
      !hasValidationErrors &&
      !event.defaultPrevented &&
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement
    ) {
      flushAutosave();
    }
  };

  const handleResetAll = () => {
    if (!isOnline) return;
    requestImmediateSave();
    setDisplayName("");
    setIsPinned(false);
    setChannels([]);
    setPreReleaseSubChannels(undefined);
    setCustomPreReleaseMarkers("");
    setUseGlobalCustomPreReleaseMarkers(true);
    setReleaseSelectionStrategy(undefined);
    setVersionTagPattern("");
    setReleasesPerPage("");
    resetAutomation();
    setIncludeRegex("");
    setExcludeRegex("");
    setAppriseTags("");
    setAppriseFormat("");
  };

  const handleResetFilters = () => {
    if (!isOnline) return;
    requestImmediateSave();
    setChannels([]);
    setPreReleaseSubChannels(undefined);
    setCustomPreReleaseMarkers("");
    setUseGlobalCustomPreReleaseMarkers(true);
    setIncludeRegex("");
    setExcludeRegex("");
  };

  const handleResetAutomation = () => {
    if (!isOnline) return;
    requestImmediateSave();
    resetAutomation();
  };

  return {
    addRepositoryTags,
    appriseFormat,
    appriseFormatId,
    appriseTags,
    appriseTagsId,
    automationMode,
    cacheDays,
    cacheDaysId,
    cacheHours,
    cacheHoursId,
    cacheMinutes,
    cacheMinutesId,
    cacheOverrideId,
    closeValidationBlocked,
    commitRepositoryTagInput,
    cronError,
    cronExpression,
    cronExpressionId,
    cronHourId,
    cronMinuteId,
    cronPeriodId,
    cronPreset,
    cronPresetId,
    cronTime,
    cronWeekday,
    cronWeekdayId,
    customPreReleaseMarkers,
    customPreReleaseMarkersId,
    displayName,
    displayNameId,
    displayRepoId,
    draftId,
    draggedRepositoryTagIndex,
    effectivePreReleaseSubChannels,
    effectiveReleaseSelectionStrategy,
    excludeRegex,
    excludeRegexError,
    excludeRegexId,
    handleAutosaveBlur,
    handleAutosaveKeyDown,
    handleChannelChange,
    handleDeselectAllPreRelease,
    handleOpenChange,
    handlePreReleaseSubChannelChange,
    handleRepositoryTagLostPointerCapture,
    handleRepositoryTagPointerCancel,
    handleRepositoryTagPointerDown,
    handleRepositoryTagPointerEnd,
    handleRepositoryTagPointerMove,
    handleResetAll,
    handleResetAutomation,
    handleResetFilters,
    handleSelectAllPreRelease,
    hasDisplayNameError,
    includeRegex,
    includeRegexError,
    includeRegexId,
    intervalDays,
    intervalDaysId,
    intervalError,
    intervalHours,
    intervalHoursId,
    intervalMinutes,
    intervalMinutesId,
    invalidCustomPreReleaseMarkers,
    isCacheInvalid,
    isDraftChecked,
    isOnline,
    isPinned,
    isPinnedId,
    isPreReleaseChecked,
    isRtl,
    isStableChecked,
    isUsingAllGlobalSettings,
    prereleaseId,
    prereleaseSubChannelBaseId,
    refreshModeId,
    releaseSelectionStrategy,
    releaseSelectionStrategyId,
    releasesPerPage,
    releasesPerPageError,
    releasesPerPageId,
    removeRepositoryTag,
    reorderRepositoryTag,
    repositoryTagDragPreview,
    repositoryTagDragPreviewRef,
    repositoryTagDragSize,
    repositoryTagDropIndex,
    repositoryTagErrorMessage,
    repositoryTagInput,
    repositoryTagListRef,
    repositoryTagOrderAnnouncement,
    repositoryTagSuggestions,
    repositoryTags,
    repositoryTagsId,
    requestImmediateSave,
    saveStatus,
    setAppriseFormat,
    setAppriseTags,
    setAutomationMode,
    setCacheDays,
    setCacheHours,
    setCacheMinutes,
    setCronExpression,
    setCronPreset,
    setCronTime,
    setCronWeekday,
    setCustomPreReleaseMarkers,
    setDisplayName,
    setExcludeRegex,
    setIncludeRegex,
    setIntervalDays,
    setIntervalHours,
    setIntervalMinutes,
    setIsPinned,
    setReleaseSelectionStrategy,
    setReleasesPerPage,
    setRepositoryTagError,
    setRepositoryTagInput,
    setUseCustomCache,
    setUseGlobalCustomPreReleaseMarkers,
    setVersionTagPattern,
    stableId,
    useCustomCache,
    useDefaultVersionTagPattern,
    useGlobalAppriseFormat,
    useGlobalAppriseTags,
    useGlobalChannels,
    useGlobalCustomPreReleaseMarkers,
    useGlobalCustomPreReleaseMarkersId,
    useGlobalReleaseSelection,
    useGlobalReleasesPerPage,
    versionTagPattern,
    versionTagPatternError,
    versionTagPatternId,
  };
}

export type RepoSettingsDialogController = ReturnType<
  typeof useRepoSettingsDialogController
>;
