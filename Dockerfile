# =============================================================================
# Lil Dude v1.0.0 — Multi-stage Docker build
# Usage:
#   docker build -t lildude:1.0.0 .
#   docker run -v ~/.lil-dude:/home/lildude/.lil-dude -p 18421:18421 -p 18420:18420 lildude:1.0.0
# =============================================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /build

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Copy source and build
COPY tsup.config.ts tsconfig.json ./
COPY src/ src/
COPY waves/ waves/
COPY web/ web/
RUN npm run build

# --- Stage 2: Runtime ---
FROM node:20-alpine AS runtime

LABEL maintainer="org-lil"
LABEL description="Lil Dude — Your personal AI executive assistant"
LABEL version="1.0.0"

WORKDIR /app

# Install runtime dependencies for native modules
RUN apk add --no-cache curl python3 make g++

# Create non-root user
RUN addgroup -S lildude && adduser -S lildude -G lildude

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Remove build tools after native module compilation
RUN apk del python3 make g++

# Copy built artifacts from builder
COPY --from=builder /build/dist/ dist/
COPY --from=builder /build/waves/ waves/

# Copy web panel build (if exists)
COPY --from=builder /build/web/dist/ web/dist/ 2>/dev/null || true

# Create data directory
RUN mkdir -p /home/lildude/.lil-dude && chown -R lildude:lildude /home/lildude

# Switch to non-root user
USER lildude

# Set environment
ENV NODE_ENV=production
ENV LIL_DUDE_HOME=/home/lildude/.lil-dude

# Expose ports: HTTP (18421) + WebSocket (18420)
EXPOSE 18421 18420

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:18421/api/v1/health || exit 1

# Entry point
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["start"]
