"use client";

import { useTranslations } from "next-intl";
import * as React from "react";

import {
  importRepositoriesAction,
  previewComposeImportAction,
  resolveRepoProvidersBatchAction,
} from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import type { Repository } from "@/types";
import {
  getProviderResolutionBatches,
  getRepositoryImportStats,
  isComposeFileName,
  isHttpUrl,
  isOwnerRepoShorthand,
  type ProviderChoiceCandidate,
  parseRepositoryImportJson,
  type RepositoryImportStats,
  readTextFile,
  sortProviderChoiceCandidates,
} from "./repository-form-helpers";

type ProviderResolution = {
  input: string;
  candidates: ProviderChoiceCandidate[];
};

type PendingProviderChoice = {
  lines: string[];
  nextIndex: number;
  resolvedLines: string[];
  resolutions: ProviderResolution[];
};

export function useRepositoryProviderWorkflow(
  formAction: (payload: FormData) => void,
  hasProcessedResult: { current: boolean },
  selectedTags: readonly string[],
) {
  const t = useTranslations("RepositoryForm");
  const { toast } = useToast();
  const [isResolving, startTransition] = React.useTransition();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogRepo, setDialogRepo] = React.useState<string | null>(null);
  const [dialogCandidates, setDialogCandidates] = React.useState<
    ProviderChoiceCandidate[]
  >([]);
  const [pendingChoice, setPendingChoice] =
    React.useState<PendingProviderChoice | null>(null);

  const clearDialog = React.useCallback(() => {
    setDialogRepo(null);
    setDialogCandidates([]);
    setPendingChoice(null);
  }, []);

  const submitResolvedLines = React.useCallback(
    (lines: string[]) => {
      const formData = new FormData();
      formData.set("urls", lines.join("\n"));
      for (const tag of selectedTags) formData.append("tags", tag);
      formAction(formData);
    },
    [formAction, selectedTags],
  );

  const processResolvedLines = React.useCallback(
    (
      lines: string[],
      resolutions: ProviderResolution[],
      startIndex = 0,
      seedResolved: string[] = [],
    ) => {
      const resolved = [...seedResolved];
      const resolutionsByInput = new Map(
        resolutions.map((resolution) => [resolution.input, resolution]),
      );

      for (let index = startIndex; index < lines.length; index += 1) {
        const raw = lines[index]?.trim() ?? "";
        if (!raw) continue;

        if (isHttpUrl(raw) || !isOwnerRepoShorthand(raw)) {
          resolved.push(raw);
          continue;
        }

        const candidates = resolutionsByInput.get(raw)?.candidates ?? [];
        if (candidates.length === 1) {
          resolved.push(candidates[0].canonicalRepoUrl);
          continue;
        }

        if (candidates.length > 1) {
          setDialogRepo(raw);
          setDialogCandidates(candidates);
          setPendingChoice({
            lines,
            nextIndex: index + 1,
            resolvedLines: resolved,
            resolutions,
          });
          setDialogOpen(true);
          return;
        }

        // Preserve unresolved shorthand so the server action reports it as invalid.
        resolved.push(raw);
      }

      submitResolvedLines(resolved);
    },
    [submitResolvedLines],
  );

  const resolveLinesAndSubmit = React.useCallback(
    async (lines: string[]) => {
      const resolutions: ProviderResolution[] = [];

      try {
        for (const batch of getProviderResolutionBatches(lines)) {
          const result = await resolveRepoProvidersBatchAction(batch);
          resolutions.push(
            ...result.resolutions.map((resolution) => ({
              input: resolution.input,
              candidates: resolution.candidates.map((candidate) => ({
                provider: candidate.provider,
                providerHost: candidate.providerHost,
                providerBaseUrl: candidate.providerBaseUrl,
                canonicalRepoUrl: candidate.canonicalRepoUrl,
              })),
            })),
          );
          if (!result.success) break;
        }

        processResolvedLines(lines, resolutions);
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) return;
        toast({
          title: t("toast_fail_title"),
          description: t("toast_generic_error"),
          variant: "destructive",
        });
      }
    },
    [processResolvedLines, t, toast],
  );

  const submit = React.useCallback(
    (lines: string[]) => {
      hasProcessedResult.current = false;
      startTransition(async () => {
        await resolveLinesAndSubmit(lines);
      });
    },
    [hasProcessedResult, resolveLinesAndSubmit],
  );

  const chooseProvider = React.useCallback(
    (candidateUrl: string) => {
      if (!pendingChoice) return;

      setDialogOpen(false);
      clearDialog();
      hasProcessedResult.current = false;
      startTransition(() => {
        processResolvedLines(
          pendingChoice.lines,
          pendingChoice.resolutions,
          pendingChoice.nextIndex,
          [...pendingChoice.resolvedLines, candidateUrl],
        );
      });
    },
    [clearDialog, hasProcessedResult, pendingChoice, processResolvedLines],
  );

  const setOpen = React.useCallback(
    (open: boolean) => {
      setDialogOpen(open);
      if (!open) clearDialog();
    },
    [clearDialog],
  );
  const orderedDialogCandidates = React.useMemo(
    () => sortProviderChoiceCandidates(dialogCandidates),
    [dialogCandidates],
  );

  return {
    chooseProvider,
    dialogCandidates: orderedDialogCandidates,
    dialogOpen,
    dialogRepo,
    isResolving,
    setOpen,
    submit,
  };
}

