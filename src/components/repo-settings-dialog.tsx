'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Save, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react';
import type { Repository, ReleaseChannel, PreReleaseChannelType, AppSettings, AppriseFormat } from '@/types';
import { allPreReleaseTypes } from '@/types';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { updateRepositorySettingsAction, refreshSingleRepositoryAction } from '@/app/actions';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from './ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";


type SaveStatus = 'idle' | 'waiting' | 'saving' | 'success' | 'error';
type ReleasesPerPageError = 'too_low' | 'too_high' | null;
type RegexError = 'invalid' | null;


function SaveStatusIndicator({ status }: { status: SaveStatus }) {
    const t = useTranslations('RepoSettingsDialog');
    const tLong = useTranslations('SettingsForm');

    if (status === 'idle') {
        return null;
    }

    const messages: Record<SaveStatus, { text: React.ReactNode; icon: React.ReactNode; className: string }> = {
        idle: { text: '', icon: null, className: '' },
        waiting: { text: t('autosave_waiting'), icon: <Save className="size-4" />, className: 'text-muted-foreground' },
        saving: { text: t('autosave_saving'), icon: <Loader2 className="size-4 animate-spin" />, className: 'text-muted-foreground' },
        success: {
            text: (
                <>
                    <span className="sm:hidden">{t('autosave_success_short')}</span>
                    <span className="hidden sm:inline">{tLong('autosave_success')}</span>
                </>
            ),
            icon: <CheckCircle className="size-4" />,
            className: 'text-green-500'
        },
        error: { text: t('autosave_error'), icon: <AlertCircle className="size-4" />, className: 'text-destructive' },
    };

    const current = messages[status];

    return (
        <div className={cn("flex items-center justify-end gap-2 text-sm transition-colors", current.className)}>
            {current.icon}
            <span>{current.text}</span>
        </div>
    );
}

interface RepoSettingsDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  repoId: string;
  currentRepoSettings?: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex' | 'appriseTags' | 'appriseFormat'>;
  globalSettings: AppSettings;
}

