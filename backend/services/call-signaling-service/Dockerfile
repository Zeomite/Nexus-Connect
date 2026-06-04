# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY services/call-signaling-service/package.json ./services/call-signaling-service/
RUN npm install --workspace=@nexus/shared --workspace=@nexus/call-signaling-service
COPY packages/shared ./packages/shared
COPY services/call-signaling-service ./services/call-signaling-service
RUN npm run build --workspace=@nexus/shared
RUN npm run build --workspace=@nexus/call-signaling-service

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/services/call-signaling-service/package.json ./services/call-signaling-service/
RUN npm install --workspace=@nexus/shared --workspace=@nexus/call-signaling-service --omit=dev
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/services/call-signaling-service/dist ./services/call-signaling-service/dist
RUN chown -R nodejs:nodejs /app
USER nodejs
ENV NODE_ENV=production PORT=3004
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3004/health/live || exit 1
CMD ["node", "services/call-signaling-service/dist/index.js"]
