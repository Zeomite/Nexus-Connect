package user

import (
	"context"
	"fmt"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
)

// FindByUniqueNumber mirrors UserService.findByUniqueNumber.
func (s *Service) FindByUniqueNumber(ctx context.Context, uniqueNumber string) (PublicProfile, error) {
	row, err := s.store.PublicProfileByUniqueNumber(ctx, uniqueNumber)
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
		Status:            s.cachedStatusOr(ctx, row.ID, row.Status),
	}, nil
}

type SearchResult struct {
	Users []PublicProfile
	Total int
	Page  int
	Limit int
}

// SearchByName mirrors UserService.searchByName, building the `%query%`
// ILIKE pattern once and reusing it for both the data and count queries
// (same reasoning as the original: building it twice risks the two
// queries drifting apart if one is ever edited without the other).
func (s *Service) SearchByName(ctx context.Context, query, excludeUserID string, page, limit int) (SearchResult, error) {
	offset := (page - 1) * limit
	likePattern := fmt.Sprintf("%%%s%%", query)

	rows, err := s.store.SearchByName(ctx, excludeUserID, likePattern, limit, offset)
	if err != nil {
		return SearchResult{}, err
	}
	total, err := s.store.CountSearchByName(ctx, excludeUserID, likePattern)
	if err != nil {
		return SearchResult{}, err
	}

	users := make([]PublicProfile, len(rows))
	for i, row := range rows {
		users[i] = PublicProfile{
			ID:                row.ID,
			DisplayName:       row.DisplayName,
			UniqueNumber:      row.UniqueNumber,
			ProfilePictureURL: row.ProfilePictureURL,
			Status:            row.Status,
		}
	}

	return SearchResult{Users: users, Total: total, Page: page, Limit: limit}, nil
}
