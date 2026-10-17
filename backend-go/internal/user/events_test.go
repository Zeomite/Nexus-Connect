package user_test

import (
	"testing"

	"nexus-connect/backend-go/internal/user"

	"github.com/stretchr/testify/assert"
)

func TestProfileUpdatedEvent_EventType(t *testing.T) {
	e := user.ProfileUpdatedEvent{UserID: "u-1", Changes: map[string]any{"displayName": "New"}}
	assert.Equal(t, "user.profile_updated", e.EventType())
}

func TestStatusChangedEvent_EventType(t *testing.T) {
	e := user.StatusChangedEvent{UserID: "u-1", NewStatus: "online"}
	assert.Equal(t, "user.status_changed", e.EventType())
}
