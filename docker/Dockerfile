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
