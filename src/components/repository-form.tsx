"use client";

import { Loader2, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useActionState } from "react";

import {
  addRepositoriesAction,
  getJobStatusAction,
  importRepositoriesAction,
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useNetworkStatus } from "@/hooks/use-network";
import { useToast } from "@/hooks/use-toast";
import { reloadIfServerActionStale } from "@/lib/server-action-error";
import type { Repository } from "@/types";

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

const initialState = {
  success: false,
  toast: undefined,
  error: undefined,
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());
const isOwnerRepoShorthand = (value: string) =>
  /^[a-z0-9-._]+\/[a-z0-9-._]+$/i.test(value.trim());

type ProviderChoiceCandidate = {
  provider: "github" | "codeberg";
  canonicalRepoUrl: string;
};

interface RepositoryFormProps {
  currentRepositories: Repository[];
}

export function RepositoryForm({ currentRepositories }: RepositoryFormProps) {
  const t = useTranslations("RepositoryForm");
  const [urls, setUrls] = React.useState("");
  const { toast } = useToast();
  const router = useRouter();
  const { isOnline } = useNetworkStatus();

  const [state, formAction, isPending] = useActionState(
    addRepositoriesAction,
    initialState,
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
  const [importStats, setImportStats] = React.useState<{
    newCount: number;
    existingCount: number;
  } | null>(null);
  const [fileInputKey, setFileInputKey] = React.useState(Date.now());

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

  React.useEffect(() => {
    if (!jobId) return;

    const POLLING_INTERVAL = 2000; // 2 seconds
    const POLLING_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    const startTime = Date.now();

    const intervalId = setInterval(async () => {
      if (Date.now() - startTime > POLLING_TIMEOUT) {
        clearInterval(intervalId);
        toast({
          title: t("toast_refresh_timeout_title"),
          description: t("toast_refresh_timeout_description"),
          variant: "destructive",
        });
        setJobId(undefined);
        return;
      }

      try {
        const { status } = await getJobStatusAction(jobId);

        if (status === "complete") {
          clearInterval(intervalId);
          toast({
            title: t("toast_refresh_success_title"),
            description: t("toast_refresh_success_description"),
          });
          router.refresh();
          setJobId(undefined);
        } else if (status === "error") {
          clearInterval(intervalId);
          toast({
            title: t("toast_refresh_error_title"),
            description: t("toast_refresh_error_description"),
            variant: "destructive",
          });
          setJobId(undefined);
        }
      } catch (error: unknown) {
        clearInterval(intervalId);
        if (reloadIfServerActionStale(error)) {
          return;
        }
        toast({
          title: t("toast_refresh_error_title"),
          description: t("toast_refresh_error_description"),
          variant: "destructive",
        });
        setJobId(undefined);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [jobId, router, t, toast]);

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
    const order: Record<ProviderChoiceCandidate["provider"], number> = {
      codeberg: 0,
      github: 1,
    };
    return [...providerDialogCandidates].sort(
      (a, b) => order[a.provider] - order[b.provider],
    );
  }, [providerDialogCandidates]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const importedData = JSON.parse(content);

        if (Array.isArray(importedData)) {
          const isValidFormat = importedData.every(
            (item) =>
              typeof item === "object" &&
              item !== null &&
              "id" in item &&
              "url" in item,
          );

          if (!isValidFormat) {
            throw new Error(t("toast_import_error_invalid_format"));
          }

          const existingIds = new Set(
            currentRepositories.map((repo) => repo.id),
          );
          const newRepos = importedData.filter(
            (repo) => !existingIds.has(repo.id),
          );
          const existingCount = importedData.length - newRepos.length;

          setReposToImport(importedData);
          setImportStats({ newCount: newRepos.length, existingCount });
          setIsDialogVisible(true);
        } else {
          toast({
            title: t("toast_import_error_title"),
            description: t("toast_import_error_invalid_format"),
            variant: "destructive",
          });
        }
      } catch (error: unknown) {
        const description =
          error instanceof Error && error.message
            ? error.message
            : typeof error === "string"
              ? error
              : t("toast_import_error_parsing");
        toast({
          title: t("toast_import_error_title"),
          description,
          variant: "destructive",
        });
      }
    };
    reader.onerror = () => {
      toast({
        title: t("toast_import_error_title"),
        description: t("toast_import_error_reading"),
        variant: "destructive",
      });
    };
    reader.readAsText(file);
    setFileInputKey(Date.now());
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
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
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
                  isPending ||
                  isResolvingProviders ||
                  !!jobId ||
                  providerDialogOpen
                }
              />
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2">
                <input
                  key={fileInputKey}
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".json"
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleImportClick}
                  className="mt-2 w-full sm:mt-0 sm:w-auto"
                  disabled={isPending || isImporting || !!jobId || !isOnline}
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
                  key={candidate.provider}
                  onClick={() =>
                    handleChooseProvider(candidate.canonicalRepoUrl)
                  }
                  disabled={isResolvingProviders || isPending}
                >
                  {candidate.provider === "codeberg"
                    ? t("provider_select_codeberg")
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("import_dialog_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {importStats &&
                t("import_dialog_description", {
                  newCount: importStats.newCount,
                  existingCount: importStats.existingCount,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
