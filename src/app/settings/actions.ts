'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { getRequestLocale } from '@/lib/request-locale';
import type { AppSettings } from '@/types';
import { getSettings, saveSettings } from '@/lib/settings-storage';
import { getRepositories, saveRepositories } from '@/lib/repository-storage';
import { cookies } from 'next/headers';
import { checkForNewReleases } from '@/app/actions';
import { scheduleTask } from '@/lib/task-scheduler';
import { logger } from '@/lib/logger';

export async function updateSettingsAction(newSettings: AppSettings) {
  return scheduleTask('updateSettingsAction', async () => {
    try {
      const currentSettings = await getSettings();

    // If the "mark as seen" feature is being disabled, reset all isNew flags.
    if (currentSettings.showAcknowledge && newSettings.showAcknowledge === false) {
      logger.withScope('Settings').info(`Disabling 'Mark as seen' feature. Resetting all 'isNew' flags to false.`);
      const allRepos = await getRepositories();
      const updatedRepos = allRepos.map(repo => ({...repo, isNew: false}));
      await saveRepositories(updatedRepos);
    }

    // Detect if regex filters changed (affects local filtering and should bypass ETag once)
    const prevInclude = (currentSettings.includeRegex ?? '').trim() || undefined;
    const prevExclude = (currentSettings.excludeRegex ?? '').trim() || undefined;
    const nextInclude = (newSettings.includeRegex ?? '').trim() || undefined;
    const nextExclude = (newSettings.excludeRegex ?? '').trim() || undefined;
    const regexChanged = prevInclude !== nextInclude || prevExclude !== nextExclude;

    // Compare arrays ignoring order
    const normArray = <T,>(arr?: T[] | null) => {
      if (!arr || arr.length === 0) return [] as T[];
      return [...arr].sort();
    };
    const channelsChanged = JSON.stringify(normArray(currentSettings.releaseChannels)) !== JSON.stringify(normArray(newSettings.releaseChannels));
    const preSubsChanged = JSON.stringify(normArray(currentSettings.preReleaseSubChannels)) !== JSON.stringify(normArray(newSettings.preReleaseSubChannels));
    const rppChanged = currentSettings.releasesPerPage !== newSettings.releasesPerPage;

    // Ensure refreshInterval is at least 1
    const settingsToSave = {
        ...newSettings,
        refreshInterval: Math.max(1, newSettings.refreshInterval),
        includeRegex: newSettings.includeRegex?.trim() || undefined,
        excludeRegex: newSettings.excludeRegex?.trim() || undefined,
        appriseTags: newSettings.appriseTags?.trim() || undefined,
    };

    // Compute a concise diff of global settings
    const oldS = currentSettings;
    const newS = settingsToSave;
    const changes: string[] = [];
    const fmt = (v: any) => v === undefined ? 'undefined' : Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(v);
    const cmpArr = (a?: any[] | null, b?: any[] | null) => JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort());
    const pushIf = (label: string, a: any, b: any, arrCmp = false) => {
      const equal = arrCmp ? cmpArr(a, b) : a === b;
      if (!equal) changes.push(`${label}: ${fmt(a)} -> ${fmt(b)}`);
    };
    pushIf('timeFormat', oldS.timeFormat, newS.timeFormat);
    pushIf('locale', oldS.locale, newS.locale);
    pushIf('refreshInterval', oldS.refreshInterval, newS.refreshInterval);
    pushIf('cacheInterval', oldS.cacheInterval, newS.cacheInterval);
    pushIf('releasesPerPage', oldS.releasesPerPage, newS.releasesPerPage);
    pushIf('releaseChannels', oldS.releaseChannels, newS.releaseChannels, true);
    pushIf('preReleaseSubChannels', oldS.preReleaseSubChannels, newS.preReleaseSubChannels, true);
    pushIf('showAcknowledge', oldS.showAcknowledge, newS.showAcknowledge);
    pushIf('showMarkAsNew', oldS.showMarkAsNew, newS.showMarkAsNew);
    pushIf('includeRegex', oldS.includeRegex, newS.includeRegex);
    pushIf('excludeRegex', oldS.excludeRegex, newS.excludeRegex);
    pushIf('appriseMaxCharacters', oldS.appriseMaxCharacters, newS.appriseMaxCharacters);
    pushIf('appriseTags', oldS.appriseTags, newS.appriseTags);
    pushIf('appriseFormat', oldS.appriseFormat, newS.appriseFormat);

    // If regex changed globally, clear ETags so next fetch doesn't short-circuit on 304
    if (regexChanged || channelsChanged || preSubsChanged || rppChanged) {
      const allRepos = await getRepositories();
      const cleared = allRepos.map(r => ({ ...r, etag: undefined }));
      await saveRepositories(cleared);
      const reasons: string[] = [];
      if (regexChanged) reasons.push('regexChanged');
      if (channelsChanged) reasons.push('releaseChannelsChanged');
      if (preSubsChanged) reasons.push('preReleaseSubChannelsChanged');
      if (rppChanged) reasons.push('releasesPerPageChanged');
      logger.withScope('Settings').info(`Cleared ETags for all repositories due to: ${reasons.join(', ')}`);
    }

    await saveSettings(settingsToSave);
    if (changes.length > 0) {
      logger.withScope('Settings').info(`Global settings updated: ${changes.join('; ')}`);
    } else {
      logger.withScope('Settings').info('Global settings saved (no changes).');
    }
    checkForNewReleases({ skipCache: true });

    // Set the locale cookie for next-intl middleware to pick up.
    // This is now done on every save, not just on change, to ensure consistency.
    const cookieStore = await cookies();
    cookieStore.set('NEXT_LOCALE', newSettings.locale, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 1 year
        sameSite: 'lax',
    });


    revalidatePath('/');
    revalidatePath('/settings');

    const t = await getTranslations({
      locale: newSettings.locale,
      namespace: 'SettingsForm',
    });
    return {
      success: true,
      message: {
        title: t('toast_success_title'),
        description: t('toast_success_description'),
      },
    };
  } catch (error) {
    logger.withScope('Settings').error('Failed to save settings:', error);
    const t = await getTranslations({
      locale: newSettings.locale,
      namespace: 'SettingsForm',
    });
    return {
      success: false,
      message: {
        title: t('toast_error_title'),
        description: t('toast_error_description'),
      },
    };
  }
  });
}

export async function deleteAllRepositoriesAction() {
    return scheduleTask('deleteAllRepositoriesAction', async () => {
        try {
            await saveRepositories([]);
            logger.withScope('Settings').info('Deleted all repositories.');
            revalidatePath('/');

            const locale = await getRequestLocale();
            const t = await getTranslations({
                locale: locale,
                namespace: 'SettingsForm'
            });
            return {
                success: true,
                message: {
                    title: t('toast_delete_all_success_title'),
                    description: t('toast_delete_all_success_description'),
                }
            };
        } catch (error: any) {
            logger.withScope('Settings').error('Failed to delete all repositories:', error);
            const locale = await getRequestLocale();
            const t = await getTranslations({
                locale: locale,
                namespace: 'SettingsForm'
            });
            return {
                success: false,
                message: {
                    title: t('toast_error_title'),
                    description: error.message || t('toast_delete_all_error_description'),
                }
            };
        }
    });
}
