package idgen_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/platform/idgen"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUUID_IsValidV4Format(t *testing.T) {
	id := idgen.UUID()
	assert.Len(t, id, 36)
	assert.Equal(t, "4", string(id[14]), "version nibble must be 4")
}

func TestTimeOrderedUUID_HasValidShape(t *testing.T) {
	id := idgen.TimeOrderedUUID()
	assert.Len(t, id, 36)
	parts := strings.Split(id, "-")
	require.Len(t, parts, 5)
	assert.Len(t, parts[0], 8)
	assert.Len(t, parts[1], 4)
	assert.Len(t, parts[2], 4)
	assert.Equal(t, "7", string(parts[2][0]), "version nibble must be 7")
	assert.Len(t, parts[3], 4)
	assert.Len(t, parts[4], 12)
}

func TestUniqueTenDigitNumber_RetriesOnCollision(t *testing.T) {
	attempts := 0
	exists := func(ctx context.Context, number string) (bool, error) {
		attempts++
		return attempts < 3, nil // first 2 "exist", 3rd is free
	}

	number, err := idgen.UniqueTenDigitNumber(context.Background(), exists, 10)
	require.NoError(t, err)
	assert.Len(t, number, 10)
	assert.NotEqual(t, "0", string(number[0]), "first digit must never be 0")
	assert.Equal(t, 3, attempts)
}

func TestUniqueTenDigitNumber_ReturnsErrorAfterMaxAttempts(t *testing.T) {
	alwaysExists := func(ctx context.Context, number string) (bool, error) { return true, nil }

	_, err := idgen.UniqueTenDigitNumber(context.Background(), alwaysExists, 3)
	require.Error(t, err)
	assert.True(t, errors.Is(err, idgen.ErrExhausted))
}

func TestUniqueTenDigitNumber_PropagatesCheckError(t *testing.T) {
	boom := errors.New("db down")
	failing := func(ctx context.Context, number string) (bool, error) { return false, boom }

	_, err := idgen.UniqueTenDigitNumber(context.Background(), failing, 5)
	require.ErrorIs(t, err, boom)
}

func TestShortID_UsesUnambiguousAlphabet(t *testing.T) {
	id := idgen.ShortID(8)
	assert.Len(t, id, 8)
	for _, c := range id {
		assert.False(t, strings.ContainsRune("0OIl1", c), "ambiguous character %q must not appear", c)
	}
}

func TestCorrelationID_HasPrefix(t *testing.T) {
	assert.True(t, strings.HasPrefix(idgen.CorrelationID(), "corr_"))
}
