# Agent Notes

## Git Commits

Always use an English commit title and an English commit description for Git commits. Do not create title-only commits.

## Build / Lint / Test (Docker)

Prefer Docker for lint/typecheck/tests. Avoid running `node`/`npm` directly on the host unless explicitly requested (some environments may have snap/permission issues).

- `docker build -f ./docker/Dockerfile --target lint --progress=plain .`
- `docker build -f ./docker/Dockerfile --target typecheck --progress=plain .`
- `docker build -f ./docker/Dockerfile --target tester --progress=plain .`
- `docker build -f ./docker/Dockerfile --target coverage -t grm-coverage --progress=plain .`
- `docker build -f ./docker/Dockerfile --target runner -t github-release-monitor:dev --progress=plain .`

### E2E Tests

Never run the complete E2E test suite unless the user explicitly requests it. By default, always select only the smallest set of Playwright spec files or individual tests relevant to the current change. In particular, do not build the `e2e` target without setting `PW_TESTS` unless a complete E2E run was explicitly requested.

- Targeted spec example: `docker build -f ./docker/Dockerfile --target e2e --build-arg PW_TESTS="tests/e2e/relevant-feature.spec.ts" -t grm-e2e --progress=plain .`
- Multiple relevant specs may be passed through `PW_TESTS`, but unrelated E2E specs must not be included.

## Dependencies / Lockfile (Docker)

### Regenerate Lockfile

Use this to regenerate `package-lock.json` in a clean Node 24 Alpine container without host `npm`.
- `rm -f package-lock.json && docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/app -w /app node:24-alpine npm i --package-lock-only --no-audit --no-fund`

### Check Outdated Packages

Use this to check for outdated packages in a temporary container setup.
- `docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/app -w /app node:24-alpine sh -c "npm ci --ignore-scripts --no-audit --no-fund && npm outdated && rm -rf node_modules"`

## Translations

The agent must author translations directly and locally. Do not use external
translation services, translation APIs, or third-party translation tools, and
do not upload or send repository message catalogs to them.

## Project Structure for Codex Navigation

- `/src`: Next.js application source
  - `/app`: App Router routes, server actions, and route handlers
    - `/[locale]`: Localized routes (home, settings, test, login, register)
    - `/api`: Route handlers for authentication, login, setup, and locale settings
    - `/auth` and `/settings`: Server Actions for authentication and application settings
  - `/components`: React components (UI, dialogs, forms, client helpers)
  - `/hooks`: Client hooks (network status, toast helpers, etc.)
  - `/i18n`: i18n routing + request configuration
  - `/lib`: Server-side domain modules and shared helpers
    - `/auth`: Better Auth config, database setup, access/mode helpers, account/session actions, setup/social login helpers
    - `/diagnostics`: Provider token/rate-limit checks plus protected notification-secret reveal flows
    - `/http`: Shared HTTP response timeout helpers
    - `/import`: Import services such as Compose/GHCR preview handling
    - `/notifications`: Apprise/email notification sending and release email rendering
    - `/proxy`: Locale routing, locale settings, and security-header helpers used by `src/proxy.ts`
    - `/releases`: Release provider fetchers, filtering, caching, and release checking
    - `/repositories`: Repository parsing, provider resolution, mutations, and repository action services
    - `/runtime`: Background workers, scheduled tasks, repository schedules, update checks, and task scheduler
    - `/settings`: Settings form models, change detection, schedule fields, and update commands
    - `/storage`: JSON-backed repository/settings/status/job persistence
    - Root utilities remain for small shared helpers such as logging, release sorting, security release detection, and server action errors
  - `/messages`: One translation dictionary per registered locale
  - `/types`: Shared TypeScript types used across server/client
  - `proxy.ts`: Middleware-style routing/auth/security headers logic
- `/tests`: Test suite
  - `/unit`: Vitest unit tests
    - `/app`: Tests for public app routes, route handlers, settings actions, and the `src/app/actions.ts` Server Action facade
    - `/auth`: Tests for auth actions and settings-action auth behavior
    - `/components`: React component unit tests
    - `/helpers`: Shared unit-test helpers
    - `/hooks`: Client hook unit tests
    - `/i18n`: Routing, request config, and message completeness tests
    - `/lib`: Tests for root utilities plus domain subfolders mirroring `src/lib` where useful (`auth`, `diagnostics`, `http`, `import`, `notifications`, `releases`, `repositories`, `runtime`, `settings`, `storage`)
  - `/e2e`: Playwright end-to-end tests
    - `/fixtures`: E2E fixture data and helpers
    - `/utils`: Shared E2E utilities
- `/docker`: Docker build definitions (multi-stage targets used above)
- `/example`: Example docker-compose / deployment configs
- `/public`: Static assets served by Next.js
- `/data`: Runtime state (created at runtime; e.g. `data/repositories.json`, settings/system status)
