# Build Stage
FROM node:24-alpine AS builder

WORKDIR /app

# Environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy configuration files
COPY components.json \
     next.config.mjs \
     postcss.config.mjs \
     tailwind.config.mjs \
     tsconfig.json \
     ./

# Copy source files
COPY public/ ./public/
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build the application
RUN BETTER_AUTH_SECRET=9f3c7a1e5b8d2f604a9c1e7b3d5f8062c4a8e1b7d9f3056c2e4a8b1d7f9c3e50 \
    BETTER_AUTH_URL=http://localhost:3000 \
    npm run build

# Lint Stage (Biome)
FROM node:24-alpine AS lint

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY biome.json ./
COPY tsconfig.json ./
COPY src/ ./src/
COPY tests/ ./tests/
COPY scripts/ ./scripts/
COPY .github/actions/star-history/ ./.github/actions/star-history/

RUN npm run lint

# Typecheck Stage (only TypeScript)
FROM node:24-alpine AS typecheck

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY tsconfig.json \
     vitest.setup.ts \
     ./
COPY src/ ./src/
COPY tests/ ./tests/

RUN npm run typecheck
RUN npm run typecheck:tests

# Shared unit test stage
FROM node:24-alpine AS test-base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files and install dependencies (uses lockfile)
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Copy config and source
COPY components.json \
     next.config.mjs \
     biome.json \
     postcss.config.mjs \
     tailwind.config.mjs \
     tsconfig.json \
     vitest.config.ts \
     vitest.setup.ts \
     ./

COPY public/ ./public/
COPY src/ ./src/
COPY tests/ ./tests/
COPY .github/actions/star-history/ ./.github/actions/star-history/

# Test Stage (full output for CI and manual runs)
FROM test-base AS tester

RUN npm test -- --reporter=dot
RUN node --test .github/actions/star-history/index.test.js

# Agent Test Stage (only report failed tests and their errors)
FROM test-base AS tester-agent

RUN npm test -- --reporter=minimal
RUN node --test .github/actions/star-history/index.test.js >/tmp/star-history-tests.log \
 || (cat /tmp/star-history-tests.log; exit 1)

# E2E Stage (Playwright)
FROM mcr.microsoft.com/playwright:v1.62.1-resolute AS e2e

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    CI=true \
    HTTPS=false \
    BACKGROUND_POLLING_INITIALIZED=true \
    BETTER_AUTH_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
    BETTER_AUTH_URL=http://localhost:3000 \
    AUTH_SETUP_TOKEN=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy \
    AUTH_EMAIL=test@example.test \
    AUTH_PASSWORD=TestPassword123

# Copy minimal files for running tests and server
COPY package*.json ./
RUN npm install --omit=optional --no-audit --no-fund --production=false \
 && npm cache clean --force

COPY playwright.config.ts ./
COPY tests/e2e ./tests/e2e
COPY src/i18n/config.ts ./src/i18n/config.ts

# Copy built application from builder stage
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Rebuild native module for the glibc-based Playwright image.
RUN npm rebuild better-sqlite3

# Run Playwright tests using the local runner
ARG PW_TESTS=""
RUN node ./node_modules/@playwright/test/cli.js test $PW_TESTS

# Production Stage
FROM node:24-alpine AS runner
WORKDIR /app

# Production environment variables
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    HOSTNAME="0.0.0.0" \
    PORT=3000

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy built application from builder stage
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/cli/grm-cli.mjs ./grm-cli.mjs

# Switch to non-root user
USER nextjs

# Expose production port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]

# Coverage Stage (optional): builds an image with coverage reports under /app/coverage
FROM node:24-alpine AS coverage

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files and install dependencies (uses lockfile)
COPY package*.json ./
RUN npm install && npm cache clean --force

# Copy config and source
COPY components.json \
     next.config.mjs \
     postcss.config.mjs \
     tailwind.config.mjs \
     tsconfig.json \
     biome.json \
     vitest.config.ts \
     vitest.setup.ts \
     ./

COPY public/ ./public/
COPY src/ ./src/
COPY tests/ ./tests/

# Generate coverage report using project dependencies
RUN npm run test:coverage || (ls -la /app/coverage || true; exit 1)
