// Global test setup executed before test files
// Ensure a strong AUTH_SECRET is present to avoid noisy logs during imports
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
  process.env.AUTH_SECRET = 'x'.repeat(64);
}

// Common envs that are safe for tests
process.env.NEXT_TELEMETRY_DISABLED = '1';

