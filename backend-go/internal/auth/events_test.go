package auth_test

import (
	"testing"

	"nexus-connect/backend-go/internal/auth"

	"github.com/stretchr/testify/assert"
)

func TestUserRegisteredEvent_EventType(t *testing.T) {
	e := auth.UserRegisteredEvent{UserID: "u-1", Email: "a@example.com", UniqueNumber: "1234567890", DisplayName: "A"}
	assert.Equal(t, "user.registered", e.EventType())
}

func TestUserEmailVerifiedEvent_EventType(t *testing.T) {
	e := auth.UserEmailVerifiedEvent{UserID: "u-1"}
	assert.Equal(t, "user.email_verified", e.EventType())
}
