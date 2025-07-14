
'use client';

import * as React from 'react';
import { Loader2, Save, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AppSettings, TimeFormat, Locale, ReleaseChannel, PreReleaseChannelType } from '@/types';
import { allPreReleaseTypes } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { updateSettingsAction, deleteAllRepositoriesAction } from '@/app/settings/actions';
import { usePathname, useRouter } from '@/navigation';
import { cn } from '@/lib/utils';
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

const MINUTES_IN_DAY = 24 * 60;
const MINUTES_IN_HOUR = 60;
// Security: Prevents unrealistically high values (approx. 10 years)
const MAX_INTERVAL_MINUTES = 5256000;

// Helper to convert total minutes into days, hours, minutes
function minutesToDhms(totalMinutes: number) {
    const d = Math.floor(totalMinutes / MINUTES_IN_DAY);
    const h = Math.floor((totalMinutes % MINUTES_IN_DAY) / MINUTES_IN_HOUR);
    const m = totalMinutes % MINUTES_IN_HOUR;
    return { d, h, m };
}

type SaveStatus = 'idle' | 'waiting' | 'saving' | 'success' | 'error';
type IntervalValidationError = 'too_low' | 'too_high' | null;
type ReleasesPerPageError = 'too_low' | 'too_high' | null;

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
    const t = useTranslations('SettingsForm');

    if (status === 'idle') {
        return null;
    }

    const messages: Record<SaveStatus, { text: React.ReactNode; icon: React.ReactNode; className: string }> = {
        idle: { text: '', icon: null, className: '' },
        waiting: { text: t('autosave_waiting'), icon: <Save className="size-4" />, className: 'text-muted-foreground' },
        saving: { text: t('autosave_saving'), icon: <Loader2 className="size-4 animate-spin" />, className: 'text-muted-foreground' },
        success: { 
            text: t('autosave_success'),
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

interface SettingsFormProps {
  currentSettings: AppSettings;
}

export function SettingsForm({ currentSettings }: SettingsFormProps) {
  const t = useTranslations('SettingsForm');
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  // Component State
  const [timeFormat, setTimeFormat] = React.useState<TimeFormat>(currentSettings.timeFormat);
  const [locale, setLocale] = React.useState<Locale>(currentSettings.locale);
  const [releasesPerPage, setReleasesPerPage] = React.useState(String(currentSettings.releasesPerPage || 30));
  const [channels, setChannels] = React.useState<ReleaseChannel[]>(currentSettings.releaseChannels || ['stable']);
  const [preReleaseSubChannels, setPreReleaseSubChannels] = React.useState<PreReleaseChannelType[]>(currentSettings.preReleaseSubChannels || allPreReleaseTypes);
  const [showAcknowledge, setShowAcknowledge] = React.useState<boolean>(currentSettings.showAcknowledge ?? true);
  const [showMarkAsNew, setShowMarkAsNew] = React.useState<boolean>(currentSettings.showMarkAsNew ?? true);
  
  const [days, setDays] = React.useState(() => String(minutesToDhms(currentSettings.refreshInterval).d));
  const [hours, setHours] = React.useState(() => String(minutesToDhms(currentSettings.refreshInterval).h));
  const [minutes, setMinutes] = React.useState(() => String(minutesToDhms(currentSettings.refreshInterval).m));
  
  const [cacheDays, setCacheDays] = React.useState(() => String(minutesToDhms(currentSettings.cacheInterval).d));
  const [cacheHours, setCacheHours] = React.useState(() => String(minutesToDhms(currentSettings.cacheInterval).h));
  const [cacheMinutes, setCacheMinutes] = React.useState(() => String(minutesToDhms(currentSettings.cacheInterval).m));

  // Validation State
  const [intervalError, setIntervalError] = React.useState<IntervalValidationError>(null);
  const [releasesPerPageError, setReleasesPerPageError] = React.useState<ReleasesPerPageError>(null);
  const [isCacheInvalid, setIsCacheInvalid] = React.useState(false);

  // Autosave State
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle');
  const isInitialMount = React.useRef(true);
  
  // Deletion State
  const [isDeleting, startDeleteTransition] = React.useTransition();

  // Derived state for the settings object
  const newSettings: AppSettings = React.useMemo(() => {
    const d = parseInt(days, 10) || 0;
    const h = parseInt(hours, 10) || 0;
    const m = parseInt(minutes, 10) || 0;
    const totalMinutes = (d * MINUTES_IN_DAY) + (h * MINUTES_IN_HOUR) + m;

    const dCache = parseInt(cacheDays, 10) || 0;
    const hCache = parseInt(cacheHours, 10) || 0;
    const mCache = parseInt(cacheMinutes, 10) || 0;
    const totalCacheMinutes = (dCache * MINUTES_IN_DAY) + (hCache * MINUTES_IN_HOUR) + mCache;
    
    return {
      timeFormat,
      locale,
      refreshInterval: totalMinutes,
      cacheInterval: totalCacheMinutes,
      releasesPerPage: parseInt(releasesPerPage, 10) || 30,
      releaseChannels: channels,
      preReleaseSubChannels,
      showAcknowledge,
      showMarkAsNew,
    };
  }, [days, hours, minutes, cacheDays, cacheHours, cacheMinutes, releasesPerPage, timeFormat, locale, channels, preReleaseSubChannels, showAcknowledge, showMarkAsNew]);
  
  // Effect for validation
  React.useEffect(() => {
    const refreshFieldsFilled = days !== '' && hours !== '' && minutes !== '';
    const cacheFieldsFilled = cacheDays !== '' && cacheHours !== '' && cacheMinutes !== '';
    const releasesPerPageFilled = releasesPerPage !== '';

    if (refreshFieldsFilled) {
        if (newSettings.refreshInterval < 1) {
            setIntervalError('too_low');
        } else if (newSettings.refreshInterval > MAX_INTERVAL_MINUTES) {
            setIntervalError('too_high');
        } else {
            setIntervalError(null);
        }
    } else {
        setIntervalError(null);
    }

    if (releasesPerPageFilled) {
        const numReleases = parseInt(releasesPerPage, 10);
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
    

    // Rule 2: Cache interval must not be greater than refresh interval (if cache > 0)
    const isCacheEnabled = newSettings.cacheInterval > 0;
    const cacheIsLarger = newSettings.cacheInterval > newSettings.refreshInterval;
    setIsCacheInvalid(refreshFieldsFilled && cacheFieldsFilled && isCacheEnabled && cacheIsLarger);
    
  }, [days, hours, minutes, cacheDays, cacheHours, cacheMinutes, releasesPerPage, newSettings.refreshInterval, newSettings.cacheInterval]);


  // Effect for debounced autosaving
  React.useEffect(() => {
    if (isInitialMount.current) {
        isInitialMount.current = false;
        return;
    }

    const hasEmptyFields = [days, hours, minutes, cacheDays, cacheHours, cacheMinutes, releasesPerPage].some(val => val === '');
    if (hasEmptyFields || intervalError || isCacheInvalid || releasesPerPageError) {
        setSaveStatus('idle');
        return; // Don't proceed to save if fields are empty or invalid
    }

    // Settings have changed, waiting to save.
    setSaveStatus('waiting');
    
    const handler = setTimeout(async () => {
        setSaveStatus('saving');
        const result = await updateSettingsAction(newSettings);

        if (result.success) {
            setSaveStatus('success');
            toast({
              title: result.message.title,
              description: result.message.description,
            });
            if (newSettings.locale !== currentSettings.locale) {
                router.push(pathname, { locale: newSettings.locale });
            }
        } else {
            setSaveStatus('error');
            toast({
              title: result.message.title,
              description: result.message.description,
              variant: 'destructive',
            });
        }
    }, 1500); // 1.5-second debounce delay

    return () => {
        clearTimeout(handler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSettings, days, hours, minutes, cacheDays, cacheHours, cacheMinutes, releasesPerPage, intervalError, isCacheInvalid, releasesPerPageError]);


  const handleChannelChange = (channel: ReleaseChannel) => {
    const newChannels = channels.includes(channel)
      ? channels.filter(c => c !== channel)
      : [...channels, channel];

    if (newChannels.length === 0) {
      toast({
        title: t('toast_error_title'),
        description: t('release_channel_error_at_least_one'),
        variant: 'destructive',
      });
      return;
    }
    setChannels(newChannels);
    
    // If 'prerelease' is newly checked, enable all sub-channels by default.
    if (channel === 'prerelease' && newChannels.includes('prerelease')) {
      setPreReleaseSubChannels(allPreReleaseTypes);
    }
  };

  const handlePreReleaseSubChannelChange = (subChannel: PreReleaseChannelType) => {
    setPreReleaseSubChannels(prev => 
      prev.includes(subChannel) 
        ? prev.filter(sc => sc !== subChannel) 
        : [...prev, subChannel]
    );
  };

  const isPreReleaseChecked = channels.includes('prerelease');

  const handleDeleteAll = () => {
    startDeleteTransition(async () => {
      const result = await deleteAllRepositoriesAction();
      toast({
        title: result.message.title,
        description: result.message.description,
        variant: result.success ? 'default' : 'destructive',
      });
      if (result.success) {
        router.push('/');
      }
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="break-words">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{t('time_format_label')}</Label>
            <RadioGroup
              value={timeFormat}
              onValueChange={(value: TimeFormat) => setTimeFormat(value)}
              className="flex items-center gap-4"
              disabled={saveStatus === 'saving'}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="12h" id="r1" />
                <Label htmlFor="r1">{t('time_format_12h')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="24h" id="r2" />
                <Label htmlFor="r2">{t('time_format_24h')}</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="language-select">{t('language_label')}</Label>
            <Select
              value={locale}
              onValueChange={(value: Locale) => setLocale(value)}
              disabled={saveStatus === 'saving'}
            >
              <SelectTrigger id="language-select" className="w-full sm:w-[180px]">
                <SelectValue placeholder={t('language_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t('language_en')}</SelectItem>
                <SelectItem value="de">{t('language_de')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-4 pt-2">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="showAcknowledge"
                  checked={showAcknowledge}
                  onCheckedChange={(checked) => setShowAcknowledge(Boolean(checked))}
                  disabled={saveStatus === 'saving'}
                  className="mt-1"
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="showAcknowledge" className="font-medium cursor-pointer">{t('show_acknowledge_title')}</Label>
                  <p className="text-sm text-muted-foreground">{t('show_acknowledge_description')}</p>
                </div>
              </div>
              <div className={cn(
                  "ml-6 pl-3 border-l-2 transition-all duration-300 ease-in-out overflow-hidden",
                  showAcknowledge ? 'mt-4 max-h-96 opacity-100' : 'max-h-0 opacity-0'
              )}>
                  <div className="flex items-start space-x-3">
                     <Checkbox
                        id="showMarkAsNew"
                        checked={showMarkAsNew}
                        onCheckedChange={(checked) => setShowMarkAsNew(Boolean(checked))}
                        disabled={saveStatus === 'saving' || !showAcknowledge}
                        className="mt-1"
                      />
                      <div className="grid gap-1.5 leading-none">
                        <Label htmlFor="showMarkAsNew" className="font-medium cursor-pointer">{t('show_mark_as_new_title')}</Label>
                        <p className="text-sm text-muted-foreground">{t('show_mark_as_new_description')}</p>
                      </div>
                  </div>
              </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>{t('release_channel_title')}</CardTitle>
          <CardDescription>{t('release_channel_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="stable"
                checked={channels.includes('stable')}
                onCheckedChange={() => handleChannelChange('stable')}
                disabled={saveStatus === 'saving'}
              />
              <Label htmlFor="stable" className="font-normal cursor-pointer">{t('release_channel_stable')}</Label>
            </div>

            {/* Pre-release Section with sub-options */}
            <div>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="prerelease"
                        checked={isPreReleaseChecked}
                        onCheckedChange={() => handleChannelChange('prerelease')}
                        disabled={saveStatus === 'saving'}
                    />
                    <Label htmlFor="prerelease" className="font-normal cursor-pointer">{t('release_channel_prerelease')}</Label>
                </div>
                
                <div className={cn(
                    "ml-6 pl-3 border-l-2 transition-all duration-300 ease-in-out overflow-hidden",
                    isPreReleaseChecked ? 'mt-4 max-h-96 opacity-100' : 'max-h-0 opacity-0'
                )}>
                    <div className="pb-2 space-y-3">
                        <p className="text-sm text-muted-foreground">{t('prerelease_subtype_description')}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-3">
                            {allPreReleaseTypes.map((subType) => (
                                <div key={subType} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`prerelease-${subType}`}
                                        checked={preReleaseSubChannels.includes(subType)}
                                        onCheckedChange={() => handlePreReleaseSubChannelChange(subType)}
                                        disabled={!isPreReleaseChecked || saveStatus === 'saving'}
                                    />
                                    <Label htmlFor={`prerelease-${subType}`} className="font-normal cursor-pointer text-sm">{subType}</Label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="draft"
                checked={channels.includes('draft')}
                onCheckedChange={() => handleChannelChange('draft')}
                disabled={saveStatus === 'saving'}
              />
              <Label htmlFor="draft" className="font-normal cursor-pointer">{t('release_channel_draft')}</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="break-words">{t('automation_settings_title')}</CardTitle>
          <CardDescription>{t('automation_settings_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label>{t('refresh_interval_title')}</Label>
            <div className="grid grid-cols-3 gap-4 mt-2">
                <div className="space-y-2">
                  <Label htmlFor="interval-minutes">{t('refresh_interval_minutes_label')}</Label>
                  <Input
                    id="interval-minutes"
                    type="number"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                    min={0}
                    max={59}
                    disabled={saveStatus === 'saving'}
                    className={cn(!!intervalError && 'border-destructive focus-visible:ring-destructive')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="interval-hours">{t('refresh_interval_hours_label')}</Label>
                  <Input
                    id="interval-hours"
                    type="number"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    min={0}
                    max={23}
                    disabled={saveStatus === 'saving'}
                    className={cn(!!intervalError && 'border-destructive focus-visible:ring-destructive')}
                  />
                </div>
              <div className="space-y-2">
                  <Label htmlFor="interval-days">{t('refresh_interval_days_label')}</Label>
                  <Input
                    id="interval-days"
                    type="number"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    min={0}
                    max={3650}
                    disabled={saveStatus === 'saving'}
                    className={cn(!!intervalError && 'border-destructive focus-visible:ring-destructive')}
                  />
                </div>
              </div>
              {intervalError === 'too_low' ? (
                  <p className="mt-2 text-sm text-destructive">{t('refresh_interval_error_min')}</p>
              ) : intervalError === 'too_high' ? (
                  <p className="mt-2 text-sm text-destructive">{t('refresh_interval_error_max')}</p>
              ) : (
                  <p className="mt-2 text-xs text-muted-foreground">{t('refresh_interval_hint')}</p>
              )}
          </div>
          <div>
            <Label htmlFor="releases-per-page">{t('releases_per_page_label')}</Label>
            <Input
              id="releases-per-page"
              type="number"
              value={releasesPerPage}
              onChange={(e) => setReleasesPerPage(e.target.value)}
              min={1}
              max={100}
              disabled={saveStatus === 'saving'}
              className={cn("mt-2 w-full sm:w-48", !!releasesPerPageError && 'border-destructive focus-visible:ring-destructive')}
            />
             {releasesPerPageError === 'too_low' ? (
                <p className="mt-2 text-sm text-destructive">{t('releases_per_page_error_min')}</p>
            ) : releasesPerPageError === 'too_high' ? (
                <p className="mt-2 text-sm text-destructive">{t('releases_per_page_error_max')}</p>
            ) : (
                <p className="mt-2 text-xs text-muted-foreground">{t('releases_per_page_hint')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="break-words">{t('cache_settings_title')}</CardTitle>
          <CardDescription>{t('cache_settings_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
               <div className="space-y-2">
                <Label htmlFor="cache-interval-minutes">{t('refresh_interval_minutes_label')}</Label>
                <Input
                  id="cache-interval-minutes"
                  type="number"
                  value={cacheMinutes}
                  onChange={(e) => setCacheMinutes(e.target.value)}
                  min={0}
                  max={59}
                  disabled={saveStatus === 'saving'}
                  className={cn(isCacheInvalid && 'border-destructive focus-visible:ring-destructive')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cache-interval-hours">{t('refresh_interval_hours_label')}</Label>
                <Input
                  id="cache-interval-hours"
                  type="number"
                  value={cacheHours}
                  onChange={(e) => setCacheHours(e.target.value)}
                  min={0}
                  max={23}
                  disabled={saveStatus === 'saving'}
                  className={cn(isCacheInvalid && 'border-destructive focus-visible:ring-destructive')}
                />
              </div>
             <div className="space-y-2">
                <Label htmlFor="cache-interval-days">{t('refresh_interval_days_label')}</Label>
                <Input
                  id="cache-interval-days"
                  type="number"
                  value={cacheDays}
                  onChange={(e) => setCacheDays(e.target.value)}
                  min={0}
                  max={3650}
                  disabled={saveStatus === 'saving'}
                  className={cn(isCacheInvalid && 'border-destructive focus-visible:ring-destructive')}
                />
              </div>
            </div>
             {isCacheInvalid && (
                <p className="mt-2 text-sm text-destructive">{t('cache_validation_error')}</p>
            )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t('danger_zone_title')}</CardTitle>
          <CardDescription className="text-destructive/80">{t('danger_zone_description')}</CardDescription>
        </CardHeader>
        <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={isDeleting}>
                      {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      {t('delete_all_button_text')}
                  </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('delete_all_dialog_title')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('delete_all_dialog_description')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>{t('cancel_button')}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleDeleteAll}
                    disabled={isDeleting}
                  >
                    {isDeleting && <Loader2 className="animate-spin" />}
                    {t('confirm_delete_button')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </CardContent>
      </Card>

      <div className="flex justify-end h-10 items-center">
          <SaveStatusIndicator status={saveStatus} />
      </div>
    </div>
  );
}
