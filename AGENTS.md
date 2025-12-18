# Agent Notes

## Build / Lint / Test (Docker)

Prefer Docker for lint/typecheck/tests. Avoid running `node`/`npm` directly on the host unless explicitly requested (some environments may have snap/permission issues).

- `docker build -f ./docker/Dockerfile --target lint --progress=plain .`
- `docker build -f ./docker/Dockerfile --target typecheck --progress=plain .`
- `docker build -f ./docker/Dockerfile --target tester --progress=plain .`
- `docker build -f ./docker/Dockerfile --target coverage -t grm-coverage --progress=plain .`
- `docker build -f ./docker/Dockerfile --target e2e -t grm-e2e --progress=plain .`
- `docker build -f ./docker/Dockerfile --target runner -t github-release-monitor:dev --progress=plain .`

## Project Structure for Codex Navigation

- `/src`: Next.js application source
  - `/app`: App Router routes, server actions, and route handlers
    - `/[locale]`: Localized routes (home, settings, test, login)
    - `/api`: Route handlers (server endpoints used by the UI/middleware)
  - `/components`: React components (UI, dialogs, forms, client helpers)
  - `/hooks`: Client hooks (network status, toast helpers, etc.)
  - `/i18n`: i18n routing + request configuration
  - `/lib`: Server-side helpers (storage, scheduler, notifications, logging, etc.)
  - `/messages`: Translation dictionaries (`en.json`, `de.json`)
  - `/types`: Shared TypeScript types used across server/client
  - `proxy.ts`: Middleware-style routing/auth/security headers logic
- `/tests`: Test suite
  - `/unit`: Vitest unit tests
  - `/e2e`: Playwright end-to-end tests
- `/docker`: Docker build definitions (multi-stage targets used above)
- `/example`: Example docker-compose / deployment configs
- `/public`: Static assets served by Next.js
- `/data`: Runtime state (created at runtime; e.g. `data/repositories.json`, settings/system status)
