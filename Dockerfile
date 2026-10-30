# FirstLight - Production Docker Image
# Multi-stage build for optimized production image

# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM node:22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies (using bun for consistency)
RUN npm install -g bun && \
    bun install --frozen-lockfile --production=false

# Copy source files
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Build the application
RUN bun run build

# ============================================================================
# Stage 2: Runtime
# ============================================================================
FROM node:22-alpine AS runtime

# Install runtime dependencies
RUN apk add --no-cache python3

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma ./prisma

# Copy server files
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/docs ./docs

# Create database directory
RUN mkdir -p /app/db && \
    chown nodejs:nodejs /app/db

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/app/db/firstlight.db

# Run the application
CMD ["bun", "run", "start"]
