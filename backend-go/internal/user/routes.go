package user

import (
	"log/slog"

	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/httpserver"

	platformauth "nexus-connect/backend-go/internal/platform/auth"

	"github.com/go-chi/chi/v5"
)

// avatarUploadMaxBytes matches @fastify/multipart's configured 5 MiB
// limit in backend/services/user-service/src/server.ts.
const avatarUploadMaxBytes = 5 << 20

// RegisterRoutes mounts every user.routes.ts/search.routes.ts endpoint
// under /api/v1/users and /api/v1/search -- the exact prefixes the
// existing TS user-service uses. Both groups require a valid Bearer
// token (platformauth.Middleware, applied once per group via r.Use, not
// per-route) and neither has any rate limiting, matching the original
// exactly (see this plan's Global Constraints).
func RegisterRoutes(mux *chi.Mux, h *Handler, log *slog.Logger, cfg config.Config) {
	authed := platformauth.Middleware(cfg.JWTAccessSecret)

	mux.Route("/api/v1/users", func(r chi.Router) {
		r.Use(authed)
		r.Get("/me", httpserver.Wrap(log, h.Me))
		r.Get("/{userId}", httpserver.Wrap(log, h.GetByID))
		r.Patch("/me", httpserver.Wrap(log, h.UpdateMe))
		r.Patch("/me/status", httpserver.Wrap(log, h.UpdateMyStatus))
		r.Get("/{userId}/status", httpserver.Wrap(log, h.GetStatusByID))
		r.Post("/statuses", httpserver.Wrap(log, h.GetStatuses))
		r.Post("/me/avatar", httpserver.WrapWithBodyLimit(log, h.UploadAvatar, avatarUploadMaxBytes))
	})

	mux.Route("/api/v1/search", func(r chi.Router) {
		r.Use(authed)
		r.Get("/by-number/{uniqueNumber}", httpserver.Wrap(log, h.SearchByNumber))
		r.Get("/users", httpserver.Wrap(log, h.SearchByName))
	})
}
