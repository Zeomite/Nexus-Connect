package user

import (
	"context"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
)

// statusCacheTTL matches config.statusTtl (300s) in
// backend/services/user-service/src/config.ts. See auth's
// emailVerificationTTL note for why this is a constant here rather than a
// Config field.
const statusCacheTTL = 300 * time.Second

// UpdateStatus mirrors UserService.updateStatus.
//
// TODO(gap): the online:users Redis set this maintains (SADD on "online",
// SREM on every other status) is write-only -- nothing anywhere reads it
// back (confirmed via grep across backend/), likely scaffolding for an
// unbuilt presence feature. Ported as a faithful dead write anyway, see
// backend/services/user-service/AGENTS.md.
func (s *Service) UpdateStatus(ctx context.Context, userID, status string) error {
	if err := s.cache.Set(ctx, cache.UserStatusKey(userID), status, statusCacheTTL); err != nil {
		return err
	}

	if err := s.store.UpdateStatus(ctx, userID, status); err != nil {
		return err
	}

	if status == "online" {
		_ = s.cache.SAdd(ctx, cache.OnlineUsersKey(), userID)
	} else if status == "offline" {
		_ = s.cache.SRem(ctx, cache.OnlineUsersKey(), userID)
	}

	s.bus.Publish(ctx, StatusChangedEvent{UserID: userID, NewStatus: status})
	return nil
}

// GetStatus mirrors UserService.getStatus: Redis first, DB fallback,
// "offline" if neither has the user (matching `user?.status || 'offline'`).
func (s *Service) GetStatus(ctx context.Context, userID string) (string, error) {
	cached, err := s.cache.Get(ctx, cache.UserStatusKey(userID))
	if err == nil {
		return cached, nil
	}
	if err != cache.ErrNotFound {
		s.log.Warn("cache read failed, falling back to database status",
			"error", err, "userID", userID)
	}

	status, err := s.store.StatusByID(ctx, userID)
	if err != nil {
		return "", err
	}
	if status == nil {
		return "offline", nil
	}
	return *status, nil
}

// GetStatuses mirrors UserService.getStatuses: one Redis round trip
// (cache.MGet, Task 1 -- the original uses a pipeline of N GETs, which
// MGET already does in a single command, a cleaner implementation of the
// identical "batch read" intent) for every ID, then one DB query for
// whichever IDs that round trip didn't cover.
func (s *Service) GetStatuses(ctx context.Context, userIDs []string) (map[string]string, error) {
	keys := make([]string, len(userIDs))
	keyToID := make(map[string]string, len(userIDs))
	for i, id := range userIDs {
		key := cache.UserStatusKey(id)
		keys[i] = key
		keyToID[key] = id
	}

	cached, err := s.cache.MGet(ctx, keys)
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(userIDs))
	var missing []string
	for _, id := range userIDs {
		if status, ok := cached[cache.UserStatusKey(id)]; ok {
			result[id] = status
		} else {
			missing = append(missing, id)
		}
	}

	if len(missing) > 0 {
		dbStatuses, err := s.store.StatusesByIDs(ctx, missing)
		if err != nil {
			return nil, err
		}
		for id, status := range dbStatuses {
			result[id] = status
		}
	}

	return result, nil
}
