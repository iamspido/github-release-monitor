
"use client";

import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  ExternalLink,
  Trash2,
  Loader2,
  CheckSquare,
  BellPlus,
  Settings,
} from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkGemoji from 'remark-gemoji';
import { useLocale, useTranslations } from "next-intl";

import type { EnrichedRelease, AppSettings, FetchError } from "@/types";
import { removeRepositoryAction, acknowledgeNewReleaseAction, markAsNewAction, revalidateReleasesAction } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RepoSettingsDialog } from "./repo-settings-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";


function getErrorMessage(error: FetchError, t: (key: any) => string): string {
  switch (error.type) {
    case 'rate_limit':
      return t('error_rate_limit');
    case 'no_matching_releases':
      return t('error_no_matching_releases');
    case 'repo_not_found':
      return t('error_repo_not_found');
    case 'invalid_url':
      return t('error_invalid_url');
    case 'no_releases_found':
      return t('error_no_releases_found');
    case 'api_error':
    default:
      return t('error_generic_fetch');
  }
}

interface ReleaseCardProps {
  enrichedRelease: EnrichedRelease;
  settings: AppSettings;
}

export function ReleaseCard({ enrichedRelease, settings }: ReleaseCardProps) {
  const t = useTranslations('ReleaseCard');
  const tActions = useTranslations('Actions');
  const locale = useLocale();
  const { toast } = useToast();
  const { repoId, repoUrl, release, error, isNew, repoSettings } = enrichedRelease;
  
  const [isRemoving, startRemoveTransition] = React.useTransition();
  const [isAcknowledging, startAcknowledgeTransition] = React.useTransition();
  const [isMarkingAsNew, startMarkingAsNewTransition] = React.useTransition();
  const [timeAgo, setTimeAgo] = React.useState('');
  const [checkedAgo, setCheckedAgo] = React.useState('');
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);


  React.useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const updateTimes = () => {
      // Update release time ago
      if (release?.created_at) {
        const dateToUse = release.published_at || release.created_at;
        setTimeAgo(formatDistanceToNowStrict(new Date(dateToUse), {
          addSuffix: true,
          locale: locale === 'de' ? de : undefined,
        }));
      }
      // Update checked time ago
      if (release?.fetched_at) {
        setCheckedAgo(formatDistanceToNowStrict(new Date(release.fetched_at), {
          addSuffix: true,
          locale: locale === 'de' ? de : undefined,
        }));
      }
    };

    updateTimes(); // Initial call
    intervalId = setInterval(updateTimes, 60000); // Update every minute

    // Clean up the interval when the component unmounts or dependencies change.
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [release, locale]);


  const handleRemove = () => {
    startRemoveTransition(async () => {
      await removeRepositoryAction(repoId);
    });
  };

  const handleAcknowledge = () => {
    startAcknowledgeTransition(async () => {
      const result = await acknowledgeNewReleaseAction(repoId);
      if (result && !result.success) {
        toast({
          title: t('toast_error_title'),
          description: result.error,
          variant: 'destructive'
        });
      }
    });
  };

  const handleMarkAsNew = () => {
    startMarkingAsNewTransition(async () => {
      const result = await markAsNewAction(repoId);
      if (result && result.success) {
        toast({
          title: t('toast_success_title'),
          description: t('toast_mark_as_new_success'),
        });
      } else {
        toast({
          title: t('toast_error_title'),
          description: result.error,
          variant: 'destructive',
        });
      }
    });
  }
  
  const repoHasCustomSettings =
    (repoSettings?.releaseChannels && repoSettings.releaseChannels.length > 0) ||
    (repoSettings?.preReleaseSubChannels && repoSettings.preReleaseSubChannels.length > 0) ||
    (repoSettings?.releasesPerPage !== null && typeof repoSettings?.releasesPerPage === 'number') ||
    repoSettings?.includeRegex ||
    repoSettings?.excludeRegex ||
    repoSettings?.appriseTags ||
    repoSettings?.appriseFormat;


  if (error && error.type !== 'not_modified') {
    const errorMessage = getErrorMessage(error, tActions);
    return (
      <>
        <RepoSettingsDialog
            isOpen={isSettingsOpen}
            setIsOpen={setIsSettingsOpen}
            repoId={repoId}
            currentRepoSettings={repoSettings}
            globalSettings={settings}
        />
        <Card className="border-destructive/50 bg-destructive/10 flex flex-col">
            <CardHeader>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <CardTitle className="break-words font-semibold text-xl text-red-400">
                        <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {repoId}
                        </a>
                    </CardTitle>
                    <CardDescription className="text-red-400/80">
                        {t('error_title')}
                    </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {repoHasCustomSettings && (
                     <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge variant="outline" className="border-accent text-accent">{t('custom_settings_badge')}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{t('custom_settings_tooltip')}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                  )}
                   <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-red-400/80 hover:bg-red-400/10 hover:text-red-400"
                      onClick={() => setIsSettingsOpen(true)}
                      aria-label={t('settings_button_aria')}
                    >
                      <Settings className="size-4" />
                    </Button>
                </div>
            </div>
            </CardHeader>
            <CardContent className="flex-grow pt-0 min-w-0">
                <div className="flex h-72 rounded-md border border-destructive/20 bg-background p-4">
                    <div className="flex items-center gap-2 text-sm text-red-400">
                        <AlertTriangle className="size-4 shrink-0" />
                        <p>{errorMessage}</p>
                    </div>
                </div>
            </CardContent>
            <CardFooter className="pt-4 flex items-start">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isRemoving}>
                    {isRemoving ? <Loader2 className="animate-spin" /> : <Trash2 />} 
                    {t('remove_button')}
                </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('confirm_dialog_title')}</AlertDialogTitle>
                    <AlertDialogDescription>
                    {t.rich('confirm_dialog_description_long', {
                        bold: (chunks) => <span className="font-bold">{chunks}</span>,
                        repoId
                    })}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel_button')}</AlertDialogCancel>
                    <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleRemove}
                    disabled={isRemoving}
                    >
                    {isRemoving ? <Loader2 className="animate-spin" /> : null}
                    {t('confirm_button')}
                    </AlertDialogAction>
                </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            </CardFooter>
        </Card>
      </>
    );
  }

  if (!release) return <ReleaseCard.Skeleton />;
  
  const showAcknowledgeFeature = settings.showAcknowledge ?? true;
  const showMarkAsNewButton = settings.showMarkAsNew ?? true;

  return (
    <>
      <RepoSettingsDialog
        isOpen={isSettingsOpen}
        setIsOpen={setIsSettingsOpen}
        repoId={repoId}
        currentRepoSettings={repoSettings}
        globalSettings={settings}
      />
      <Card className={cn("flex flex-col transition-all", isNew && showAcknowledgeFeature && "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background")}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                  <CardTitle className="break-words font-semibold text-xl">
                      <a href={release.html_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {release.name || release.tag_name}
                      </a>
                  </CardTitle>
                  <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:underline break-all">
                      {repoId}
                  </a>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <Badge variant="secondary" className="px-3 py-1 text-base">{release.tag_name}</Badge>
                <div className="flex items-center gap-2">
                  {repoHasCustomSettings && (
                     <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge variant="outline" className="border-accent text-accent">{t('custom_settings_badge')}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{t('custom_settings_tooltip')}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    onClick={() => setIsSettingsOpen(true)}
                    aria-label={t('settings_button_aria')}
                  >
                    <Settings className="size-4" />
                  </Button>
                </div>
              </div>
          </div>
          <div className="pt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>{timeAgo ? t('released_ago', {time: timeAgo}) : <Skeleton className="h-4 w-24" />}</span>
            {checkedAgo && (
              <>
                <span className="text-muted-foreground/50">|</span>
                <span className="text-muted-foreground">{t('checked_ago', {time: checkedAgo})}</span>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-grow pt-0 min-w-0">
          {release.body && release.body.trim() !== '' ? (
              <div className="relative w-full max-h-72 overflow-hidden rounded-md border bg-background">
                <div className="prose prose-sm dark:prose-invert max-w-none h-72 overflow-auto break-words p-4">
                  <ReactMarkdown 
                      remarkPlugins={[remarkGfm, remarkGemoji]}
                      components={{
                        table: ({node, ...props}) => (
                            <div className="overflow-x-auto">
                                <table {...props} className="table-fixed" />
                            </div>
                        ),
                    }}
                  >
                      {release.body}
                  </ReactMarkdown>
                </div>
              </div>
          ) : (
              <div className="flex h-72 items-center justify-center rounded-md border border-dashed">
                  <p className="text-center text-sm text-muted-foreground">
                      {t('no_release_notes')}
                  </p>
              </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 pt-4">
          {showAcknowledgeFeature && (
            <>
              {isNew ? (
                  <Button size="sm" onClick={handleAcknowledge} disabled={isAcknowledging || isRemoving || isMarkingAsNew}>
                      {isAcknowledging ? <Loader2 className="animate-spin" /> : <CheckSquare />}
                      <span>{t('acknowledge_button')}</span>
                  </Button>
              ) : (
                  showMarkAsNewButton && (
                  <Button size="sm" variant="secondary" onClick={handleMarkAsNew} disabled={isAcknowledging || isRemoving || isMarkingAsNew}>
                      {isMarkingAsNew ? <Loader2 className="animate-spin" /> : <BellPlus />}
                      <span>{t('mark_as_new_button')}</span>
                  </Button>
                  )
              )}
            </>
          )}
          <div className="flex items-center justify-between">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={isRemoving || isMarkingAsNew}>
                    {isRemoving ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    {t('remove_button')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('confirm_dialog_title')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t.rich('confirm_dialog_description_long', {
                        bold: (chunks) => <span className="font-bold">{chunks}</span>,
                        repoId
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel_button')}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleRemove}
                      disabled={isRemoving}
                    >
                      {isRemoving ? <Loader2 className="animate-spin" /> : null}
                      {t('confirm_button')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              
              <Button asChild variant="ghost" size="sm">
                <a href={release.html_url} target="_blank" rel="noopener noreferrer">
                  {t('view_on_github')} <ExternalLink />
                </a>
              </Button>
          </div>
        </CardFooter>
      </Card>
    </>
  );
}

ReleaseCard.Skeleton = function ReleaseCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-3/4" />
        <div className="pt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <Skeleton className="h-4 w-24" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-72 w-full" />
      </CardContent>
      <CardFooter className="justify-between pt-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </CardFooter>
    </Card>
  );
};
