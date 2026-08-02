"use client";

import { ChevronDown, Loader2, Plus, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useActionState } from "react";

import { addRepositoriesAction } from "@/app/actions";
import { RepositoryTagPicker } from "@/components/repository-tag-picker";
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
import { isolateLtrText } from "@/lib/bidi";
import {
  MAX_REPOSITORY_TAGS,
  normalizeRepositoryTags,
} from "@/lib/repositories/tags";
import { cn } from "@/lib/utils";
import type { Repository } from "@/types";
import {
  getRepositoryDisplayName,
  getRepositoryProviderName,
  initialRepositoryFormState,
} from "./repository-form-helpers";
import {
  useRepositoryImportWorkflow,
  useRepositoryProviderWorkflow,
} from "./repository-form-workflows";

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
      data-testid="add-repositories"
      type="submit"
      className="w-full sm:w-auto"
      disabled={isPending || isDisabled}
    >
      {isPending ? (
        <Loader2 className="me-2 h-4 w-4 animate-spin" />
      ) : (
        <Plus className="me-2 h-4 w-4" />
      )}
      {t("button_add")}
    </Button>
  );
}

interface RepositoryFormProps {
  currentRepositories: Repository[];
  availableTags: string[];
  isExpanded: boolean;
  isExpansionSaving: boolean;
  onToggleExpanded: () => void;
}

