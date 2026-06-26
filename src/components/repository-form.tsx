"use client";

import { ChevronDown, Loader2, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useActionState } from "react";

import {
  addRepositoriesAction,
  importRepositoriesAction,
  previewComposeImportAction,
  resolveRepoProvidersAction,
} from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useJobPolling } from "@/hooks/use-job-polling";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import { cn } from "@/lib/utils";
import type { Repository } from "@/types";
import {
  getRepositoryDisplayName,
  getRepositoryImportStats,
  getRepositoryProviderName,
  initialRepositoryFormState,
  isComposeFileName,
  isHttpUrl,
  isOwnerRepoShorthand,
  type ProviderChoiceCandidate,
  parseRepositoryImportJson,
  type RepositoryImportStats,
  readTextFile,
  sortProviderChoiceCandidates,
} from "./repository-form-helpers";

function SubmitButton({
  isDisabled,
  isPending,
}: {
  isDisabled: boolean;
  isPending: boolean;
}) {
  const t = useTranslations("RepositoryForm");

  return (
    <Button
      type="submit"
      className="w-full sm:w-auto"
      disabled={isPending || isDisabled}
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Plus className="mr-2 h-4 w-4" />
      )}
      {t("button_add")}
    </Button>
  );
}

interface RepositoryFormProps {
  currentRepositories: Repository[];
  isExpanded: boolean;
  isExpansionSaving: boolean;
  onToggleExpanded: () => void;
}

