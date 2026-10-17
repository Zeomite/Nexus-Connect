package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"nexus-connect/backend-go/internal/platform/db"

	"github.com/jackc/pgx/v5"
)

// OptionalString carries a JSON PATCH field through its three possible
// states: key omitted (Set=false — don't touch), key present with value
// null (Set=true, Value=nil — clear to NULL), key present with a string
// (Set=true, Value=&s — set to this). A plain *string can't tell "omitted"
// apart from "present and null" — both would decode to a nil pointer — so
// this type's UnmarshalJSON (used by dto.go's updateProfileRequest, Task
// 10) only runs at all when Go's json package actually sees the key. Lives
// here rather than in dto.go because ProfileUpdate (below) needs it, and
// Store (this file) must compile and test on its own before Task 10 exists.
type OptionalString struct {
	Set   bool
	Value *string
}

func (o *OptionalString) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	o.Value = &s
	return nil
}

// ProfileRow mirrors UserQueries.SELECT.PROFILE_BY_ID's column set in
// backend/packages/shared/src/database/queries/user.queries.ts — includes
// email, used only for the caller's own profile (GET /me).
type ProfileRow struct {
	ID                string
	Email             string
	UniqueNumber      string
	DisplayName       string
	ProfilePictureURL *string
	Status            string
	CreatedAt         time.Time
}

// PublicProfileRow mirrors UserQueries.SELECT.PUBLIC_PROFILE_BY_ID /
// PUBLIC_PROFILE_BY_UNIQUE_NUMBER's column set — no email. Used for any
// other user's profile (GET /:userId, fixed per this plan's Global
// Constraints — see Task 6), search results, and lookup-by-number.
type PublicProfileRow struct {
	ID                string
	DisplayName       string
	UniqueNumber      string
	ProfilePictureURL *string
	Status            string
}

// ProfileUpdate carries the fields PATCH /me actually wants to change.
// DisplayName nil means "don't touch"; ProfilePictureURL.Set false means
// "don't touch", Set true with Value nil means "clear to NULL", Set true
// with a non-nil Value means "set to this URL".
type ProfileUpdate struct {
	DisplayName       *string
	ProfilePictureURL OptionalString
}

type Store struct {
	db *db.DB
}

func NewStore(database *db.DB) *Store {
	return &Store{db: database}
}

func (s *Store) ProfileByID(ctx context.Context, userID string) (*ProfileRow, error) {
	var r ProfileRow
	err := s.db.QueryRow(ctx,
		`SELECT id, email, unique_number, display_name, profile_picture_url, status, created_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&r.ID, &r.Email, &r.UniqueNumber, &r.DisplayName, &r.ProfilePictureURL, &r.Status, &r.CreatedAt)
	return queryOneRow(&r, err)
}

func (s *Store) PublicProfileByID(ctx context.Context, userID string) (*PublicProfileRow, error) {
	var r PublicProfileRow
	err := s.db.QueryRow(ctx,
		`SELECT id, display_name, unique_number, profile_picture_url, status
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&r.ID, &r.DisplayName, &r.UniqueNumber, &r.ProfilePictureURL, &r.Status)
	return queryOneRow(&r, err)
}

func (s *Store) PublicProfileByUniqueNumber(ctx context.Context, uniqueNumber string) (*PublicProfileRow, error) {
	var r PublicProfileRow
	err := s.db.QueryRow(ctx,
		`SELECT id, display_name, unique_number, profile_picture_url, status
		 FROM users WHERE unique_number = $1`,
		uniqueNumber,
	).Scan(&r.ID, &r.DisplayName, &r.UniqueNumber, &r.ProfilePictureURL, &r.Status)
	return queryOneRow(&r, err)
}

func (s *Store) StatusByID(ctx context.Context, userID string) (*string, error) {
	var status string
	err := s.db.QueryRow(ctx, "SELECT status FROM users WHERE id = $1", userID).Scan(&status)
	return queryOneRow(&status, err)
}

func (s *Store) StatusesByIDs(ctx context.Context, userIDs []string) (map[string]string, error) {
	if len(userIDs) == 0 {
		return map[string]string{}, nil
	}

	rows, err := s.db.Query(ctx, "SELECT id, status FROM users WHERE id = ANY($1)", userIDs)
	if err != nil {
		return nil, fmt.Errorf("user: querying statuses by ids: %w", err)
	}
	defer rows.Close()

	result := make(map[string]string, len(userIDs))
	for rows.Next() {
		var id, status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, fmt.Errorf("user: scanning status row: %w", err)
		}
		result[id] = status
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("user: iterating status rows: %w", err)
	}
	return result, nil
}

