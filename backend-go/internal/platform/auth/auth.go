package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	apperrors "nexus-connect/backend-go/internal/platform/errors"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

type TokenPayload struct {
	UserID       string `json:"userId"`
	Email        string `json:"email"`
	UniqueNumber string `json:"uniqueNumber"`
}

type claims struct {
	TokenPayload
	jwt.RegisteredClaims
}

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(hash), err
}

func ComparePassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func GenerateAccessToken(payload TokenPayload, secret string, ttl time.Duration) (string, error) {
	return generateToken(payload, secret, ttl)
}

func GenerateRefreshToken(payload TokenPayload, secret string, ttl time.Duration) (string, error) {
	return generateToken(payload, secret, ttl)
}

func generateToken(payload TokenPayload, secret string, ttl time.Duration) (string, error) {
	jti, err := randomJTI()
	if err != nil {
		return "", fmt.Errorf("auth: generating token id: %w", err)
	}

	c := claims{
		TokenPayload: payload,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        jti,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString([]byte(secret))
}

// randomJTI gives every generated token a unique jti claim. Without it, two
// tokens signed for the same payload within the same wall-clock second are
// byte-for-byte identical (iat/exp are second-granularity), which breaks any
// caller relying on each issued token being distinct — e.g. RefreshTokens's
// single-use rotation, which keys its Redis entry by the token string itself.
func randomJTI() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// VerifyToken mirrors verifyAccessToken/verifyRefreshToken in crypto.ts,
// preserving the TokenExpired vs InvalidToken distinction the original
// middleware relies on.
func VerifyToken(tokenString, secret string) (TokenPayload, error) {
	var c claims
	token, err := jwt.ParseWithClaims(tokenString, &c, func(t *jwt.Token) (interface{}, error) {
		// This app only ever signs with HMAC (SigningMethodHS256), so a
		// token asserting any other alg in its header is already rejected
		// by the type check inside each SigningMethod's own Verify (e.g.
		// SigningMethodRSA.Verify requires an *rsa.PublicKey, not []byte).
		// Checking here too is redundant for this specific single-algorithm
		// deployment, but it's the explicit defense-in-depth the library's
		// own README calls out as a SECURITY NOTICE: "validate the alg
		// presented is what you expect" rather than relying on an
		// incidental type mismatch to do it.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("auth: unexpected signing method %q", t.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return TokenPayload{}, apperrors.TokenExpired()
		}
		return TokenPayload{}, apperrors.InvalidToken()
	}
	if !token.Valid {
		return TokenPayload{}, apperrors.InvalidToken()
	}

	return c.TokenPayload, nil
}
