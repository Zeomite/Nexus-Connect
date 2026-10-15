# backend-go

Go modular-monolith replacement for `backend/`'s 9 TypeScript microservices.
See `../docs/superpowers/specs/2026-10-15-go-monolith-migration-design.md`
for the full design and `../docs/superpowers/plans/` for implementation plans.

## Running locally

```bash
go run ./cmd/server
```

## Testing

```bash
go test ./...                  # unit tests
go test -race ./...            # race detector (required before every commit touching platform/realtime)
go test -tags=integration ./... # includes testcontainers-go integration tests (requires Docker)
```
