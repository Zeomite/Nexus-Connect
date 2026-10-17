package user

import (
	"context"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/events"
)

type Service struct {
	store *Store
	cache *cache.Cache
	bus   *events.Bus
	cfg   config.Config
}

func NewService(store *Store, c *cache.Cache, bus *events.Bus, cfg config.Config) *Service {
	return &Service{store: store, cache: c, bus: bus, cfg: cfg}
}

type Profile struct {
	ID                string
	Email             string
	UniqueNumber      string
	DisplayName       string
	ProfilePictureURL *string
	Status            string
	CreatedAt         time.Time
}

type PublicProfile struct {
	ID                string
	DisplayName       string
	UniqueNumber      string
	ProfilePictureURL *string
	Status            string
}

// cachedStatusOr reads the live Redis status for userID, falling back to
// dbStatus on a cache miss — shared by GetProfile and GetPublicProfile
// (and reused by GetStatus/GetStatuses in service_status.go) so the
// "cache wins when present" rule (Review Focus item 2) lives in one place.
func (s *Service) cachedStatusOr(ctx context.Context, userID, dbStatus string) string {
	cached, err := s.cache.Get(ctx, cache.UserStatusKey(userID))
	if err != nil {
		return dbStatus
	}
	return cached
}

// GetProfile mirrors UserService.getProfile — includes email, for the
// caller's own profile only (GET /me).
func (s *Service) GetProfile(ctx context.Context, userID string) (Profile, error) {
	row, err := s.store.ProfileByID(ctx, userID)
	if err != nil {
		return Profile{}, err
	}
	if row == nil {
		return Profile{}, apperrors.NotFound("User")
	}

	return Profile{
		ID:                row.ID,
		Email:             row.Email,
		UniqueNumber:      row.UniqueNumber,
		DisplayName:       row.DisplayName,
		ProfilePictureURL: row.ProfilePictureURL,
		Status:            s.cachedStatusOr(ctx, userID, row.Status),
		CreatedAt:         row.CreatedAt,
	}, nil
}

// GetPublicProfile is this plan's fix for the original's email-leak bug
// (GET /:userId reusing getProfile()) — see this plan's Global Constraints.
// Uses PublicProfileRow, which has no Email field at all.
func (s *Service) GetPublicProfile(ctx context.Context, userID string) (PublicProfile, error) {
	row, err := s.store.PublicProfileByID(ctx, userID)
	if err != nil {
		return PublicProfile{}, err
	}
	if row == nil {
		return PublicProfile{}, apperrors.NotFound("User")
	}

	return PublicProfile{
		ID:                row.ID,
		DisplayName:       row.DisplayName,
		UniqueNumber:      row.UniqueNumber,
		ProfilePictureURL: row.ProfilePictureURL,
		Status:            s.cachedStatusOr(ctx, userID, row.Status),
	}, nil
}

// UpdateProfile mirrors UserService.updateProfile.
func (s *Service) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (PublicProfile, error) {
	result, err := s.store.UpdateProfile(ctx, userID, update)
	if err != nil {
		return PublicProfile{}, err
	}
	if result == nil {
		// Mirrors the original: zero fields set -> just return the current profile.
		profile, err := s.GetPublicProfile(ctx, userID)
		return profile, err
	}

	changes := map[string]any{}
	if update.DisplayName != nil {
		changes["displayName"] = *update.DisplayName
	}
	if update.ProfilePictureURL.Set {
		changes["profilePictureUrl"] = update.ProfilePictureURL.Value
	}
	s.bus.Publish(ctx, ProfileUpdatedEvent{UserID: userID, Changes: changes})

	return s.GetPublicProfile(ctx, userID)
}
