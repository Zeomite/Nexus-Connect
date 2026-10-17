package auth

import (
	"log/slog"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/ratelimit"

	"github.com/go-chi/chi/v5"
)

// RegisterRoutes mounts every auth.routes.ts endpoint under /api/v1/auth —
// the exact prefix the existing TS auth-service uses, so the frontend needs
// no changes. Rate limiter assignment matches the original exactly: /login
// gets the 1h/10 limiter, every other mutating route gets the 15min/5
// limiter, and /refresh and /logout get none (see this plan's Global
// Constraints and Review Focus item 5).
func RegisterRoutes(mux *chi.Mux, h *Handler, c *cache.Cache, log *slog.Logger, cfg config.Config) {
	loginLimiter := ratelimit.NewLoginLimiter(c)
	authLimiter := ratelimit.NewAuthLimiter(c)

	loginLimited := ratelimit.Middleware(loginLimiter, cfg.NodeEnv)
	authLimited := ratelimit.Middleware(authLimiter, cfg.NodeEnv)

	mux.Route("/api/v1/auth", func(r chi.Router) {
		r.With(authLimited).Post("/register", httpserver.Wrap(log, h.Register))
		r.With(loginLimited).Post("/login", httpserver.Wrap(log, h.Login))
		r.Post("/refresh", httpserver.Wrap(log, h.Refresh))
		r.Post("/logout", httpserver.Wrap(log, h.Logout))
		r.With(authLimited).Post("/verify-email", httpserver.Wrap(log, h.VerifyEmail))
		r.With(authLimited).Post("/resend-verification", httpserver.Wrap(log, h.ResendVerification))
		r.With(authLimited).Post("/forgot-password", httpserver.Wrap(log, h.ForgotPassword))
		r.With(authLimited).Post("/verify-reset-code", httpserver.Wrap(log, h.VerifyResetCode))
		r.With(authLimited).Post("/update-password", httpserver.Wrap(log, h.UpdatePassword))
	})
}
