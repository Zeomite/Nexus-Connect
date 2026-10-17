package auth

// UserRegisteredEvent and UserEmailVerifiedEvent port the payload shapes of
// UserRegisteredEvent/UserEmailVerifiedEvent in
// backend/packages/shared/src/types/events.ts, minus the Kafka envelope
// fields (eventId/timestamp/version/source) — platform/events.Bus has no
// equivalent envelope, matching spec §4.5's own MessageSent{...} example.

type UserRegisteredEvent struct {
	UserID       string
	Email        string
	UniqueNumber string
	DisplayName  string
}

func (UserRegisteredEvent) EventType() string { return "user.registered" }

type UserEmailVerifiedEvent struct {
	UserID string
}

func (UserEmailVerifiedEvent) EventType() string { return "user.email_verified" }
