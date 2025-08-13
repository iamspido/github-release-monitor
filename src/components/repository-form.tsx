"use client";

import * as React from "react";
import { Plus, Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import type { Repository } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addRepositoriesAction, getJobStatusAction, importRepositoriesAction } from "@/app/actions";
import { useRouter } from "next/navigation";
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


function SubmitButton({ isDisabled, isPending }: { isDisabled: boolean; isPending: boolean }) {
  const t = useTranslations('RepositoryForm');

  return (
    <Button type="submit" className="w-full sm:w-auto" disabled={isPending || isDisabled}>
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Plus className="mr-2 h-4 w-4" />
      )}
      {t('button_add')}
    </Button>
  );
}

const initialState = {
  success: false,
  toast: undefined,
  error: undefined,
};

interface RepositoryFormProps {
  currentRepositories: Repository[];
}

export function RepositoryForm({ currentRepositories }: RepositoryFormProps) {
  const t = useTranslations('RepositoryForm');
  const [urls, setUrls] = React.useState("");
  const { toast } = useToast();
  const router = useRouter();

  const [state, formAction, isPending] = useActionState(addRepositoriesAction, initialState);
  const [jobId, setJobId] = React.useState<string | undefined>(undefined);
  const hasProcessedResult = React.useRef(true);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [isImporting, startImportTransition] = React.useTransition();
  const [isDialogVisible, setIsDialogVisible] = React.useState(false);
  const [reposToImport, setReposToImport] = React.useState<Repository[] | null>(null);
  const [importStats, setImportStats] = React.useState<{ newCount: number, existingCount: number } | null>(null);
  const [fileInputKey, setFileInputKey] = React.useState(Date.now());

  React.useEffect(() => {
    if (isPending) {
      hasProcessedResult.current = false;
    }
  }, [isPending]);

  React.useEffect(() => {
    if (state.error) {
      toast({
        title: t('toast_fail_title'),
        description: state.error,
        variant: 'destructive',
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
      setUrls('');
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
          title: t('toast_refresh_timeout_title'),
          description: t('toast_refresh_timeout_description'),
          variant: 'destructive'
        });
        setJobId(undefined);
        return;
      }

      const { status } = await getJobStatusAction(jobId);

      if (status === 'complete') {
        clearInterval(intervalId);
        toast({
          title: t('toast_refresh_success_title'),
          description: t('toast_refresh_success_description'),
        });
        router.refresh();
        setJobId(undefined);
      } else if (status === 'error') {
        clearInterval(intervalId);
        toast({
          title: t('toast_refresh_error_title'),
          description: t('toast_refresh_error_description'),
          variant: 'destructive'
        });
        setJobId(undefined);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [jobId, router, t, toast]);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [urls]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const content = e.target?.result as string;
            const importedData = JSON.parse(content);

            if (Array.isArray(importedData)) {
                const isValidFormat = importedData.every(item =>
                  typeof item === 'object' && item !== null && 'id' in item && 'url' in item
                );

                if (!isValidFormat) {
                    throw new Error(t('toast_import_error_invalid_format'));
                }

                const existingIds = new Set(currentRepositories.map(repo => repo.id));
                const newRepos = importedData.filter(repo => !existingIds.has(repo.id));
                const existingCount = importedData.length - newRepos.length;

                setReposToImport(importedData);
                setImportStats({ newCount: newRepos.length, existingCount });
                setIsDialogVisible(true);
            } else {
                 toast({
                    title: t('toast_import_error_title'),
                    description: t('toast_import_error_invalid_format'),
                    variant: 'destructive',
                });
            }
        } catch (error: any) {
            toast({
                title: t('toast_import_error_title'),
                description: error.message || t('toast_import_error_parsing'),
                variant: 'destructive',
            });
        }
    };
    reader.onerror = () => {
        toast({
            title: t('toast_import_error_title'),
            description: t('toast_import_error_reading'),
            variant: 'destructive',
        });
    };
    reader.readAsText(file);
    setFileInputKey(Date.now());
  };

  const handleConfirmImport = () => {
    if (!reposToImport) return;

    startImportTransition(async () => {
      const result = await importRepositoriesAction(reposToImport);

      if (result.success) {
        toast({
          title: t('toast_import_success_title'),
          description: result.message,
        });
        if (result.jobId) {
          setJobId(result.jobId);
        }
      } else {
        toast({
          title: t('toast_import_error_title'),
          description: result.message,
          variant: 'destructive',
        });
      }
      setIsDialogVisible(false);
      setReposToImport(null);
      setImportStats(null);
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction}>
            <div className="grid w-full gap-2">
              <Textarea
                ref={textareaRef}
                name="urls"
                placeholder={t('placeholder')}
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                rows={4}
                wrap="off"
                className="resize-none overflow-y-auto overflow-x-auto max-h-80"
                disabled={isPending || !!jobId}
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
                  <Button type="button" variant="outline" onClick={handleImportClick} className="w-full sm:w-auto mt-2 sm:mt-0" disabled={isPending || isImporting || !!jobId}>
                      {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      {t('button_import')}
                  </Button>
                  <SubmitButton isDisabled={!urls.trim()} isPending={isPending || !!jobId} />
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <AlertDialog open={isDialogVisible} onOpenChange={setIsDialogVisible}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('import_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {importStats && t('import_dialog_description', {
                newCount: importStats.newCount,
                existingCount: importStats.existingCount
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>{t('cancel_button')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmImport} disabled={isImporting}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('import_dialog_confirm_button')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
