
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Save, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react';
import type { Repository, ReleaseChannel, PreReleaseChannelType, AppSettings } from '@/types';
import { allPreReleaseTypes } from '@/types';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { updateRepositorySettingsAction, revalidateReleasesAction } from '@/app/actions';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
        <div className={cn("flex items-center gap-2 text-sm transition-colors", current.className)}>
            {current.icon}
            <span>{current.text}</span>
        </div>
    );
}

interface RepoSettingsDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  repoId: string;
  currentRepoSettings?: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage'>;
  globalSettings: AppSettings;
}

export function RepoSettingsDialog({ isOpen, setIsOpen, repoId, currentRepoSettings, globalSettings }: RepoSettingsDialogProps) {
  const t = useTranslations('RepoSettingsDialog');
  const tGlobal = useTranslations('SettingsForm');
  const { toast } = useToast();

  // State
  const [channels, setChannels] = React.useState<ReleaseChannel[]>(currentRepoSettings?.releaseChannels ?? []);
  const [preReleaseSubChannels, setPreReleaseSubChannels] = React.useState<PreReleaseChannelType[]>(
    currentRepoSettings?.preReleaseSubChannels ?? []
  );
  const [releasesPerPage, setReleasesPerPage] = React.useState<string | number>(currentRepoSettings?.releasesPerPage ?? '');
  const [releasesPerPageError, setReleasesPerPageError] = React.useState<ReleasesPerPageError>(null);
  
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle');
  const [hasChanged, setHasChanged] = React.useState(false);

  // Determine if repo settings override global channel settings.
  // An empty array in repo settings means "use global".
  const useGlobalChannels = channels.length === 0;
  const useGlobalSubChannels = preReleaseSubChannels.length === 0;
  const useGlobalReleasesPerPage = String(releasesPerPage).trim() === '';

  // This will be used to disable the "Reset All" button.
  const isUsingAllGlobalSettings = useGlobalChannels && useGlobalReleasesPerPage;


  const newSettings: Pick<Repository, 'releaseChannels' | 'preReleaseSubChannels' | 'releasesPerPage'> = React.useMemo(() => {
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
    };
  }, [channels, preReleaseSubChannels, releasesPerPage]);
  
  // Ref to store the previous settings for comparison
  const prevSettingsRef = React.useRef(newSettings);

  // Sync state with props when dialog opens or closes
  React.useEffect(() => {
    if (isOpen) {
      const initialSettings = {
        releaseChannels: currentRepoSettings?.releaseChannels ?? [],
        preReleaseSubChannels: currentRepoSettings?.preReleaseSubChannels ?? [],
        releasesPerPage: currentRepoSettings?.releasesPerPage ?? null,
      };
      setChannels(initialSettings.releaseChannels);
      setPreReleaseSubChannels(initialSettings.preReleaseSubChannels);
      setReleasesPerPage(initialSettings.releasesPerPage ?? '');
      setSaveStatus('idle');
      setHasChanged(false);
      
      prevSettingsRef.current = {
        ...initialSettings,
        releasesPerPage: initialSettings.releasesPerPage,
      };
    }
  }, [isOpen, currentRepoSettings]);

  // Validation Effect
  React.useEffect(() => {
    if (String(releasesPerPage).trim() !== '') {
      const numReleases = parseInt(String(releasesPerPage), 10);
      if (isNaN(numReleases)) {
        setReleasesPerPageError(null);
        return;
      }
      if (numReleases < 1) {
          setReleasesPerPageError('too_low');
      } else if (numReleases > 100) {
          setReleasesPerPageError('too_high');
      } else {
          setReleasesPerPageError(null);
      }
    } else {
        setReleasesPerPageError(null);
    }
  }, [releasesPerPage]);


  // Effect for debounced autosaving
  React.useEffect(() => {
    if (!isOpen) return;

    // Compare current settings with the previously saved ones.
    if (JSON.stringify(newSettings) === JSON.stringify(prevSettingsRef.current)) {
        return; // No actual change, so don't trigger save.
    }

    if (releasesPerPageError) {
      setSaveStatus('idle');
      return;
    }
    
    setHasChanged(true);
    setSaveStatus('waiting');
    
    const handler = setTimeout(async () => {
        setSaveStatus('saving');
        const result = await updateRepositorySettingsAction(repoId, newSettings);

        if (result.success) {
            setSaveStatus('success');
            // Update the ref to the newly saved settings.
            prevSettingsRef.current = newSettings;
        } else {
            setSaveStatus('error');
            toast({
              title: t('toast_error_title'),
              description: result.error,
              variant: 'destructive',
            });
        }
    }, 1500); // 1.5-second debounce delay

    return () => clearTimeout(handler);
  }, [newSettings, repoId, isOpen, releasesPerPageError, toast]);


  const handleChannelChange = (channel: ReleaseChannel) => {
    // If we're currently using global settings, the first change
    // should copy the global state to be the new local state.
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
    
    // If we are inheriting global channels and the user just checked 'prerelease',
    // also inherit the global pre-release sub-channel settings.
    if (useGlobalChannels && useGlobalSubChannels && channel === 'prerelease' && newChannels.includes('prerelease')) {
      setPreReleaseSubChannels(globalSettings.preReleaseSubChannels || allPreReleaseTypes);
    }
  };

  const handlePreReleaseSubChannelChange = (subChannel: PreReleaseChannelType) => {
    // If we're currently using global sub-channel settings, the first change
    // should copy the global state to be the new local state.
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
    if (!open && hasChanged) {
        // Trigger revalidation only when dialog closes and there were changes
        revalidateReleasesAction();
    }
  }

  const handleResetChannels = () => {
    setChannels([]);
    setPreReleaseSubChannels([]);
  }

  const handleResetReleasesPerPage = () => {
    setReleasesPerPage('');
  }

  const handleResetAll = () => {
    handleResetChannels();
    handleResetReleasesPerPage();
  }

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
        
        <div className="space-y-4 pt-4">
          <div className="space-y-4 p-4 border rounded-md">
            <div className="flex justify-between items-center">
              <h4 className="font-semibold text-base">{tGlobal('release_channel_title')}</h4>
              <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={handleResetChannels} className="size-8 shrink-0">
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
                max={100}
                placeholder={t('releases_per_page_placeholder', { count: globalSettings.releasesPerPage })}
                className={cn(!!releasesPerPageError && 'border-destructive focus-visible:ring-destructive')}
              />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={handleResetReleasesPerPage} className="size-8 shrink-0">
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
                <p className="mt-2 text-sm text-destructive">{tGlobal('releases_per_page_error_max')}</p>
            ) : null }
          </div>

          <div className="pt-2 space-y-2">
            <AlertDialog>
                <AlertDialogTrigger asChild disabled={isUsingAllGlobalSettings}>
                <Button variant="outline" className="w-full">
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
            <div className="flex h-5 items-center justify-end">
                <SaveStatusIndicator status={saveStatus} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
