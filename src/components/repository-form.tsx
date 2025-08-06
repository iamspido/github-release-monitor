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
import { addRepositoriesAction, importRepositoriesAction } from "@/app/actions";
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

  const [state, formAction, isPending] = useActionState(addRepositoriesAction, initialState);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // State for the import confirmation dialog
  const [isImporting, startImportTransition] = React.useTransition();
  const [isDialogVisible, setIsDialogVisible] = React.useState(false);
  const [reposToImport, setReposToImport] = React.useState<Repository[] | null>(null);
  const [importStats, setImportStats] = React.useState<{ newCount: number, existingCount: number } | null>(null);

  // This key is used to force-remount the file input, which is the most reliable way to reset it.
  const [fileInputKey, setFileInputKey] = React.useState(Date.now());

  // Effect to handle toasts and form reset on action completion
  React.useEffect(() => {
    if (state.error) {
      toast({
        title: t('toast_fail_title'),
        description: state.error,
        variant: 'destructive',
      });
    }
    if (state.toast) {
      toast({
        title: state.toast.title,
        description: state.toast.description,
      });
    }
    if (state.success) {
      setUrls(''); // Clear textarea on success
    }
  }, [state, t, toast]);


  // Effect to handle textarea auto-resizing
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
        textarea.style.height = 'auto'; // Reset height
        textarea.style.height = `${textarea.scrollHeight}px`; // Set to content height
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
                // Perform a basic validation that it's an array of objects with id/url
                const isValidFormat = importedData.every(item =>
                  typeof item === 'object' && item !== null && 'id' in item && 'url' in item
                );

                if (!isValidFormat) {
                    throw new Error(t('toast_import_error_invalid_format'));
                }

                // Use the prop to calculate stats for the dialog
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

    // Reset file input by changing its key, which forces a remount.
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
                disabled={isPending}
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
                  <Button type="button" variant="outline" onClick={handleImportClick} className="w-full sm:w-auto mt-2 sm:mt-0" disabled={isPending || isImporting}>
                      {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      {t('button_import')}
                  </Button>
                  <SubmitButton isDisabled={!urls.trim()} isPending={isPending} />
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
