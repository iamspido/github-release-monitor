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

export async function updateSettingsAction(newSettings: AppSettings) {
  return scheduleTask('updateSettingsAction', async () => {
    try {
      const currentSettings = await getSettings();

    // If the "mark as seen" feature is being disabled, reset all isNew flags.
    if (currentSettings.showAcknowledge && newSettings.showAcknowledge === false) {
      console.log(`[${new Date().toLocaleString()}] Disabling 'Mark as seen' feature. Resetting all 'isNew' flags to false.`);
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

    // If regex changed globally, clear ETags so next fetch doesn't short-circuit on 304
    if (regexChanged || channelsChanged || preSubsChanged || rppChanged) {
      const allRepos = await getRepositories();
      const cleared = allRepos.map(r => ({ ...r, etag: undefined }));
      await saveRepositories(cleared);
    }

    await saveSettings(settingsToSave);
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
    console.error('Failed to save settings:', error);
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
            console.error('Failed to delete all repositories:', error);
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
