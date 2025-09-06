import { test, expect } from '@playwright/test';

test('HSTS absent on HTTP, CORP optional', async ({ request, baseURL }) => {
  for (const path of ['/en', '/en/login', '/en/settings']) {
    const res = await request.get(`${baseURL}${path}`);
    expect(res.status()).toBeLessThan(400);
    const hsts = res.headers()['strict-transport-security'];
    const corp = res.headers()['cross-origin-resource-policy'];
    // In this test environment HTTPS=false, so HSTS should not be set
    expect(hsts).toBeUndefined();
    // CORP may or may not be present; if present, ensure it's at least same-site or same-origin
    if (corp) {
      expect(/same-site|same-origin/i.test(corp)).toBeTruthy();
    }
  }
});

