package user

// ProfileUpdatedEvent and StatusChangedEvent port the payload shapes
// UserEventTypes.USER_PROFILE_UPDATED/USER_STATUS_CHANGED publish in
// backend/services/user-service/src/services/user.service.ts, minus the
// Kafka envelope — see auth/events.go's own comment for why (no Go event
// bus equivalent of that envelope exists, matching spec §4.5).

type ProfileUpdatedEvent struct {
	UserID  string
	Changes map[string]any
}

func (ProfileUpdatedEvent) EventType() string { return "user.profile_updated" }

type StatusChangedEvent struct {
	UserID    string
	NewStatus string
}

func (StatusChangedEvent) EventType() string { return "user.status_changed" }
