package auth

import (
	"context"
	"fmt"
	"strings"

	"nexus-connect/backend-go/internal/platform/cache"
	apperrors "nexus-connect/backend-go/internal/platform/errors"

	platformauth "nexus-connect/backend-go/internal/platform/auth"
)

type LoginInput struct {
	Email    string
	Password string
}

type LoginUser struct {
	ID           string
	Email        string
	DisplayName  string
	UniqueNumber string
}

type LoginResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int64
	User         LoginUser
}

type TokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int64
}

// Login mirrors AuthService.login.
func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error) {
	input.Email = strings.ToLower(input.Email)

	user, err := s.store.FindForLogin(ctx, input.Email)
	if err != nil {
		return LoginResult{}, err
	}
	if user == nil {
		return LoginResult{}, apperrors.InvalidCredentials()
	}

	if !platformauth.ComparePassword(input.Password, user.PasswordHash) {
		return LoginResult{}, apperrors.InvalidCredentials()
	}

	if !user.EmailVerified {
		return LoginResult{}, apperrors.EmailNotVerified()
	}

	tokens, err := s.issueTokenPair(ctx, user.ID, user.Email, user.UniqueNumber)
	if err != nil {
		return LoginResult{}, err
	}

	if err := s.store.UpdateLastSeen(ctx, user.ID); err != nil {
		return LoginResult{}, err
	}

	return LoginResult{
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresIn:    tokens.ExpiresIn,
		User: LoginUser{
			ID: user.ID, Email: user.Email, DisplayName: user.DisplayName, UniqueNumber: user.UniqueNumber,
		},
	}, nil
}

// RefreshTokens mirrors AuthService.refreshTokens, including deleting the
// old Redis entry before issuing a new pair so the old token becomes
// single-use. Fetch-and-delete happens in one atomic cache.GetDel call (not
// a separate Get then Del) so two concurrent calls racing the same token
// can't both pass the Get before either Del lands — only one ever reads
// the value; the other immediately sees it already gone.
func (s *Service) RefreshTokens(ctx context.Context, refreshToken string) (TokenResult, error) {
	userID, err := s.cache.GetDel(ctx, cache.RefreshTokenKey(refreshToken))
	if err != nil {
		if err == cache.ErrNotFound {
			return TokenResult{}, apperrors.InvalidToken()
		}
		return TokenResult{}, err
	}

	payload, err := platformauth.VerifyToken(refreshToken, s.cfg.JWTRefreshSecret)
	if err != nil {
		return TokenResult{}, apperrors.InvalidToken()
	}

	tokens, err := s.issueTokenPair(ctx, userID, payload.Email, payload.UniqueNumber)
	if err != nil {
		return TokenResult{}, err
	}

	return tokens, nil
}

// Logout mirrors AuthService.logout: deleting an unknown token is not an
// error, matching Redis DEL's own idempotent semantics the original relies on.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	return s.cache.Del(ctx, cache.RefreshTokenKey(refreshToken))
}

func (s *Service) issueTokenPair(ctx context.Context, userID, email, uniqueNumber string) (TokenResult, error) {
	payload := platformauth.TokenPayload{UserID: userID, Email: email, UniqueNumber: uniqueNumber}

	accessToken, err := platformauth.GenerateAccessToken(payload, s.cfg.JWTAccessSecret, s.cfg.JWTAccessExpiry)
	if err != nil {
		return TokenResult{}, fmt.Errorf("auth: generating access token: %w", err)
	}

	refreshToken, err := platformauth.GenerateRefreshToken(payload, s.cfg.JWTRefreshSecret, s.cfg.JWTRefreshExpiry)
	if err != nil {
		return TokenResult{}, fmt.Errorf("auth: generating refresh token: %w", err)
	}

	if err := s.cache.Set(ctx, cache.RefreshTokenKey(refreshToken), userID, s.cfg.JWTRefreshExpiry); err != nil {
		return TokenResult{}, fmt.Errorf("auth: storing refresh token: %w", err)
	}

	return TokenResult{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(s.cfg.JWTAccessExpiry.Seconds()),
	}, nil
}
