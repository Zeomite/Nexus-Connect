package auth

import (
	"context"
	"errors"
	"fmt"

	"nexus-connect/backend-go/internal/platform/db"

	"github.com/jackc/pgx/v5"
)

// UserForLogin mirrors UserQueries.SELECT.FOR_LOGIN's column set in
// backend/packages/shared/src/database/queries/user.queries.ts.
type UserForLogin struct {
	ID            string
	Email         string
	PasswordHash  string
	UniqueNumber  string
	DisplayName   string
	EmailVerified bool
}

// EmailVerifiedLookup mirrors UserQueries.SELECT.EMAIL_VERIFIED's column set.
type EmailVerifiedLookup struct {
	ID            string
	EmailVerified bool
}

type Store struct {
	db *db.DB
}

func NewStore(database *db.DB) *Store {
	return &Store{db: database}
}

func (s *Store) ExistsByEmail(ctx context.Context, email string) (bool, error) {
	var id string
	err := s.db.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", email).Scan(&id)
	return queryOneExists(err)
}

func (s *Store) ExistsByUniqueNumber(ctx context.Context, uniqueNumber string) (bool, error) {
	var id string
	err := s.db.QueryRow(ctx, "SELECT id FROM users WHERE unique_number = $1", uniqueNumber).Scan(&id)
	return queryOneExists(err)
}

func (s *Store) FindIDByEmail(ctx context.Context, email string) (*string, error) {
	var id string
	err := s.db.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", email).Scan(&id)
	return queryOneRow(&id, err)
}

func (s *Store) InsertUser(ctx context.Context, id, email, passwordHash, uniqueNumber, displayName string) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, unique_number, display_name, email_verified, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, false, NOW(), NOW())`,
		id, email, passwordHash, uniqueNumber, displayName,
	)
	if err != nil {
		return fmt.Errorf("auth: inserting user: %w", err)
	}
	return nil
}

func (s *Store) FindForLogin(ctx context.Context, email string) (*UserForLogin, error) {
	var u UserForLogin
	err := s.db.QueryRow(ctx,
		`SELECT id, email, password_hash, unique_number, display_name, email_verified
		 FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.UniqueNumber, &u.DisplayName, &u.EmailVerified)
	return queryOneRow(&u, err)
}

func (s *Store) FindEmailVerified(ctx context.Context, email string) (*EmailVerifiedLookup, error) {
	var l EmailVerifiedLookup
	err := s.db.QueryRow(ctx, "SELECT id, email_verified FROM users WHERE email = $1", email).
		Scan(&l.ID, &l.EmailVerified)
	return queryOneRow(&l, err)
}

func (s *Store) MarkEmailVerified(ctx context.Context, userID string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		"UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1",
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("auth: marking email verified: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpdatePassword(ctx context.Context, userID, passwordHash string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		"UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
		passwordHash, userID,
	)
	if err != nil {
		return false, fmt.Errorf("auth: updating password: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpdateLastSeen(ctx context.Context, userID string) error {
	_, err := s.db.Exec(ctx, "UPDATE users SET last_seen_at = NOW() WHERE id = $1", userID)
	if err != nil {
		return fmt.Errorf("auth: updating last seen: %w", err)
	}
	return nil
}

func queryOneExists(err error) (bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("auth: querying existence: %w", err)
	}
	return true, nil
}

func queryOneRow[T any](row *T, err error) (*T, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("auth: querying row: %w", err)
	}
	return row, nil
}
