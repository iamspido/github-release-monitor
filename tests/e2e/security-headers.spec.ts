import { test, expect } from '@playwright/test';

test.describe('Security headers', () => {
  const paths = ['/en', '/en/login', '/en/settings'];

  for (const p of paths) {
    test(`headers present on ${p}`, async ({ request, baseURL }) => {
      const url = `${baseURL}${p}`;
      const res = await request.get(url);
      expect(res.status()).toBeLessThan(400);
      const csp = res.headers()['content-security-policy'];
      const xfo = res.headers()['x-frame-options'];
      const ref = res.headers()['referrer-policy'];
      const nosniff = res.headers()['x-content-type-options'];
      const perm = res.headers()['permissions-policy'];
      expect(csp).toBeTruthy();
      expect(xfo).toBe('DENY');
      expect(ref).toBe('no-referrer');
      expect(nosniff).toBe('nosniff');
      expect(perm).toContain('camera=()');
      expect(perm).toContain('microphone=()');
      expect(perm).toContain('geolocation=()');
    });
  }
});
