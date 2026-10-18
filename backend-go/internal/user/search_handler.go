package user

import (
	"net/http"
	"strconv"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/validate"

	"github.com/go-chi/chi/v5"
)

type searchByNumberParams struct {
	UniqueNumber string `validate:"required,len=10,numeric"`
}

func (h *Handler) SearchByNumber(w http.ResponseWriter, r *http.Request) error {
	params := searchByNumberParams{UniqueNumber: chi.URLParam(r, "uniqueNumber")}
	if err := validate.Struct(params); err != nil {
		return err
	}

	profile, err := h.svc.FindByUniqueNumber(r.Context(), params.UniqueNumber)
	if err != nil {
		return err
	}
	return httpserver.WriteJSON(w, http.StatusOK, publicProfileJSON(profile))
}

// SearchByName mirrors search.routes.ts's GET /users: query is required
// (min 1, max 100 chars); page defaults to 1 and limit to 20 when omitted
// or zero, matching PaginationSchema's .default(1)/.default(20) — then
// both are bounds-checked (page positive, limit 1-100) exactly like the
// Zod schema's .positive()/.min(1).max(100).
func (h *Handler) SearchByName(w http.ResponseWriter, r *http.Request) error {
	query := r.URL.Query().Get("query")
	if query == "" || len(query) > 100 {
		return apperrors.Validation("Validation failed", map[string]any{"query": "failed on the 'required' or 'max' rule"})
	}

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		parsed, err := strconv.Atoi(p)
		if err != nil || parsed < 1 {
			return apperrors.Validation("Validation failed", map[string]any{"page": "failed on the 'min' rule"})
		}
		page = parsed
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		parsed, err := strconv.Atoi(l)
		if err != nil || parsed < 1 || parsed > 100 {
			return apperrors.Validation("Validation failed", map[string]any{"limit": "failed on the 'min' or 'max' rule"})
		}
		limit = parsed
	}

	result, err := h.svc.SearchByName(r.Context(), query, callerID(r), page, limit)
	if err != nil {
		return err
	}

	users := make([]map[string]any, len(result.Users))
	for i, u := range result.Users {
		users[i] = publicProfileJSON(u)
	}
	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"users": users, "total": result.Total, "page": result.Page, "limit": result.Limit,
	})
}
