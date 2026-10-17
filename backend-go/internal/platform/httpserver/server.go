package httpserver

import (
	"log/slog"
	"net/http"

	apperrors "nexus-connect/backend-go/internal/platform/errors"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func NewRouter(log *slog.Logger, corsOrigins []string) *chi.Mux {
	r := chi.NewRouter()

	// recoverer is registered first (outermost) so it catches panics from
	// every other middleware in the chain too, not just from what's
	// registered after it.
	r.Use(recoverer(log))
	r.Use(chimw.RequestID)
	r.Use(securityHeaders)
	r.Use(cors(corsOrigins))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		_ = WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	return r
}

// recoverer mirrors chi's built-in Recoverer but maps the panic to our
// AppError JSON envelope instead of chi's default plain-text 500 body.
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sw := &statusTrackingWriter{ResponseWriter: w}
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic recovered", "panic", rec, "path", r.URL.Path, "method", r.Method)
					if sw.started {
						// The handler already wrote part of a response before
						// panicking — writing a second one on top would corrupt it.
						return
					}
					writeAppError(sw, log, r, apperrors.Internal("Internal server error"))
				}
			}()
			next.ServeHTTP(sw, r)
		})
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func cors(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	allowAll := false
	for _, o := range allowedOrigins {
		if o == "*" {
			allowAll = true
		}
		allowed[o] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if allowAll {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			} else if allowed[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
