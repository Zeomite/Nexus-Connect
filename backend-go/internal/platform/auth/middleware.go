package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
)

type contextKey string

const UserContextKey contextKey = "user"

// Middleware extracts and verifies the Bearer token, attaching TokenPayload
// to the request context on success. On failure it writes the AppError JSON
// envelope directly (the same shape Task 13's global error middleware
// produces) rather than deferring to it, since auth failure must short-
// circuit before any handler-level error-returning convention applies.
func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				writeAuthError(w, apperrors.Unauthorized("Missing authorization header"))
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				writeAuthError(w, apperrors.Unauthorized("Invalid authorization header format"))
				return
			}

			payload, err := VerifyToken(parts[1], secret)
			if err != nil {
				appErr, ok := apperrors.As(err)
				if !ok {
					appErr = apperrors.InvalidToken()
				}
				writeAuthError(w, appErr)
				return
			}

			ctx := context.WithValue(r.Context(), UserContextKey, payload)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func FromContext(ctx context.Context) (TokenPayload, bool) {
	payload, ok := ctx.Value(UserContextKey).(TokenPayload)
	return payload, ok
}

func writeAuthError(w http.ResponseWriter, err *apperrors.AppError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)
	_ = json.NewEncoder(w).Encode(err)
}