// UpdateStatus also sets last_seen_at, matching UserQueries.UPDATE.STATUS
// exactly (not just the status column).
func (s *Store) UpdateStatus(ctx context.Context, userID, status string) error {
	_, err := s.db.Exec(ctx,
		"UPDATE users SET status = $1, last_seen_at = NOW(), updated_at = NOW() WHERE id = $2",
		status, userID,
	)
	if err != nil {
		return fmt.Errorf("user: updating status: %w", err)
	}
	return nil
}

// UpdateProfile builds its SQL dynamically, mirroring UserService.updateProfile's
// own inline (not UserQueries-based) construction in the original — a
// pre-existing style inconsistency the original's own AGENTS.md calls out,
// not a behavior bug, so it's ported as-is rather than "fixed" into a
// UserQueries-based form that doesn't exist today.
func (s *Store) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (*ProfileUpdate, error) {
	var sets []string
	var args []any
	argN := 1

	if update.DisplayName != nil {
		sets = append(sets, fmt.Sprintf("display_name = $%d", argN))
		args = append(args, *update.DisplayName)
		argN++
	}
	if update.ProfilePictureURL.Set {
		sets = append(sets, fmt.Sprintf("profile_picture_url = $%d", argN))
		args = append(args, update.ProfilePictureURL.Value)
		argN++
	}

	if len(sets) == 0 {
		return nil, nil
	}

	sets = append(sets, "updated_at = NOW()")
	args = append(args, userID)

	sql := fmt.Sprintf(
		"UPDATE users SET %s WHERE id = $%d RETURNING display_name, profile_picture_url",
		strings.Join(sets, ", "), argN,
	)

	var result ProfileUpdate
	var displayName string
	var pictureURL *string
	err := s.db.QueryRow(ctx, sql, args...).Scan(&displayName, &pictureURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("user: updating profile: %w", err)
	}
	result.DisplayName = &displayName
	result.ProfilePictureURL = OptionalString{Set: true, Value: pictureURL}
	return &result, nil
}

func (s *Store) UpdateProfilePicture(ctx context.Context, userID, url string) error {
	_, err := s.db.Exec(ctx,
		"UPDATE users SET profile_picture_url = $1, updated_at = NOW() WHERE id = $2",
		url, userID,
	)
	if err != nil {
		return fmt.Errorf("user: updating profile picture: %w", err)
	}
	return nil
}

// SearchByName's likePattern is fully bound as $2, never interpolated — no
// SQL injection risk. It is, however, literally the caller's search term
// with raw ILIKE wildcards added around it, with no escaping of any `%`/`_`
// the term itself might contain: a query containing a literal "%" matches
// everyone, and "_" matches any single character, same as the original's
// identical, equally-unescaped `%${query}%` construction
// (backend/services/user-service/src/services/user.service.ts). Faithfully
// preserved, not a new regression — produces surprising search results in
// a narrow case, not a security issue (query is a bound parameter either
// way), and isn't listed in user-service/AGENTS.md's own known-limitations
// section, so it doesn't carry the formal // TODO(gap) marker spec §2
// reserves for items that are.
func (s *Store) SearchByName(ctx context.Context, excludeUserID, likePattern string, limit, offset int) ([]PublicProfileRow, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, display_name, unique_number, profile_picture_url, status
		 FROM users WHERE id != $1 AND display_name ILIKE $2
		 ORDER BY display_name ASC LIMIT $3 OFFSET $4`,
		excludeUserID, likePattern, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("user: searching by name: %w", err)
	}
	defer rows.Close()

	var results []PublicProfileRow
	for rows.Next() {
		var r PublicProfileRow
		if err := rows.Scan(&r.ID, &r.DisplayName, &r.UniqueNumber, &r.ProfilePictureURL, &r.Status); err != nil {
			return nil, fmt.Errorf("user: scanning search row: %w", err)
		}
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("user: iterating search rows: %w", err)
	}
	return results, nil
}

func (s *Store) CountSearchByName(ctx context.Context, excludeUserID, likePattern string) (int, error) {
	var count int
	err := s.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM users WHERE id != $1 AND display_name ILIKE $2",
		excludeUserID, likePattern,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("user: counting search results: %w", err)
	}
	return count, nil
}

func queryOneRow[T any](row *T, err error) (*T, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("user: querying row: %w", err)
	}
	return row, nil
}
