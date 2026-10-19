package user_test

import (
	"encoding/json"
	"testing"

	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOptionalString_ThreeStates pins the exact mechanism Review Focus
// item 3 depends on: every test elsewhere constructs OptionalString by
// hand (Set/Value set directly in Go), never by decoding real JSON, so
// nothing previously proved UnmarshalJSON itself distinguishes the three
// wire states PATCH /me relies on -- key omitted, key present with
// value null, and key present with a string value.
func TestOptionalString_ThreeStates(t *testing.T) {
	type req struct {
		P user.OptionalString `json:"p"`
	}

	var omitted, explicitNull, withValue req
	require.NoError(t, json.Unmarshal([]byte(`{}`), &omitted))
	require.NoError(t, json.Unmarshal([]byte(`{"p":null}`), &explicitNull))
	require.NoError(t, json.Unmarshal([]byte(`{"p":"https://example.com/a.png"}`), &withValue))

	assert.False(t, omitted.P.Set, "key omitted entirely must leave Set false")

	assert.True(t, explicitNull.P.Set, "an explicit JSON null must still set Set true")
	assert.Nil(t, explicitNull.P.Value, "an explicit JSON null must carry a nil Value")

	assert.True(t, withValue.P.Set)
	require.NotNil(t, withValue.P.Value)
	assert.Equal(t, "https://example.com/a.png", *withValue.P.Value)
}
