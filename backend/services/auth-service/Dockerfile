# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace files
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY services/auth-service/package.json ./services/auth-service/

# Install dependencies
RUN npm install --workspace=@nexus/shared --workspace=@nexus/auth-service

# Copy source code
COPY packages/shared ./packages/shared
COPY services/auth-service ./services/auth-service

# Build shared package
RUN npm run build --workspace=@nexus/shared

# Build auth service
RUN npm run build --workspace=@nexus/auth-service

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/services/auth-service/package.json ./services/auth-service/

# Install production dependencies only
RUN npm install --workspace=@nexus/shared --workspace=@nexus/auth-service --omit=dev

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/services/auth-service/dist ./services/auth-service/dist

# Set ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health/live || exit 1

CMD ["node", "services/auth-service/dist/index.js"]
