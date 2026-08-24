"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import {
  moveRepositoryTag,
  normalizeRepositoryTags,
  type RepositoryTagsValidationError,
} from "@/lib/repositories/tags";

interface RepositoryTagPointerDrag {
  pointerId: number;
  fromIndex: number;
  tag: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  hasMoved: boolean;
}

interface RepositoryTagDragPreview {
  tag: string;
  fromIndex: number;
  left: number;
  top: number;
}

interface RepositoryTagEditorOptions {
  availableRepositoryTags: string[];
  currentRepositoryTags: string[];
  isOnline: boolean;
  isRtl: boolean;
}

export function useRepositoryTagEditor({
  availableRepositoryTags,
  currentRepositoryTags,
  isOnline,
  isRtl,
}: RepositoryTagEditorOptions) {
  const t = useTranslations("RepoSettingsDialog");
  const [repositoryTags, setRepositoryTags] = React.useState<string[]>(
    currentRepositoryTags,
  );
  const [repositoryTagInput, setRepositoryTagInput] = React.useState("");
  const [repositoryTagError, setRepositoryTagError] =
    React.useState<RepositoryTagsValidationError | null>(null);
  const [draggedRepositoryTagIndex, setDraggedRepositoryTagIndex] =
    React.useState<number | null>(null);
  const [repositoryTagDropIndex, setRepositoryTagDropIndex] = React.useState<
    number | null
  >(null);
  const [repositoryTagDragSize, setRepositoryTagDragSize] = React.useState({
    width: 0,
    height: 0,
  });
  const [repositoryTagDragPreview, setRepositoryTagDragPreview] =
    React.useState<RepositoryTagDragPreview | null>(null);
  const [repositoryTagOrderAnnouncement, setRepositoryTagOrderAnnouncement] =
    React.useState("");
  const repositoryTagPointerDragRef =
    React.useRef<RepositoryTagPointerDrag | null>(null);
  const repositoryTagListRef = React.useRef<HTMLUListElement>(null);
  const repositoryTagDragPreviewRef = React.useRef<HTMLDivElement>(null);
  const finishRepositoryTagDrag = React.useCallback(() => {
    repositoryTagPointerDragRef.current = null;
    setDraggedRepositoryTagIndex(null);
    setRepositoryTagDropIndex(null);
    setRepositoryTagDragSize({ width: 0, height: 0 });
    setRepositoryTagDragPreview(null);
  }, []);

  const addRepositoryTags = (values: string[]) => {
    if (!isOnline) return false;
    const result = normalizeRepositoryTags([...repositoryTags, ...values]);
    if (!result.success) {
      setRepositoryTagError(result.error);
      return false;
    }

    setRepositoryTags(result.tags);
    setRepositoryTagError(null);
    return true;
  };

  const commitRepositoryTagInput = () => {
    if (!repositoryTagInput.trim()) return false;
    if (!addRepositoryTags([repositoryTagInput])) return false;
    setRepositoryTagInput("");
    return true;
  };

  const removeRepositoryTag = (tag: string) => {
    if (!isOnline) return;
    setRepositoryTags((current) => current.filter((entry) => entry !== tag));
    setRepositoryTagError(null);
  };

  const reorderRepositoryTag = (fromIndex: number, toIndex: number) => {
    if (!isOnline) return;

    const reorderedTags = moveRepositoryTag(repositoryTags, fromIndex, toIndex);
    if (reorderedTags === repositoryTags) return;

    const movedTag = repositoryTags[fromIndex];
    setRepositoryTags(reorderedTags);
    setRepositoryTagError(null);
    setRepositoryTagOrderAnnouncement(
      t("tags_reordered_announcement", {
        tag: movedTag,
        position: toIndex + 1,
        total: repositoryTags.length,
      }),
    );
  };

  const getRepositoryTagInsertionIndex = (
    list: HTMLUListElement,
    clientX: number,
    clientY: number,
  ) => {
    const tagElements = Array.from(
      list.querySelectorAll<HTMLElement>(
        '[data-repository-tag-index]:not([data-repository-tag-dragging="true"])',
      ),
    );
    if (tagElements.length === 0) return 0;

    const rows: Array<
      Array<{ index: number; bounds: DOMRect; centerY: number }>
    > = [];
    for (const element of tagElements) {
      const index = Number(element.dataset.repositoryTagIndex);
      const bounds = element.getBoundingClientRect();
      const centerY = bounds.top + bounds.height / 2;
      const currentRow = rows.at(-1);
      if (
        !currentRow ||
        Math.abs(centerY - currentRow[0].centerY) >
          Math.max(4, bounds.height / 2)
      ) {
        rows.push([{ index, bounds, centerY }]);
      } else {
        currentRow.push({ index, bounds, centerY });
      }
    }

    const closestRow = rows.reduce((closest, row) => {
      const closestDistance = Math.abs(clientY - closest[0].centerY);
      const rowDistance = Math.abs(clientY - row[0].centerY);
      return rowDistance < closestDistance ? row : closest;
    });

    for (const item of closestRow) {
      const isBeforeItemCenter = isRtl
        ? clientX > item.bounds.left + item.bounds.width / 2
        : clientX < item.bounds.left + item.bounds.width / 2;
      if (isBeforeItemCenter) {
        return item.index;
      }
    }
    return closestRow[closestRow.length - 1].index + 1;
  };

  const handleRepositoryTagPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    fromIndex: number,
    tag: string,
  ) => {
    if (
      !isOnline ||
      repositoryTags.length < 2 ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button")
    ) {
      return;
    }

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    repositoryTagPointerDragRef.current = {
      pointerId: event.pointerId,
      fromIndex,
      tag,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
      hasMoved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleRepositoryTagPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = repositoryTagPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    if (!drag.hasMoved && distance < 4) return;

    event.preventDefault();
    const left = event.clientX - drag.offsetX;
    const top = event.clientY - drag.offsetY;

    if (!drag.hasMoved) {
      drag.hasMoved = true;
      setDraggedRepositoryTagIndex(drag.fromIndex);
      setRepositoryTagDropIndex(drag.fromIndex);
      setRepositoryTagDragSize({ width: drag.width, height: drag.height });
      setRepositoryTagDragPreview({
        tag: drag.tag,
        fromIndex: drag.fromIndex,
        left,
        top,
      });
    } else if (repositoryTagDragPreviewRef.current) {
      repositoryTagDragPreviewRef.current.style.left = `${left}px`;
      repositoryTagDragPreviewRef.current.style.top = `${top}px`;
    }

    const tagList = repositoryTagListRef.current;
    if (tagList) {
      setRepositoryTagDropIndex(
        getRepositoryTagInsertionIndex(tagList, event.clientX, event.clientY),
      );
    }
  };

  const handleRepositoryTagPointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = repositoryTagPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.hasMoved && repositoryTagListRef.current) {
      const insertionIndex = getRepositoryTagInsertionIndex(
        repositoryTagListRef.current,
        event.clientX,
        event.clientY,
      );
      const toIndex =
        insertionIndex > drag.fromIndex ? insertionIndex - 1 : insertionIndex;
      reorderRepositoryTag(drag.fromIndex, toIndex);
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishRepositoryTagDrag();
  };

  const handleRepositoryTagPointerCancel = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = repositoryTagPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishRepositoryTagDrag();
  };

  const handleRepositoryTagLostPointerCapture = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = repositoryTagPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishRepositoryTagDrag();
  };

  const repositoryTagErrorMessage = repositoryTagError
    ? t(`tags_error_${repositoryTagError}`)
    : null;
  const repositoryTagSuggestions = availableRepositoryTags.filter(
    (tag) => !repositoryTags.includes(tag),
  );

  return {
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
  };
}
