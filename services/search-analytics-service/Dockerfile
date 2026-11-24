# Search & Analytics Service - Docker image
FROM node:22-alpine

WORKDIR /app

# Install only production dependencies (uses package-lock.json)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the service code (.env is excluded by .dockerignore)
COPY . .

# Run as the non-root "node" user for security
USER node

EXPOSE 3004

# Docker marks the container unhealthy if /api/health fails
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3004}/api/health || exit 1

CMD ["node", "start.js"]