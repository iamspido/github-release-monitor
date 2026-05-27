# Agent Notes

## Build / Lint / Test (Docker)

Prefer Docker for lint/typecheck/tests. Avoid running `node`/`npm` directly on the host unless explicitly requested (some environments may have snap/permission issues).

- `docker build -f ./docker/Dockerfile --target lint --progress=plain .`
- `docker build -f ./docker/Dockerfile --target typecheck --progress=plain .`
- `docker build -f ./docker/Dockerfile --target tester --progress=plain .`
- `docker build -f ./docker/Dockerfile --target coverage -t grm-coverage --progress=plain .`
- `docker build -f ./docker/Dockerfile --target e2e -t grm-e2e --progress=plain .`
- `docker build -f ./docker/Dockerfile --target runner -t github-release-monitor:dev --progress=plain .`

## Dependencies / Lockfile (Docker)

### Regenerate Lockfile

Use this to regenerate `package-lock.json` in a clean Node 24 Alpine container without host `npm`.
- `rm -f package-lock.json && docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/app -w /app node:24-alpine npm i --package-lock-only --no-audit --no-fund`

### Check Outdated Packages

Use this to check for outdated packages in a temporary container setup.
- `docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/app -w /app node:24-alpine sh -c "npm ci --ignore-scripts --no-audit --no-fund && npm outdated && rm -rf node_modules"`

## Project Structure for Codex Navigation

- `/src`: Next.js application source
  - `/app`: App Router routes, server actions, and route handlers
    - `/[locale]`: Localized routes (home, settings, test, login)
    - `/api`: Route handlers (server endpoints used by the UI/middleware)
  - `/components`: React components (UI, dialogs, forms, client helpers)
  - `/hooks`: Client hooks (network status, toast helpers, etc.)
  - `/i18n`: i18n routing + request configuration
  - `/lib`: Server-side domain modules and shared helpers
    - `/auth`: Better Auth config, database setup, access/mode helpers, account/session actions, setup/social login helpers
    - `/diagnostics`: Provider token checks and rate-limit diagnostics
    - `/import`: Import services such as Compose/GHCR preview handling
    - `/notifications`: Apprise/email notification sending and release email rendering
    - `/releases`: Release provider fetchers, filtering, caching, and release checking
    - `/repositories`: Repository parsing, provider resolution, mutations, and repository action services
    - `/runtime`: Background workers, scheduled tasks, repository schedules, update checks, and task scheduler
    - `/storage`: JSON-backed repository/settings/status/job persistence
    - Root utilities remain for small shared helpers such as logging, release sorting, security release detection, and server action errors
  - `/messages`: Translation dictionaries (`en.json`, `de.json`)
  - `/types`: Shared TypeScript types used across server/client
  - `proxy.ts`: Middleware-style routing/auth/security headers logic
- `/tests`: Test suite
  - `/unit`: Vitest unit tests
    - `/app`: Tests for public app routes, route handlers, settings actions, and the `src/app/actions.ts` Server Action facade
    - `/auth`: Tests for auth actions and settings-action auth behavior
    - `/components`: React component unit tests
    - `/hooks`: Client hook unit tests
    - `/i18n`: Routing, request config, and message completeness tests
    - `/lib`: Tests for root utilities plus domain subfolders mirroring `src/lib` where useful (`auth`, `notifications`, `runtime`, `storage`)
  - `/e2e`: Playwright end-to-end tests
    - `/fixtures`: E2E fixture data and helpers
    - `/utils`: Shared E2E utilities
- `/docker`: Docker build definitions (multi-stage targets used above)
- `/example`: Example docker-compose / deployment configs
- `/public`: Static assets served by Next.js
- `/data`: Runtime state (created at runtime; e.g. `data/repositories.json`, settings/system status)
