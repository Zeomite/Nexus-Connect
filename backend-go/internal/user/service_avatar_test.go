//go:build integration

package user_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUploadAvatar_WritesFabricatedURLToDB(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000050", "avatar1@example.com", "5000000001", "Avatar1", "online")

	url, err := svc.UploadAvatar(ctx, "00000000-0000-0000-0000-000000000050", "png")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(url, "https://test-bucket.s3.us-east-1.amazonaws.com/avatars/"))
	assert.True(t, strings.HasSuffix(url, ".png"))

	profile, err := svc.GetProfile(ctx, "00000000-0000-0000-0000-000000000050")
	require.NoError(t, err)
	require.NotNil(t, profile.ProfilePictureURL)
	assert.Equal(t, url, *profile.ProfilePictureURL)
}

func TestUploadAvatar_DifferentCallsProduceDifferentURLs(t *testing.T) {
	svc, store := newTestService(t)
	ctx := context.Background()
	insertTestUser(t, store, "00000000-0000-0000-0000-000000000051", "avatar2@example.com", "5000000002", "Avatar2", "online")

	first, err := svc.UploadAvatar(ctx, "00000000-0000-0000-0000-000000000051", "jpg")
	require.NoError(t, err)
	second, err := svc.UploadAvatar(ctx, "00000000-0000-0000-0000-000000000051", "jpg")
	require.NoError(t, err)
	assert.NotEqual(t, first, second, "each upload must get its own filename even for the same user/extension")
}
