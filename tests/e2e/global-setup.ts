import type { FullConfig } from '@playwright/test';

function resolveBaseUrl(config: FullConfig): string {
  const projectBaseUrl = config.projects[0]?.use?.baseURL;
  if (typeof projectBaseUrl === 'string' && projectBaseUrl.length > 0) {
    return projectBaseUrl;
  }
  return process.env.BASE_URL || 'http://localhost:3000';
}

export default async function globalSetup(config: FullConfig) {
  const baseUrl = resolveBaseUrl(config);
  const setupToken = process.env.AUTH_SETUP_TOKEN || 'y'.repeat(64);
  const authEmail =
    process.env.AUTH_EMAIL || process.env.AUTH_USERNAME || 'test@example.com';
  const authUsername =
    process.env.AUTH_USERNAME || authEmail.split('@')[0] || 'testadmin';
  const authPassword = process.env.AUTH_PASSWORD || 'TestPassword123';

  const setupStatusResponse = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'GET',
    headers: { 'cache-control': 'no-store' },
  });

  if (setupStatusResponse.status === 404) {
    return;
  }

  if (!setupStatusResponse.ok) {
    throw new Error(
      `Failed to check setup status: GET /api/auth/setup returned ${setupStatusResponse.status}`,
    );
  }

  const setupResponse = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: setupToken,
      email: authEmail,
      password: authPassword,
      name: 'E2E Admin',
      username: authUsername,
    }),
  });

  if (setupResponse.status === 201 || setupResponse.status === 404) {
    return;
  }

  let payload = '';
  try {
    payload = await setupResponse.text();
  } catch {
    payload = '';
  }

  throw new Error(
    `Failed to run initial setup: POST /api/auth/setup returned ${setupResponse.status}${payload ? ` (${payload})` : ''}`,
  );
}