export function useRepositoryImportWorkflow({
  currentRepositories,
  onJobStarted,
  onImportSuccess,
  selectedTags,
}: {
  currentRepositories: Repository[];
  onJobStarted: (jobId: string) => void;
  onImportSuccess: () => void;
  selectedTags: readonly string[];
}) {
  const t = useTranslations("RepositoryForm");
  const { toast } = useToast();
  const [isImporting, startImportTransition] = React.useTransition();
  const [dialogVisible, setDialogVisible] = React.useState(false);
  const [repositories, setRepositories] = React.useState<Repository[] | null>(
    null,
  );
  const [stats, setStats] = React.useState<RepositoryImportStats | null>(null);
  const [fileInputKey, setFileInputKey] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const currentRepositoryIds = React.useMemo(
    () => new Set(currentRepositories.map((repo) => repo.id)),
    [currentRepositories],
  );

  const preparePreview = React.useCallback(
    (importedData: Repository[], skippedImages?: number) => {
      setRepositories(importedData);
      setStats(
        getRepositoryImportStats(
          importedData,
          currentRepositoryIds,
          skippedImages,
        ),
      );
      setDialogVisible(true);
    },
    [currentRepositoryIds],
  );

  const selectFile = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const content = await readTextFile(file);

        if (isComposeFileName(file.name)) {
          startImportTransition(async () => {
            try {
              const result = await previewComposeImportAction(
                file.name,
                content,
              );
              if (!result.success) {
                toast({
                  title: t("toast_import_error_title"),
                  description:
                    result.error ?? t("toast_import_error_description"),
                  variant: "destructive",
                });
                return;
              }

              const skippedImages = Object.values(result.skipped).reduce(
                (sum, count) => sum + count,
                0,
              );
              if (result.repositories.length === 0 && skippedImages === 0) {
                toast({
                  title: t("toast_import_error_title"),
                  description: t("toast_import_error_no_compose_images"),
                  variant: "destructive",
                });
                return;
              }

              preparePreview(result.repositories, skippedImages);
            } catch (error: unknown) {
              if (reloadIfServerActionStale(error)) return;
              toast({
                title: t("toast_import_error_title"),
                description: t("toast_import_error_description"),
                variant: "destructive",
              });
            }
          });
          return;
        }

        preparePreview(parseRepositoryImportJson(content));
      } catch (error: unknown) {
        const description =
          error instanceof Error && error.message === "invalid_format"
            ? t("toast_import_error_invalid_format")
            : error instanceof Error && error.message === "file_read_failed"
              ? t("toast_import_error_reading")
              : t("toast_import_error_parsing");
        toast({
          title: t("toast_import_error_title"),
          description,
          variant: "destructive",
        });
      } finally {
        setFileInputKey((currentKey) => currentKey + 1);
      }
    },
    [preparePreview, t, toast],
  );

  const confirmImport = React.useCallback(() => {
    if (!repositories) return;

    startImportTransition(async () => {
      let importSucceeded = false;
      try {
        const result = await importRepositoriesAction(
          repositories,
          selectedTags,
        );
        toast({
          title: result.success
            ? t("toast_import_success_title")
            : t("toast_import_error_title"),
          description: result.message,
          ...(result.success ? {} : { variant: "destructive" as const }),
        });
        if (result.success) {
          importSucceeded = true;
          onImportSuccess();
          if (result.jobId) onJobStarted(result.jobId);
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) return;
        toast({
          title: t("toast_import_error_title"),
          description: t("toast_import_error_description"),
          variant: "destructive",
        });
      } finally {
        if (importSucceeded) {
          setDialogVisible(false);
          setRepositories(null);
          setStats(null);
        }
      }
    });
  }, [onImportSuccess, onJobStarted, repositories, selectedTags, t, toast]);

  return {
    confirmImport,
    currentRepositoryIds,
    dialogVisible,
    fileInputKey,
    fileInputRef,
    handleFileChange,
    isImporting,
    repositories,
    selectFile,
    setDialogVisible,
    stats,
  };
}
