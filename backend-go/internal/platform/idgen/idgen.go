package idgen

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
)

var ErrExhausted = errors.New("idgen: exhausted max attempts without finding a unique value")

func UUID() string {
	return uuid.New().String()
}

// TimeOrderedUUID mirrors the TS "custom UUIDv7-like" helper: timestamp prefix + random suffix.
func TimeOrderedUUID() string {
	ts := time.Now().UnixMilli()
	tsHex := fmt.Sprintf("%012x", ts)
	randPart := randHex(10)
	return fmt.Sprintf("%s-%s-7%s-%s-%s",
		tsHex[0:8], tsHex[8:12], randPart[0:3], randPart[3:7], randPart[7:19])
}

func UniqueTenDigitNumber(
	ctx context.Context,
	exists func(ctx context.Context, number string) (bool, error),
	maxAttempts int,
) (string, error) {
	for attempt := 0; attempt < maxAttempts; attempt++ {
		candidate := randomTenDigit()
		taken, err := exists(ctx, candidate)
		if err != nil {
			return "", err
		}
		if !taken {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("generating unique 10-digit number: %w", ErrExhausted)
}

func randomTenDigit() string {
	firstDigit, _ := rand.Int(rand.Reader, big.NewInt(9))
	rest, _ := rand.Int(rand.Reader, big.NewInt(1_000_000_000))
	return fmt.Sprintf("%d%09d", firstDigit.Int64()+1, rest.Int64())
}

const shortIDAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"

func ShortID(length int) string {
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(shortIDAlphabet))))
		b[i] = shortIDAlphabet[n.Int64()]
	}
	return string(b)
}

func CorrelationID() string {
	return "corr_" + UUID()
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}
