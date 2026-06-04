# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json* bun.lockb* ./

# Use npm ci for reproducible builds, fallback to npm install
RUN if [ -f package-lock.json ]; then npm ci; \
    elif [ -f bun.lockb ]; then npm install; \
    else npm install; fi

# Copy source files
COPY . .

# Build the application
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ENV DEV=true

RUN npm run build

# Production stage
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
