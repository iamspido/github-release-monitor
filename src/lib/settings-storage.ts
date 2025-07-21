
'use server';

import { promises as fs } from 'fs';
import path from 'path';
import type { AppSettings } from '@/types';
import { allPreReleaseTypes } from '@/types';

const dataFilePath = path.join(process.cwd(), 'data', 'settings.json');
const dataDirPath = path.dirname(dataFilePath);

const defaultSettings: AppSettings = {
  timeFormat: '24h',
  locale: 'en',
  refreshInterval: 10, // in minutes
  cacheInterval: 5, // in minutes
  releasesPerPage: 30, // GitHub API default
  releaseChannels: ['stable'],
  preReleaseSubChannels: allPreReleaseTypes,
  showAcknowledge: true,
  showMarkAsNew: true,
  includeRegex: undefined,
  excludeRegex: undefined,
  appriseMaxCharacters: 1800,
};

async function ensureDataFileExists() {
  try {
    await fs.mkdir(dataDirPath, { recursive: true });
    await fs.access(dataFilePath);
  } catch {
    await fs.writeFile(dataFilePath, JSON.stringify(defaultSettings, null, 2), 'utf8');
    console.log(`Created settings data file at: ${dataFilePath}`);
  }
}

export async function getSettings(): Promise<AppSettings> {
  await ensureDataFileExists();
  try {
    const fileContent = await fs.readFile(dataFilePath, 'utf8');
    const data = JSON.parse(fileContent);
    
    // Merge with defaults to ensure all keys are present, especially after an update
    return { ...defaultSettings, ...data };
  } catch (error) {
    console.error('Error reading or parsing settings.json:', error);
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureDataFileExists();
  try {
    const fileContent = JSON.stringify(settings, null, 2);
    await fs.writeFile(dataFilePath, fileContent, 'utf8');
  } catch (error) {
    console.error('Error writing to settings.json:', error);
    throw new Error('Could not save settings data.');
  }
}