export function RepoSettingsDialog({ isOpen, setIsOpen, repoId, currentRepoSettings, globalSettings }: RepoSettingsDialogProps) {
  const t = useTranslations('RepoSettingsDialog');
  const tGlobal = useTranslations('SettingsForm');
  const { toast } = useToast();

  const [channels, setChannels] = React.useState<ReleaseChannel[]>(currentRepoSettings?.releaseChannels ?? []);
  const [preReleaseSubChannels, setPreReleaseSubChannels] = React.useState<PreReleaseChannelType[]>(
    currentRepoSettings?.preReleaseSubChannels ?? []
  );
  const [releasesPerPage, setReleasesPerPage] = React.useState<string | number>(currentRepoSettings?.releasesPerPage ?? '');
  const [includeRegex, setIncludeRegex] = React.useState(currentRepoSettings?.includeRegex ?? '');
  const [excludeRegex, setExcludeRegex] = React.useState(currentRepoSettings?.excludeRegex ?? '');
  const [appriseTags, setAppriseTags] = React.useState(currentRepoSettings?.appriseTags ?? '');
  const [appriseFormat, setAppriseFormat] = React.useState<AppriseFormat | ''>(currentRepoSettings?.appriseFormat ?? '');

  const [releasesPerPageError, setReleasesPerPageError] = React.useState<ReleasesPerPageError>(null);
  const [includeRegexError, setIncludeRegexError] = React.useState<RegexError>(null);
  const [excludeRegexError, setExcludeRegexError] = React.useState<RegexError>(null);

  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle');

  const savedThisSessionRef = React.useRef(false);

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const prevIsOpenRef = React.useRef(isOpen);
  React.useEffect(() => {
    const wasOpen = prevIsOpenRef.current;

    // transition: closed -> open
    if (!wasOpen && isOpen) {
      const initialSettings = {
        releaseChannels: currentRepoSettings?.releaseChannels ?? [],
        preReleaseSubChannels: currentRepoSettings?.preReleaseSubChannels ?? [],
        releasesPerPage: currentRepoSettings?.releasesPerPage ?? null,
        includeRegex: currentRepoSettings?.includeRegex ?? undefined,
        excludeRegex: currentRepoSettings?.excludeRegex ?? undefined,
        appriseTags: currentRepoSettings?.appriseTags ?? undefined,
        appriseFormat: currentRepoSettings?.appriseFormat ?? undefined,
      };

      setChannels(initialSettings.releaseChannels);
      setPreReleaseSubChannels(initialSettings.preReleaseSubChannels);
      setReleasesPerPage(initialSettings.releasesPerPage ?? '');
      setIncludeRegex(initialSettings.includeRegex ?? '');
      setExcludeRegex(initialSettings.excludeRegex ?? '');
      setAppriseTags(initialSettings.appriseTags ?? '');
      setAppriseFormat(initialSettings.appriseFormat ?? '');

      setSaveStatus('idle');

      savedThisSessionRef.current = false;

      prevSettingsRef.current = {
        ...initialSettings,
        releasesPerPage: initialSettings.releasesPerPage,
      };
    }

    if (wasOpen && !isOpen) {
      if (savedThisSessionRef.current) {
        try {
          refreshSingleRepositoryAction(repoId);
        } catch (e) {
        }
        savedThisSessionRef.current = false;
      }
    }

    prevIsOpenRef.current = isOpen;
  }, [isOpen, currentRepoSettings, repoId]);

  const useGlobalChannels = channels.length === 0;
  const useGlobalSubChannels = preReleaseSubChannels.length === 0;
  const useGlobalReleasesPerPage = String(releasesPerPage).trim() === '';
  const useGlobalIncludeRegex = includeRegex.trim() === '';
  const useGlobalExcludeRegex = excludeRegex.trim() === '';
  const useGlobalAppriseTags = appriseTags.trim() === '';
  const useGlobalAppriseFormat = appriseFormat === '';

  const isUsingAllGlobalSettings = useGlobalChannels && useGlobalReleasesPerPage && useGlobalIncludeRegex && useGlobalExcludeRegex && useGlobalAppriseTags && useGlobalAppriseFormat;

  const newSettings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage' | 'includeRegex' | 'excludeRegex' | 'appriseTags' | 'appriseFormat'> = React.useMemo(() => {
    let finalReleasesPerPage: number | null = null;
    const releasesPerPageStr = String(releasesPerPage).trim();

    if (releasesPerPageStr !== '') {
      const parsed = parseInt(releasesPerPageStr, 10);
      if (!isNaN(parsed)) {
        finalReleasesPerPage = parsed;
      }
    }

    return {
      releaseChannels: channels,
      preReleaseSubChannels,
      releasesPerPage: finalReleasesPerPage,
      includeRegex: includeRegex.trim() || undefined,
      excludeRegex: excludeRegex.trim() || undefined,
      appriseTags: appriseTags.trim() || undefined,
      appriseFormat: appriseFormat || undefined,
    };
  }, [channels, preReleaseSubChannels, releasesPerPage, includeRegex, excludeRegex, appriseTags, appriseFormat]);

  const prevSettingsRef = React.useRef(newSettings);

  React.useEffect(() => {
    if (String(releasesPerPage).trim() !== '') {
      const numReleases = parseInt(String(releasesPerPage), 10);
      if (isNaN(numReleases)) {
        setReleasesPerPageError(null);
      } else if (numReleases < 1) {
          setReleasesPerPageError('too_low');
      } else if (numReleases > 1000) {
          setReleasesPerPageError('too_high');
      } else {
          setReleasesPerPageError(null);
      }
    } else {
        setReleasesPerPageError(null);
    }

    try {
        if (includeRegex.trim()) new RegExp(includeRegex);
        setIncludeRegexError(null);
    } catch (e) {
        setIncludeRegexError('invalid');
    }

    try {
        if (excludeRegex.trim()) new RegExp(excludeRegex);
        setExcludeRegexError(null);
    } catch (e) {
        setExcludeRegexError('invalid');
    }

  }, [releasesPerPage, includeRegex, excludeRegex]);

  React.useEffect(() => {
    if (!isOpen) return;

    if (JSON.stringify(newSettings) === JSON.stringify(prevSettingsRef.current)) {
        return;
    }

    if (releasesPerPageError || includeRegexError || excludeRegexError) {
      setSaveStatus('idle');
      return;
    }

    setSaveStatus('waiting');

    const handler = setTimeout(async () => {
        if (mountedRef.current) setSaveStatus('saving');

        try {
            const result = await updateRepositorySettingsAction(repoId, newSettings);

            if (result.success) {
                if (mountedRef.current) {
                    setSaveStatus('success');
                    prevSettingsRef.current = newSettings;

                    savedThisSessionRef.current = true;
                } else {
                    savedThisSessionRef.current = true;
                }
            } else {
                if (mountedRef.current) {
                    setSaveStatus('error');
                    toast({
                      title: t('toast_error_title'),
                      description: result.error,
                      variant: 'destructive',
                    });
                }
            }
        } catch (err) {
            if (mountedRef.current) {
                setSaveStatus('error');
                toast({ title: t('toast_error_title'), description: String(err), variant: 'destructive' });
            }
        }
    }, 1500);

    return () => clearTimeout(handler);
  }, [newSettings, repoId, isOpen, releasesPerPageError, includeRegexError, excludeRegexError, toast, t]);


  const handleChannelChange = (channel: ReleaseChannel) => {
    const baseChannels = useGlobalChannels ? globalSettings.releaseChannels : channels;

    const newChannels = baseChannels.includes(channel)
        ? baseChannels.filter(c => c !== channel)
        : [...baseChannels, channel];

    if (newChannels.length === 0) {
        toast({
            title: t('toast_error_title'),
            description: t('release_channel_error_at_least_one'),
            variant: 'destructive',
        });
        return;
    }

    setChannels(newChannels);

    if (useGlobalChannels && useGlobalSubChannels && channel === 'prerelease' && newChannels.includes('prerelease')) {
      setPreReleaseSubChannels(globalSettings.preReleaseSubChannels || allPreReleaseTypes);
    }
  };

  const handlePreReleaseSubChannelChange = (subChannel: PreReleaseChannelType) => {
    const baseSubChannels = useGlobalSubChannels
        ? (globalSettings.preReleaseSubChannels || allPreReleaseTypes)
        : preReleaseSubChannels;

    const newSubChannels = baseSubChannels.includes(subChannel)
        ? baseSubChannels.filter(sc => sc !== subChannel)
        : [...baseSubChannels, subChannel];
    setPreReleaseSubChannels(newSubChannels);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  }

  const handleResetAll = () => {
    setChannels([]);
    setPreReleaseSubChannels([]);
    setReleasesPerPage('');
    setIncludeRegex('');
    setExcludeRegex('');
    setAppriseTags('');
    setAppriseFormat('');
  }

  const handleResetFilters = () => {
    setChannels([]);
    setPreReleaseSubChannels([]);
    setIncludeRegex('');
    setExcludeRegex('');
  };

  const isStableChecked = useGlobalChannels
    ? globalSettings.releaseChannels.includes('stable')
    : channels.includes('stable');

  const isPreReleaseChecked = useGlobalChannels
    ? globalSettings.releaseChannels.includes('prerelease')
    : channels.includes('prerelease');

  const isDraftChecked = useGlobalChannels
    ? globalSettings.releaseChannels.includes('draft')
    : channels.includes('draft');

  const effectivePreReleaseSubChannels = useGlobalSubChannels
    ? (globalSettings.preReleaseSubChannels || allPreReleaseTypes)
    : preReleaseSubChannels;

  const isAppriseConfigured = !!globalSettings.appriseMaxCharacters;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t.rich('description_flexible', {
              repoId: () => <span className="font-semibold text-foreground">{repoId}</span>
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-4 max-h-[70vh] overflow-y-auto pr-2 -mr-4 pb-4">
          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">{tGlobal('release_channel_title')}</h4>
              <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={handleResetFilters} className="size-8 shrink-0">
                          <RotateCcw className="size-4" />
                          <span className="sr-only">{t('reset_to_global_button')}</span>
                        </Button>
                    </TooltipTrigger>
                      <TooltipContent>
                          <p>{t('reset_to_global_tooltip')}</p>
                      </TooltipContent>
                  </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground">
              {useGlobalChannels ? t('channels_hint_global') : t('channels_hint_individual')}
            </p>
            <p className="text-xs text-muted-foreground">
              {tGlobal('release_channel_description_repo')}
            </p>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="stable-repo"
                checked={isStableChecked}
                onCheckedChange={() => handleChannelChange('stable')}
              />
              <Label htmlFor="stable-repo" className="font-normal cursor-pointer">{tGlobal('release_channel_stable')}</Label>
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="prerelease-repo"
                  checked={isPreReleaseChecked}
                  onCheckedChange={() => handleChannelChange('prerelease')}
                />
                <Label htmlFor="prerelease-repo" className="font-normal cursor-pointer">{tGlobal('release_channel_prerelease')}</Label>
              </div>

              <div className={cn(
                "ml-6 pl-3 border-l-2 transition-all duration-300 ease-in-out overflow-hidden",
                isPreReleaseChecked ? 'mt-4 max-h-96 opacity-100' : 'max-h-0 opacity-0'
              )}>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{tGlobal('prerelease_subtype_description')}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                    {allPreReleaseTypes.map((subType) => (
                      <div key={subType} className="flex items-center space-x-2">
                        <Checkbox
                          id={`prerelease-repo-${subType}`}
                          checked={effectivePreReleaseSubChannels.includes(subType)}
                          onCheckedChange={() => handlePreReleaseSubChannelChange(subType)}
                          disabled={!isPreReleaseChecked}
                        />
                        <Label htmlFor={`prerelease-repo-${subType}`} className="font-normal cursor-pointer text-sm">{subType}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="draft-repo"
                checked={isDraftChecked}
                onCheckedChange={() => handleChannelChange('draft')}
              />
              <Label htmlFor="draft-repo" className="font-normal cursor-pointer">{tGlobal('release_channel_draft')}</Label>
            </div>

            <div className="space-y-2 pt-4">
                <h4 className="font-medium text-base">{tGlobal('regex_filter_title')}</h4>
                 <p className="text-xs text-muted-foreground">
                    {tGlobal('regex_filter_description_repo')}
                </p>
            </div>
            <div className="space-y-2">
                <Label htmlFor="include-regex-repo">{tGlobal('include_regex_label')}</Label>
                <Input
                    id="include-regex-repo"
                    value={includeRegex}
                    onChange={(e) => setIncludeRegex(e.target.value)}
                    placeholder={globalSettings.includeRegex || tGlobal('regex_placeholder')}
                    className={cn(!!includeRegexError && 'border-destructive focus-visible:ring-destructive')}
                />
                {includeRegexError && <p className="text-sm text-destructive">{tGlobal('regex_error_invalid')}</p>}
            </div>
            <div className="space-y-2">
                <Label htmlFor="exclude-regex-repo">{tGlobal('exclude_regex_label')}</Label>
                <Input
                    id="exclude-regex-repo"
                    value={excludeRegex}
                    onChange={(e) => setExcludeRegex(e.target.value)}
                    placeholder={globalSettings.excludeRegex || tGlobal('regex_placeholder')}
                    className={cn(!!excludeRegexError && 'border-destructive focus-visible:ring-destructive')}
                />
                 {excludeRegexError && <p className="text-sm text-destructive">{tGlobal('regex_error_invalid')}</p>}
            </div>
          </div>

          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">{t('releases_per_page_label_repo')}</h4>
            </div>
              <p className="text-xs text-muted-foreground">
              {useGlobalReleasesPerPage ? t('releases_per_page_hint_global') : t('releases_per_page_hint_individual')}
              </p>
              <div className="flex items-center gap-2">
              <Input
                id="releases-per-page-repo"
                type="number"
                value={releasesPerPage}
                onChange={(e) => setReleasesPerPage(e.target.value)}
                min={1}
                max={1000}
                placeholder={t('releases_per_page_placeholder', { count: globalSettings.releasesPerPage })}
                className={cn(!!releasesPerPageError && 'border-destructive focus-visible:ring-destructive')}
              />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setReleasesPerPage('')} className="size-8 shrink-0">
                          <RotateCcw className="size-4" />
                          <span className="sr-only">{t('reset_to_global_button')}</span>
                        </Button>
                    </TooltipTrigger>
                      <TooltipContent>
                          <p>{t('reset_to_global_tooltip')}</p>
                      </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            {releasesPerPageError === 'too_low' ? (
                <p className="mt-2 text-sm text-destructive">{tGlobal('releases_per_page_error_min')}</p>
            ) : releasesPerPageError === 'too_high' ? (
                <p className="mt-2 text-sm text-destructive">{tGlobal('releases_per_page_error_max_1000')}</p>
            ) : (
                <p className="mt-2 text-xs text-muted-foreground">{tGlobal('releases_per_page_hint_1000')}</p>
            )}
             <p className="mt-2 text-xs text-muted-foreground">{tGlobal('releases_per_page_api_call_hint')}</p>
          </div>

          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">{tGlobal('apprise_settings_title')}</h4>
            </div>

            <p className="text-xs text-muted-foreground">
              {useGlobalAppriseTags && useGlobalAppriseFormat ? t('apprise_settings_hint_global') : t('apprise_settings_hint_individual')}
            </p>

            <div className='space-y-2'>
                <Label htmlFor="apprise-format-repo">{tGlobal('apprise_format_label')}</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={appriseFormat}
                    onValueChange={(value: AppriseFormat | 'global') => setAppriseFormat(value === 'global' ? '' : value)}
                    disabled={!isAppriseConfigured}
                  >
                    <SelectTrigger id="apprise-format-repo">
                        <SelectValue placeholder={t('apprise_format_placeholder', {format: globalSettings.appriseFormat || 'text'})} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="global">{t('apprise_format_option_global', {format: globalSettings.appriseFormat || 'text'})}</SelectItem>
                        <SelectItem value="text">{tGlobal('apprise_format_text')}</SelectItem>
                        <SelectItem value="markdown">{tGlobal('apprise_format_markdown')}</SelectItem>
                        <SelectItem value="html">{tGlobal('apprise_format_html')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setAppriseFormat('')} className="size-8 shrink-0">
                            <RotateCcw className="size-4" />
                            <span className="sr-only">{t('reset_to_global_button')}</span>
                          </Button>
                      </TooltipTrigger>
                        <TooltipContent>
                            <p>{t('reset_to_global_tooltip')}</p>
                        </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                 {!isAppriseConfigured && (
                    <p className="mt-2 text-xs text-muted-foreground">{tGlobal('apprise_format_disabled_hint')}</p>
                )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor="apprise-tags-repo">{t('apprise_tags_label')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="apprise-tags-repo"
                  type="text"
                  value={appriseTags}
                  onChange={(e) => setAppriseTags(e.target.value)}
                  placeholder={t('apprise_tags_placeholder', { tags: globalSettings.appriseTags || '...' })}
                  disabled={!isAppriseConfigured}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setAppriseTags('')} className="size-8 shrink-0">
                          <RotateCcw className="size-4" />
                          <span className="sr-only">{t('reset_to_global_button')}</span>
                        </Button>
                    </TooltipTrigger>
                      <TooltipContent>
                          <p>{t('reset_to_global_tooltip')}</p>
                        </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              {!isAppriseConfigured && (
                <p className="mt-2 text-xs text-muted-foreground">{tGlobal('apprise_tags_disabled_hint')}</p>
              )}
            </div>
          </div>

          <div className="pt-2">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full" disabled={isUsingAllGlobalSettings}>
                    <RotateCcw className="mr-2 size-4" />
                    {t('reset_all_button_text')}
                </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('reset_all_dialog_title')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('reset_all_dialog_description')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{tGlobal('cancel_button')}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetAll}>
                    {t('reset_all_confirm_button')}
                    </AlertDialogAction>
                </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <DialogFooter className="pt-4">
            <SaveStatusIndicator status={saveStatus} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
