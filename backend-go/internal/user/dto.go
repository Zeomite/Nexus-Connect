package user

// Request DTOs. JSON tags match the wire format the frontend already
// sends. validate tags enforce exactly what the original enforces.

type updateProfileRequest struct {
	DisplayName       *string        `json:"displayName" validate:"omitempty,min=1,max=100"`
	ProfilePictureURL OptionalString `json:"profilePictureUrl"`
}

type updateStatusRequest struct {
	Status string `json:"status" validate:"required,oneof=online offline busy away do_not_disturb"`
}

type statusesRequest struct {
	UserIDs []string `json:"userIds" validate:"required,min=1,dive,uuid"`
}
