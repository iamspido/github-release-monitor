# Build Stage
FROM node:24-alpine AS builder
WORKDIR /app

# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies and build application
COPY package*.json ./
RUN npm ci

# Copy source files for building
COPY components.json ./
COPY next.config.mjs ./
COPY postcss.config.mjs ./
COPY tailwind.config.ts ./
COPY tsconfig.json ./
COPY public/ ./public/
COPY src/ ./src/

# Build the application
RUN npm run build

# Production Stage
FROM node:24-alpine AS runner
WORKDIR /app

# Disable Next.js telemetry in production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public

# Change ownership of app directory to nextjs user (including .next cache)
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose production port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