export function RepositoryForm({
  currentRepositories,
  availableTags,
  isExpanded,
  isExpansionSaving,
  onToggleExpanded,
}: RepositoryFormProps) {
  const t = useTranslations("RepositoryForm");
  const contentId = React.useId();
  const tagsInputId = React.useId();
  const [urls, setUrls] = React.useState("");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [tagInput, setTagInput] = React.useState("");
  const [tagError, setTagError] = React.useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();

  const [state, formAction, isPending] = useActionState(
    addRepositoriesAction,
    initialRepositoryFormState,
  );
  const [jobId, setJobId] = React.useState<string | undefined>(undefined);
  const hasProcessedResult = React.useRef(true);
  const providerWorkflow = useRepositoryProviderWorkflow(
    formAction,
    hasProcessedResult,
    selectedTags,
  );
  const importWorkflow = useRepositoryImportWorkflow({
    currentRepositories,
    onJobStarted: setJobId,
    onImportSuccess: () => {
      setSelectedTags([]);
      setTagInput("");
      setTagError(false);
    },
    selectedTags,
  });
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

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
      setSelectedTags([]);
      setTagInput("");
      setTagError(false);
      if (state.jobId) {
        setJobId(state.jobId);
      }
    }
  }, [state, t, toast]);

  const addSelectedTag = (tag: string) => {
    const result = normalizeRepositoryTags([...selectedTags, tag]);
    if (!result.success) {
      setTagError(true);
      return false;
    }

    setSelectedTags(result.tags);
    setTagError(false);
    return true;
  };

  const commitTagInput = () => {
    if (!tagInput.trim()) return;
    if (addSelectedTag(tagInput)) setTagInput("");
  };

  const tagOptions = availableTags.filter((tag) => !selectedTags.includes(tag));

  const handleJobComplete = React.useCallback(() => {
    toast({
      "data-result": "success",
      "data-testid": "repository-update-result",
      title: t("toast_refresh_success_title"),
      description: t("toast_refresh_success_description"),
    });
    router.refresh();
  }, [router, t, toast]);

  const handleJobError = React.useCallback(() => {
    toast({
      "data-result": "error",
      "data-testid": "repository-update-result",
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

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>{t("title")}</CardTitle>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <input
                key={importWorkflow.fileInputKey}
                type="file"
                ref={importWorkflow.fileInputRef}
                onChange={importWorkflow.handleFileChange}
                accept=".json,.yml,.yaml"
                className="hidden"
              />
              {!isExpanded && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={importWorkflow.selectFile}
                  className="min-w-0 flex-1 sm:flex-none"
                  disabled={
                    isPending ||
                    importWorkflow.isImporting ||
                    !!jobId ||
                    !isOnline
                  }
                >
                  {importWorkflow.isImporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="me-2 h-4 w-4" />
                  )}
                  {t("button_import")}
                </Button>
              )}
              <Button
                data-testid="repository-form-toggle"
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
                    isExpanded ? "rotate-0" : "rotate-90 rtl:-rotate-90",
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
                  if (
                    isPending ||
                    providerWorkflow.isResolving ||
                    providerWorkflow.dialogOpen
                  ) {
                    return;
                  }
                  if (jobId) return;

                  const lines = urls
                    .split("\n")
                    .map((u) => u.trim())
                    .filter((u) => u !== "");

                  providerWorkflow.submit(lines);
                }}
              >
                <div className="grid w-full gap-2">
                  <Textarea
                    dir="ltr"
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
                      providerWorkflow.isResolving ||
                      !!jobId ||
                      providerWorkflow.dialogOpen
                    }
                  />
                  <fieldset className="mt-2 rounded-md border p-3">
                    <legend className="px-1 text-sm font-medium">
                      {t("existing_tags_label")}
                    </legend>
                    <p className="mb-3 text-xs text-muted-foreground">
                      {t("existing_tags_hint")}
                    </p>
                    {selectedTags.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {selectedTags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary py-1 ps-3 pe-1 text-sm text-secondary-foreground"
                          >
                            <bdi dir="ltr" className="truncate">
                              {tag}
                            </bdi>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTags((current) =>
                                  current.filter((entry) => entry !== tag),
                                );
                                setTagError(false);
                              }}
                              className="rounded-full p-0.5 hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={t("tags_remove_aria", { tag })}
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <RepositoryTagPicker
                      id={tagsInputId}
                      options={tagOptions}
                      selectedTags={selectedTags}
                      value={tagInput}
                      onValueChange={(value) => {
                        setTagInput(value);
                        setTagError(false);
                      }}
                      onTagSelect={addSelectedTag}
                      onCreateTag={addSelectedTag}
                      onInputBlur={commitTagInput}
                      placeholder={t("tags_input_placeholder")}
                      listboxLabel={t("tags_existing_label")}
                      createOptionLabel={(tag) =>
                        t("tags_create_option", { tag })
                      }
                      ariaLabel={t("tags_input_aria")}
                      disabled={
                        !isExpanded ||
                        isPending ||
                        providerWorkflow.isResolving ||
                        providerWorkflow.dialogOpen ||
                        !!jobId ||
                        !isOnline ||
                        selectedTags.length >= MAX_REPOSITORY_TAGS
                      }
                      invalid={tagError}
                    />
                    {tagError && (
                      <p className="mt-2 text-sm text-destructive">
                        {t("tags_error_invalid")}
                      </p>
                    )}
                  </fieldset>
                  <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={importWorkflow.selectFile}
                      className="mt-2 w-full sm:mt-0 sm:w-auto"
                      disabled={
                        !isExpanded ||
                        isPending ||
                        importWorkflow.isImporting ||
                        !!jobId ||
                        !isOnline
                      }
                    >
                      {importWorkflow.isImporting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="me-2 h-4 w-4" />
                      )}
                      {t("button_import")}
                    </Button>
                    <SubmitButton
                      isDisabled={
                        !isExpanded ||
                        !urls.trim() ||
                        !isOnline ||
                        providerWorkflow.isResolving ||
                        providerWorkflow.dialogOpen
                      }
                      isPending={
                        isPending || !!jobId || providerWorkflow.isResolving
                      }
                    />
                  </div>
                </div>
              </form>
            </CardContent>
          </div>
        </div>
      </Card>

      <AlertDialog
        open={providerWorkflow.dialogOpen}
        onOpenChange={providerWorkflow.setOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("provider_select_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {providerWorkflow.dialogRepo
                ? t("provider_select_description", {
                    repo: isolateLtrText(providerWorkflow.dialogRepo),
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-start">
              {providerWorkflow.dialogCandidates.map((candidate) => (
                <AlertDialogAction
                  key={`${candidate.provider}-${candidate.canonicalRepoUrl}`}
                  onClick={() =>
                    providerWorkflow.chooseProvider(candidate.canonicalRepoUrl)
                  }
                  disabled={providerWorkflow.isResolving || isPending}
                >
                  {candidate.provider === "forgejo" ? (
                    <>
                      {t("provider_select_forgejo")}
                      {candidate.providerBaseUrl ? (
                        <>
                          {" ("}
                          <bdi dir="ltr">{candidate.providerBaseUrl}</bdi>
                          {")"}
                        </>
                      ) : null}
                    </>
                  ) : candidate.provider === "codeberg" ? (
                    t("provider_select_codeberg")
                  ) : candidate.provider === "gitlab" ? (
                    <>
                      {t("provider_select_gitlab")}
                      {candidate.providerHost ? (
                        <>
                          {" ("}
                          <bdi dir="ltr">{candidate.providerHost}</bdi>
                          {")"}
                        </>
                      ) : null}
                    </>
                  ) : (
                    t("provider_select_github")
                  )}
                </AlertDialogAction>
              ))}
            </div>
            <AlertDialogCancel
              disabled={providerWorkflow.isResolving || isPending}
            >
              {t("cancel_button")}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={importWorkflow.dialogVisible}
        onOpenChange={importWorkflow.setDialogVisible}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("import_dialog_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {importWorkflow.stats &&
                t("import_dialog_description", {
                  newCount: importWorkflow.stats.newCount,
                  existingCount: importWorkflow.stats.existingCount,
                })}
              {importWorkflow.stats?.skippedImages ? (
                <span className="mt-2 block">
                  {t("import_dialog_compose_skipped", {
                    count: importWorkflow.stats.skippedImages,
                  })}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {importWorkflow.repositories?.length ? (
            <div className="max-h-72 overflow-y-auto rounded-md border">
              <div className="sticky top-0 border-b bg-background px-3 py-2 text-sm font-medium">
                {t("import_dialog_repo_list_title")}
              </div>
              <ul className="divide-y">
                {importWorkflow.repositories.map((repo) => {
                  const isExisting = importWorkflow.currentRepositoryIds.has(
                    repo.id,
                  );
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
                          <bdi dir="ltr">{getRepositoryDisplayName(repo)}</bdi>
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
            <AlertDialogCancel disabled={importWorkflow.isImporting}>
              {t("cancel_button")}
            </AlertDialogCancel>
            <Button
              onClick={importWorkflow.confirmImport}
              disabled={importWorkflow.isImporting}
            >
              {importWorkflow.isImporting ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("import_dialog_confirm_button")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
