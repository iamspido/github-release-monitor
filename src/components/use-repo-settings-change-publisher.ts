"use client";

import * as React from "react";
import { refreshSingleRepositoryAction } from "@/app/actions";
import { reloadIfServerActionStale } from "@/lib/server-action-error";

interface RepoSettingsChangePublisherOptions {
  isOpen: boolean;
  repoId: string;
  onRepositoryTagsChange?: (tags: string[]) => void;
  onPinnedChange?: (isPinned: boolean) => void;
  onDisplayNameChange?: (displayName: string | undefined) => void;
}

export function useRepoSettingsChangePublisher({
  isOpen,
  repoId,
  onRepositoryTagsChange,
  onPinnedChange,
  onDisplayNameChange,
}: RepoSettingsChangePublisherOptions) {
  const savedThisSessionRef = React.useRef(false);
  const filterSettingsChangedRef = React.useRef(false);
  const pendingRepositoryTagsChangeRef = React.useRef<string[] | null>(null);
  const pendingDisplayNameChangeRef = React.useRef<{
    displayName: string | undefined;
  } | null>(null);
  const pendingPinnedChangeRef = React.useRef<boolean | null>(null);
  const isOpenRef = React.useRef(isOpen);

  React.useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const publishRepositoryTagsChange = React.useCallback(
    (tags: string[]) => {
      pendingRepositoryTagsChangeRef.current = tags;
      if (isOpenRef.current) return;
      onRepositoryTagsChange?.(tags);
      pendingRepositoryTagsChangeRef.current = null;
    },
    [onRepositoryTagsChange],
  );

  const flushRepositoryTagsChange = React.useCallback(() => {
    const pendingTags = pendingRepositoryTagsChangeRef.current;
    if (!pendingTags) return;
    onRepositoryTagsChange?.(pendingTags);
    pendingRepositoryTagsChangeRef.current = null;
  }, [onRepositoryTagsChange]);

  const publishDisplayNameChange = React.useCallback(
    (displayName: string | undefined) => {
      pendingDisplayNameChangeRef.current = { displayName };
      if (isOpenRef.current) return;
      onDisplayNameChange?.(displayName);
      pendingDisplayNameChangeRef.current = null;
    },
    [onDisplayNameChange],
  );

  const flushDisplayNameChange = React.useCallback(() => {
    const pendingChange = pendingDisplayNameChangeRef.current;
    if (!pendingChange) return;
    onDisplayNameChange?.(pendingChange.displayName);
    pendingDisplayNameChangeRef.current = null;
  }, [onDisplayNameChange]);

  const publishPinnedChange = React.useCallback(
    (isPinned: boolean) => {
      pendingPinnedChangeRef.current = isPinned;
      if (isOpenRef.current) return;
      onPinnedChange?.(isPinned);
      pendingPinnedChangeRef.current = null;
    },
    [onPinnedChange],
  );

  const flushPinnedChange = React.useCallback(() => {
    const pendingIsPinned = pendingPinnedChangeRef.current;
    if (pendingIsPinned === null) return;
    onPinnedChange?.(pendingIsPinned);
    pendingPinnedChangeRef.current = null;
  }, [onPinnedChange]);

  const refreshAfterClosedSave = React.useCallback(() => {
    if (!savedThisSessionRef.current) return;
    const shouldRefresh = filterSettingsChangedRef.current;
    savedThisSessionRef.current = false;
    filterSettingsChangedRef.current = false;
    if (!shouldRefresh) return;

    refreshSingleRepositoryAction(repoId).catch((error: unknown) => {
      reloadIfServerActionStale(error);
    });
  }, [repoId]);

  return {
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
  };
}
