
'use server';

import { promises as fs } from 'fs';
import path from 'path';
import type { Repository } from '@/types';

// Resolve the path to the data file.
// Using process.cwd() ensures the path is correct whether running in dev or prod.
const dataFilePath = path.join(process.cwd(), 'data', 'repositories.json');
const dataDirPath = path.dirname(dataFilePath);

async function ensureDataFileExists() {
  try {
    // Ensure the directory exists first.
    await fs.mkdir(dataDirPath, { recursive: true });
    // Then check for the file.
    await fs.access(dataFilePath);
  } catch {
    // File doesn't exist, create it with an empty array.
    await fs.writeFile(dataFilePath, JSON.stringify([], null, 2), 'utf8');
    console.log(`Created repository data file at: ${dataFilePath}`);
  }
}

export async function getRepositories(): Promise<Repository[]> {
  await ensureDataFileExists();
  try {
    const fileContent = await fs.readFile(dataFilePath, 'utf8');
    const data = JSON.parse(fileContent) as Repository[];
    return data;
  } catch (error) {
    console.error('Error reading or parsing repositories.json:', error);
    // Return an empty array or throw an error, depending on desired behavior for a corrupted file.
    return [];
  }
}

export async function saveRepositories(repositories: Repository[]): Promise<void> {
  await ensureDataFileExists();
  try {
    const fileContent = JSON.stringify(repositories, null, 2);
    await fs.writeFile(dataFilePath, fileContent, 'utf8');
  } catch (error: any) {
    console.error('Error writing to repositories.json:', error);
    // Throw a more specific error that can be caught by the server action
    throw new Error(`Failed to write to repository file. Please check file permissions. Server Error: ${error.code || error.message}`);
  }
}
