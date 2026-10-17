package ratelimit

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"

	apperrors "nexus-connect/backend-go/internal/platform/errors"

	"nexus-connect/backend-go/internal/platform/auth"
)

// Middleware mirrors rate-limiter.ts's createRateLimitMiddleware: it is
// skipped entirely when nodeEnv is "development", identifies the caller by
// authenticated user ID first (if auth.Middleware already ran and attached
// one), falling back to the remote IP, then "unknown"; sets
// X-RateLimit-Remaining/X-RateLimit-Reset on every allowed request; and on
// rejection sets Retry-After and writes the same 429 RATE_LIMIT_EXCEEDED
// envelope every other AppError produces.
func Middleware(limiter *Limiter, nodeEnv string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if nodeEnv == "development" {
				next.ServeHTTP(w, r)
				return
			}

			identifier := identifierFor(r)
			result, err := limiter.Check(r.Context(), identifier)
			if err != nil {
				writeRateLimitError(w, apperrors.Internal(""))
				return
			}

			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(result.Remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(result.ResetTimeMs, 10))

			if !result.Allowed {
				w.Header().Set("Retry-After", strconv.Itoa(result.RetryAfterSeconds))
				writeRateLimitError(w, apperrors.RateLimit(result.RetryAfterSeconds))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func identifierFor(r *http.Request) string {
	if payload, ok := auth.FromContext(r.Context()); ok && payload.UserID != "" {
		return payload.UserID
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	return "unknown"
}

func writeRateLimitError(w http.ResponseWriter, err *apperrors.AppError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)
	_ = json.NewEncoder(w).Encode(err)
}
