package user

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"time"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/validate"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

// callerID reads the authenticated caller's user ID, attached by
// platformauth.Middleware (see routes.go) before any handler here runs.
func callerID(r *http.Request) string {
	payload, _ := platformauth.FromContext(r.Context())
	return payload.UserID
}

func decodeAndValidate[T any](r *http.Request) (T, error) {
	var req T
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, apperrors.BadRequest("Invalid request body", nil)
	}
	if err := validate.Struct(req); err != nil {
		return req, err
	}
	return req, nil
}

// formatCreatedAt matches the original's `created_at.toISOString()`:
// always UTC, "Z" suffix, millisecond precision. pgx decodes timestamptz
// into the server process's own *time.Location, so a raw time.Time
// marshaled by encoding/json (RFC3339Nano, that same local offset) would
// vary by deployment TZ and use microseconds instead -- the frontend's
// date-grouping code assumes a UTC-normalized string, same as the
// original always sent.
func formatCreatedAt(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

func profileJSON(p Profile) map[string]any {
	return map[string]any{
		"id":                p.ID,
		"email":             p.Email,
		"uniqueNumber":      p.UniqueNumber,
		"displayName":       p.DisplayName,
		"profilePictureUrl": p.ProfilePictureURL,
		"status":            p.Status,
		"createdAt":         formatCreatedAt(p.CreatedAt),
	}
}

func publicProfileJSON(p PublicProfile) map[string]any {
	return map[string]any{
		"id":                p.ID,
		"displayName":       p.DisplayName,
		"uniqueNumber":      p.UniqueNumber,
		"profilePictureUrl": p.ProfilePictureURL,
		"status":            p.Status,
	}
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) error {
	profile, err := h.svc.GetProfile(r.Context(), callerID(r))
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, profileJSON(profile))
}

// userIDPathParam validates the {userId} path segment shared by GetByID
// and GetStatusByID before either reaches the DB. Not a fidelity fix --
// the original's own Fastify error handler only special-cases its
// AppError class (server.ts's setErrorHandler), so a malformed
// AJV-format:uuid failure there ALSO falls through to a generic 500, the
// same as an unvalidated pgx "invalid input syntax for type uuid" error
// here (confirmed by reading server.ts directly, not assumed from
// Fastify's defaults). Added anyway, matching SearchByNumber's own
// path-param validation (search_handler.go) and this module's
// established convention of validating before the DB wherever Go's
// explicit-param-parsing naturally allows it: it closes a free,
// zero-cost way for any authenticated client to flood error logs and
// skew 5xx alerting (chi falls back to this handler for ANY unmatched
// sibling path, e.g. a wrong-method request to /me/status or /statuses).
type userIDPathParam struct {
	UserID string `validate:"required,uuid"`
}

// GetByID uses GetPublicProfile, never GetProfile -- this is the fix for
// the original's email-leak bug, see this plan's Global Constraints.
func (h *Handler) GetByID(w http.ResponseWriter, r *http.Request) error {
	userID := chi.URLParam(r, "userId")
	if err := validate.Struct(userIDPathParam{UserID: userID}); err != nil {
		return err
	}
	profile, err := h.svc.GetPublicProfile(r.Context(), userID)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, publicProfileJSON(profile))
}

func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[updateProfileRequest](r)
	if err != nil {
		return err
	}

	if req.ProfilePictureURL.Set && req.ProfilePictureURL.Value != nil {
		// Beyond url.ParseRequestURI's bare syntax check: restrict to
		// http(s) schemes. The original's own validation here
		// (z.string().url(), backend/packages/shared/src/types/user.ts:50)
		// has the identical gap — Zod's .url() accepts any syntactically
		// valid URI scheme, including javascript:/data:/file:, via JS's
		// URL constructor. A deliberate, free hardening beyond the
		// original (an avatar URL has no legitimate reason to be
		// anything but http/https), caught by an automated security scan
		// of Task 4's commit and fixed here at the layer where validation
		// belongs, not retrofitted into Store.
		parsed, err := url.ParseRequestURI(*req.ProfilePictureURL.Value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return apperrors.Validation("Validation failed", map[string]any{
				"profilePictureUrl": "failed on the 'url' rule",
			})
		}
	}

	profile, err := h.svc.UpdateProfile(r.Context(), callerID(r), ProfileUpdate{
		DisplayName:       req.DisplayName,
		ProfilePictureURL: req.ProfilePictureURL,
	})
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, publicProfileJSON(profile))
}

func (h *Handler) UpdateMyStatus(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[updateStatusRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.UpdateStatus(r.Context(), callerID(r), req.Status); err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"status": req.Status})
}

func (h *Handler) GetStatusByID(w http.ResponseWriter, r *http.Request) error {
	userID := chi.URLParam(r, "userId")
	if err := validate.Struct(userIDPathParam{UserID: userID}); err != nil {
		return err
	}
	status, err := h.svc.GetStatus(r.Context(), userID)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"userId": userID, "status": status})
}

func (h *Handler) GetStatuses(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[statusesRequest](r)
	if err != nil {
		return err
	}

	statuses, err := h.svc.GetStatuses(r.Context(), req.UserIDs)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{"statuses": statuses})
}

var allowedAvatarMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

// UploadAvatar must be mounted via httpserver.WrapWithBodyLimit with a
// larger cap than Wrap's package default (see routes.go) -- the original
// allows up to 5 MiB (@fastify/multipart's configured limit).
func (h *Handler) UploadAvatar(w http.ResponseWriter, r *http.Request) error {
	reader, err := r.MultipartReader()
	if err != nil {
		return apperrors.BadRequest("Invalid request body", nil)
	}

	// Grabs the first file part regardless of its field name, mirroring
	// @fastify/multipart's request.file(), which does the same.
	var part *multipart.Part
	for {
		p, err := reader.NextPart()
		if err != nil {
			break
		}
		if p.FileName() != "" {
			part = p
			break
		}
	}

	if part == nil {
		return apperrors.BadRequest("No file uploaded", nil)
	}

	contentType := part.Header.Get("Content-Type")
	if !allowedAvatarMimeTypes[contentType] {
		return apperrors.BadRequest("Invalid file type. Allowed: JPEG, PNG, GIF, WebP", nil)
	}

	// Service.UploadAvatar never needs the file's bytes (it's a stub that
	// fabricates a URL, see service_avatar.go), but http.MaxBytesReader
	// -- installed by routes.go's WrapWithBodyLimit -- only trips when
	// something actually reads the body. Without draining the part here,
	// the configured cap (avatarUploadMaxBytes) silently never fires and
	// an arbitrarily large upload returns 200.
	if _, err := io.Copy(io.Discard, part); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return apperrors.PayloadTooLarge("File exceeds the maximum upload size")
		}
		return apperrors.BadRequest("Invalid request body", nil)
	}

	ext := extensionForMimeType(contentType)
	avatarURL, err := h.svc.UploadAvatar(r.Context(), callerID(r), ext)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"profilePictureUrl": avatarURL})
}

func extensionForMimeType(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return "jpeg"
	case "image/png":
		return "png"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	default:
		return "bin"
	}
}
