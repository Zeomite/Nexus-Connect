package httpserver

import (
	"encoding/json"
	"log/slog"
	"net/http"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
)

type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// maxRequestBodyBytes matches Fastify's documented default bodyLimit (1
// MiB), which the original services never override (confirmed via grep —
// no service passes a `bodyLimit` option to its Fastify(...) constructor).
// Without an equivalent cap, a handler that reads/decodes the full body
// (every handler in this codebase does, via json.Decode) would buffer an
// attacker-controlled, unbounded amount of data in memory.
const maxRequestBodyBytes = 1 << 20

// statusTrackingWriter records whether a response has already been started
// (WriteHeader or Write called), so Wrap and recoverer can tell whether it's
// still safe to write a different response on top, instead of risking a
// corrupted/duplicated body after a handler already wrote part of its own.
//
// Known gap: embedding http.ResponseWriter promotes Flusher/Hijacker
// untouched, so a handler that calls Flush() or Hijack() without a prior
// Write/WriteHeader leaves `started` false even though bytes already went
// out (or the connection was taken over entirely). No current handler does
// this — there's no streaming/SSE/websocket handler anywhere in this plan —
// but revisit this wrapper (and recoverer's lack of chi's own
// Connection:-Upgrade guard) before building one.
type statusTrackingWriter struct {
	http.ResponseWriter
	started bool
}

func (w *statusTrackingWriter) WriteHeader(status int) {
	w.started = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusTrackingWriter) Write(b []byte) (int, error) {
	w.started = true
	return w.ResponseWriter.Write(b)
}

// Wrap adapts a HandlerFunc (which can return an error) into a standard
// http.HandlerFunc, mapping any returned error to the same
// {"error":{"code","message","details"}} JSON shape the original
// TypeScript services' global error handlers produce. Applies the
// package's default body-size cap (maxRequestBodyBytes) — use
// WrapWithBodyLimit for a route that genuinely needs a different one
// (e.g. a file upload).
func Wrap(log *slog.Logger, fn HandlerFunc) http.HandlerFunc {
	return wrapWithLimit(log, fn, maxRequestBodyBytes)
}

// WrapWithBodyLimit is Wrap with a caller-chosen body-size cap instead of
// the package default.
func WrapWithBodyLimit(log *slog.Logger, fn HandlerFunc, maxBytes int64) http.HandlerFunc {
	return wrapWithLimit(log, fn, maxBytes)
}

func wrapWithLimit(log *slog.Logger, fn HandlerFunc, maxBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		sw := &statusTrackingWriter{ResponseWriter: w}
		err := fn(sw, r)
		if err == nil {
			return
		}

		if sw.started {
			// The handler already wrote part of a different response (e.g.
			// WriteJSON's header succeeded but body encoding then failed) —
			// writing a second status/body on top would corrupt it.
			log.Error("handler returned error after starting a response",
				"error", err, "path", r.URL.Path, "method", r.Method)
			return
		}

		writeAppError(w, log, r, err)
	}
}

// writeAppError maps err to the AppError JSON envelope and writes it,
// logging 5xx failures. Shared by Wrap (a returned error) and recoverer (a
// recovered panic) so both paths produce the exact same wire shape.
func writeAppError(w http.ResponseWriter, log *slog.Logger, r *http.Request, err error) {
	appErr, ok := apperrors.As(err)
	if !ok {
		// Never surface a raw, non-AppError's .Error() text to the client —
		// it can leak internal details (DSNs, file paths, driver messages).
		// The original TS error handler (auth-service/src/server.ts) logs
		// the real error server-side and always sends a generic message;
		// apperrors.Internal("") falls back to its own safe default.
		appErr = apperrors.Internal("")
	}

	if appErr.StatusCode >= 500 {
		log.Error("request failed", "error", err, "path", r.URL.Path, "method", r.Method)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(appErr.StatusCode)
	_ = json.NewEncoder(w).Encode(appErr)
}

func WriteJSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}
