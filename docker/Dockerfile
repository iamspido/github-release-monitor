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
     tailwind.config.ts \
     tsconfig.json \
     ./

# Copy source files
COPY public/ ./public/
COPY src/ ./src/

# Build the application
RUN npm run build

# Test Stage (runs unit tests with Vitest)
FROM node:24-alpine AS tester

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files and install dependencies (uses lockfile)
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Copy config and source
COPY components.json \
     next.config.mjs \
     .eslintrc.json \
     postcss.config.mjs \
     tailwind.config.ts \
     tsconfig.json \
     vitest.config.ts \
     vitest.setup.ts \
     ./

COPY public/ ./public/
COPY src/ ./src/
COPY tests/ ./tests/

# Run tests during image build; build fails if tests fail
RUN npm run lint && npm run typecheck && npm test

# Lint Stage (only ESLint)
FROM node:24-alpine AS lint

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY .eslintrc.json ./
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run lint

# Typecheck Stage (only TypeScript)
FROM node:24-alpine AS typecheck

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run typecheck

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
     tailwind.config.ts \
     tsconfig.json \
     vitest.config.ts \
     vitest.setup.ts \
     ./

COPY public/ ./public/
COPY src/ ./src/
COPY tests/ ./tests/

# Generate coverage report
RUN npm install -D vitest @vitest/coverage-v8 --no-save && \
    npx -y vitest run --coverage || (ls -la /app/coverage || true; exit 1)

# E2E Stage (Playwright): runs end-to-end tests in Docker
FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS e2e

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    CI=true \
    HTTPS=false \
    BACKGROUND_POLLING_INITIALIZED=true \
    AUTH_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
    AUTH_USERNAME=test \
    AUTH_PASSWORD=test

# Copy minimal files for running tests and server
COPY package*.json ./
RUN npm install --omit=optional --no-audit --no-fund && npm cache clean --force \
 && npm install @playwright/test@1.55.0 playwright@1.55.0 --no-save --no-audit --no-fund

COPY playwright.config.ts ./
COPY tests/e2e ./tests/e2e

# Copy built application from builder stage
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Run Playwright tests using the local runner
RUN node ./node_modules/@playwright/test/cli.js test

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

# Switch to non-root user
USER nextjs

# Expose production port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