export function RepositoryForm({
  currentRepositories,
  isExpanded,
  isExpansionSaving,
  onToggleExpanded,
}: RepositoryFormProps) {
  const t = useTranslations("RepositoryForm");
  const contentId = React.useId();
  const [urls, setUrls] = React.useState("");
  const { toast } = useToast();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();

  const [state, formAction, isPending] = useActionState(
    addRepositoriesAction,
    initialRepositoryFormState,
  );
  const [jobId, setJobId] = React.useState<string | undefined>(undefined);
  const hasProcessedResult = React.useRef(true);
  const [isResolvingProviders, startProviderResolveTransition] =
    React.useTransition();
  const [providerDialogOpen, setProviderDialogOpen] = React.useState(false);
  const [providerDialogRepo, setProviderDialogRepo] = React.useState<
    string | null
  >(null);
  const [providerDialogCandidates, setProviderDialogCandidates] =
    React.useState<ProviderChoiceCandidate[]>([]);
  const [providerDialogPendingState, setProviderDialogPendingState] =
    React.useState<{
      lines: string[];
      nextIndex: number;
      resolvedLines: string[];
    } | null>(null);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [isImporting, startImportTransition] = React.useTransition();
  const [isDialogVisible, setIsDialogVisible] = React.useState(false);
  const [reposToImport, setReposToImport] = React.useState<Repository[] | null>(
    null,
  );
  const [importStats, setImportStats] =
    React.useState<RepositoryImportStats | null>(null);
  const [fileInputKey, setFileInputKey] = React.useState(Date.now());
  const currentRepositoryIds = React.useMemo(
    () => new Set(currentRepositories.map((repo) => repo.id)),
    [currentRepositories],
  );

  React.useEffect(() => {
    if (isPending) {
      hasProcessedResult.current = false;
    }
  }, [isPending]);

  React.useEffect(() => {
    if (state.error) {
      toast({
        title: t("toast_fail_title"),
        description: state.error,
        variant: "destructive",
      });
      hasProcessedResult.current = true;
    }
    if (state.toast && !hasProcessedResult.current) {
      toast({
        title: state.toast.title,
        description: state.toast.description,
      });
    }
    if (state.success && !hasProcessedResult.current) {
      hasProcessedResult.current = true;
      setUrls("");
      if (state.jobId) {
        setJobId(state.jobId);
      }
    }
  }, [state, t, toast]);

  const handleJobComplete = React.useCallback(() => {
    toast({
      title: t("toast_refresh_success_title"),
      description: t("toast_refresh_success_description"),
    });
    router.refresh();
  }, [router, t, toast]);

  const handleJobError = React.useCallback(() => {
    toast({
      title: t("toast_refresh_error_title"),
      description: t("toast_refresh_error_description"),
      variant: "destructive",
    });
  }, [t, toast]);

  const handleJobTimeout = React.useCallback(() => {
    toast({
      title: t("toast_refresh_timeout_title"),
      description: t("toast_refresh_timeout_description"),
      variant: "destructive",
    });
  }, [t, toast]);

  const handleJobDone = React.useCallback(() => {
    setJobId(undefined);
  }, []);

  useJobPolling({
    jobId,
    onComplete: handleJobComplete,
    onError: handleJobError,
    onTimeout: handleJobTimeout,
    onDone: handleJobDone,
  });

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;

    if (!urls) {
      textarea.scrollTop = 0;
    }
  }, [urls]);

  const submitResolvedLines = React.useCallback(
    (lines: string[]) => {
      const fd = new FormData();
      fd.set("urls", lines.join("\n"));
      formAction(fd);
    },
    [formAction],
  );

  const resolveLinesAndSubmit = React.useCallback(
    async (lines: string[], startIndex = 0, seedResolved: string[] = []) => {
      const resolved: string[] = [...seedResolved];

      for (let i = startIndex; i < lines.length; i += 1) {
        const raw = lines[i]?.trim() ?? "";
        if (!raw) continue;

        if (isHttpUrl(raw)) {
          resolved.push(raw);
          continue;
        }

        if (!isOwnerRepoShorthand(raw)) {
          resolved.push(raw);
          continue;
        }

        const result = await resolveRepoProvidersAction(raw);
        const candidates = result.candidates.map((c) => ({
          provider: c.provider,
          providerHost: c.providerHost,
          canonicalRepoUrl: c.canonicalRepoUrl,
        }));

        if (candidates.length === 1) {
          resolved.push(candidates[0].canonicalRepoUrl);
          continue;
        }

        if (candidates.length > 1) {
          setProviderDialogRepo(raw);
          setProviderDialogCandidates(candidates);
          setProviderDialogPendingState({
            lines,
            nextIndex: i + 1,
            resolvedLines: resolved,
          });
          setProviderDialogOpen(true);
          return;
        }

        // No matching provider found: keep the shorthand so the server action can report it as invalid.
        resolved.push(raw);
      }

      submitResolvedLines(resolved);
    },
    [submitResolvedLines],
  );

  const handleChooseProvider = (candidateUrl: string) => {
    const pending = providerDialogPendingState;
    if (!pending) return;

    setProviderDialogOpen(false);
    setProviderDialogRepo(null);
    setProviderDialogCandidates([]);
    setProviderDialogPendingState(null);

    hasProcessedResult.current = false;
    startProviderResolveTransition(async () => {
      await resolveLinesAndSubmit(pending.lines, pending.nextIndex, [
        ...pending.resolvedLines,
        candidateUrl,
      ]);
    });
  };

  const orderedProviderCandidates = React.useMemo(() => {
    return sortProviderChoiceCandidates(providerDialogCandidates);
  }, [providerDialogCandidates]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const prepareImportPreview = React.useCallback(
    (importedData: Repository[], skippedImages?: number) => {
      setReposToImport(importedData);
      setImportStats(
        getRepositoryImportStats(
          importedData,
          currentRepositoryIds,
          skippedImages,
        ),
      );
      setIsDialogVisible(true);
    },
    [currentRepositoryIds],
  );

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await readTextFile(file);

      if (isComposeFileName(file.name)) {
        startImportTransition(async () => {
          try {
            const result = await previewComposeImportAction(file.name, content);
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

            prepareImportPreview(result.repositories, skippedImages);
          } catch (error: unknown) {
            if (reloadIfServerActionStale(error)) {
              return;
            }
            toast({
              title: t("toast_import_error_title"),
              description: t("toast_import_error_description"),
              variant: "destructive",
            });
          }
        });
        return;
      }

      prepareImportPreview(parseRepositoryImportJson(content));
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
      setFileInputKey(Date.now());
    }
  };

  const handleConfirmImport = () => {
    if (!reposToImport) return;

    startImportTransition(async () => {
      try {
        const result = await importRepositoriesAction(reposToImport);

        if (result.success) {
          toast({
            title: t("toast_import_success_title"),
            description: result.message,
          });
          if (result.jobId) {
            setJobId(result.jobId);
          }
        } else {
          toast({
            title: t("toast_import_error_title"),
            description: result.message,
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_import_error_title"),
          description: t("toast_import_error_description"),
          variant: "destructive",
        });
      } finally {
        setIsDialogVisible(false);
        setReposToImport(null);
        setImportStats(null);
      }
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>{t("title")}</CardTitle>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <input
                key={fileInputKey}
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json,.yml,.yaml"
                className="hidden"
              />
              <input
                key={`json-${fileInputKey}`}
                type="file"
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
              />
              {!isExpanded && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleImportClick}
                  className="min-w-0 flex-1 sm:flex-none"
                  disabled={isPending || isImporting || !!jobId || !isOnline}
                >
                  {isImporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {t("button_import")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleExpanded}
                disabled={isExpansionSaving}
                aria-expanded={isExpanded}
                aria-controls={contentId}
                aria-label={
                  isExpanded
                    ? t("collapse_button_aria")
                    : t("expand_button_aria")
                }
              >
                <ChevronDown
                  className={cn(
                    "size-5 transition-transform duration-200 ease-out",
                    isExpanded ? "rotate-0" : "rotate-90",
                  )}
                />
              </Button>
            </div>
          </div>
        </CardHeader>
        <div
          id={contentId}
          aria-hidden={!isExpanded}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
            isExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <CardContent className="pt-0">
              <CardDescription className="mb-6">
                {t("description")}
              </CardDescription>
              <form
                onSubmit={(e) => {
                  if (typeof navigator !== "undefined" && !navigator.onLine) {
                    e.preventDefault();
                    toast({
                      title: t("toast_fail_title"),
                      description: t("toast_generic_error"),
                      variant: "destructive",
                    });
                    return;
                  }

                  e.preventDefault();
                  if (!urls.trim()) return;
                  if (isPending || isResolvingProviders || providerDialogOpen) {
                    return;
                  }
                  if (jobId) return;

                  hasProcessedResult.current = false;
                  const lines = urls
                    .split("\n")
                    .map((u) => u.trim())
                    .filter((u) => u !== "");

                  startProviderResolveTransition(async () => {
                    await resolveLinesAndSubmit(lines);
                  });
                }}
              >
                <div className="grid w-full gap-2">
                  <Textarea
                    ref={textareaRef}
                    name="urls"
                    placeholder={t("placeholder")}
                    value={urls}
                    onChange={(e) => setUrls(e.target.value)}
                    rows={4}
                    wrap="off"
                    className="resize-none overflow-y-auto overflow-x-auto max-h-80"
                    disabled={
                      !isExpanded ||
                      isPending ||
                      isResolvingProviders ||
                      !!jobId ||
                      providerDialogOpen
                    }
                  />
                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleImportClick}
                      className="mt-2 w-full sm:mt-0 sm:w-auto"
                      disabled={
                        !isExpanded ||
                        isPending ||
                        isImporting ||
                        !!jobId ||
                        !isOnline
                      }
                    >
                      {isImporting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {t("button_import")}
                    </Button>
                    <SubmitButton
                      isDisabled={
                        !isExpanded ||
                        !urls.trim() ||
                        !isOnline ||
                        isResolvingProviders ||
                        providerDialogOpen
                      }
                      isPending={isPending || !!jobId || isResolvingProviders}
                    />
                  </div>
                </div>
              </form>
            </CardContent>
          </div>
        </div>
      </Card>

      <AlertDialog
        open={providerDialogOpen}
        onOpenChange={(open) => {
          setProviderDialogOpen(open);
          if (!open) {
            setProviderDialogRepo(null);
            setProviderDialogCandidates([]);
            setProviderDialogPendingState(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("provider_select_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {providerDialogRepo
                ? t("provider_select_description", { repo: providerDialogRepo })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between sm:space-x-0">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-start">
              {orderedProviderCandidates.map((candidate) => (
                <AlertDialogAction
                  key={`${candidate.provider}-${candidate.canonicalRepoUrl}`}
                  onClick={() =>
                    handleChooseProvider(candidate.canonicalRepoUrl)
                  }
                  disabled={isResolvingProviders || isPending}
                >
                  {candidate.provider === "codeberg"
                    ? t("provider_select_codeberg")
                    : candidate.provider === "gitlab"
                      ? `${t("provider_select_gitlab")}${
                          candidate.providerHost
                            ? ` (${candidate.providerHost})`
                            : ""
                        }`
                      : t("provider_select_github")}
                </AlertDialogAction>
              ))}
            </div>
            <AlertDialogCancel disabled={isResolvingProviders || isPending}>
              {t("cancel_button")}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDialogVisible} onOpenChange={setIsDialogVisible}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("import_dialog_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {importStats &&
                t("import_dialog_description", {
                  newCount: importStats.newCount,
                  existingCount: importStats.existingCount,
                })}
              {importStats?.skippedImages ? (
                <span className="mt-2 block">
                  {t("import_dialog_compose_skipped", {
                    count: importStats.skippedImages,
                  })}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reposToImport?.length ? (
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <div className="sticky top-0 border-b bg-background px-3 py-2 text-sm font-medium">
                {t("import_dialog_repo_list_title")}
              </div>
              <ul className="divide-y">
                {reposToImport.map((repo) => {
                  const isExisting = currentRepositoryIds.has(repo.id);
                  const providerName = getRepositoryProviderName(repo);

                  return (
                    <li
                      key={repo.id}
                      className="flex min-h-12 items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {providerName ? (
                          <Badge variant="outline" className="shrink-0">
                            {providerName}
                          </Badge>
                        ) : null}
                        <a
                          href={repo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate text-sm font-medium text-foreground hover:underline"
                        >
                          {getRepositoryDisplayName(repo)}
                        </a>
                      </div>
                      <Badge
                        variant={isExisting ? "secondary" : "default"}
                        className="shrink-0"
                      >
                        {isExisting
                          ? t("import_dialog_repo_status_existing")
                          : t("import_dialog_repo_status_new")}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>
              {t("cancel_button")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              disabled={isImporting}
            >
              {isImporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("import_dialog_confirm_button")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
