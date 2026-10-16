# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/server ./cmd/server

# Production stage
FROM alpine:3.20 AS production

RUN addgroup -g 1001 -S nexus && adduser -S nexus -u 1001
COPY --from=builder /bin/server /bin/server

USER nexus
ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENTRYPOINT ["/bin/server"]
