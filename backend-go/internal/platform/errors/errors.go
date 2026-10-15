package errors

import (
	"encoding/json"
	"errors"
	"fmt"
)

// AppError is the Go equivalent of backend/packages/shared/src/utils/errors.ts's AppError.
type AppError struct {
	StatusCode    int
	Code          string
	Message       string
	Details       map[string]any
	IsOperational bool
}

func (e *AppError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *AppError) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Error struct {
			Code    string         `json:"code"`
			Message string         `json:"message"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}{
		Error: struct {
			Code    string         `json:"code"`
			Message string         `json:"message"`
			Details map[string]any `json:"details"`
		}{Code: e.Code, Message: e.Message, Details: e.Details},
	})
}

// As unwraps err into *AppError if the chain contains one.
func As(err error) (*AppError, bool) {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr, true
	}
	return nil, false
}

func new(status int, code, message string, operational bool, details map[string]any) *AppError {
	return &AppError{StatusCode: status, Code: code, Message: message, Details: details, IsOperational: operational}
}

func BadRequest(message string, details map[string]any) *AppError {
	if message == "" {
		message = "Bad request"
	}
	return new(400, "BAD_REQUEST", message, true, details)
}

func Unauthorized(message string) *AppError {
	if message == "" {
		message = "Unauthorized"
	}
	return new(401, "UNAUTHORIZED", message, true, nil)
}

func Forbidden(message string) *AppError {
	if message == "" {
		message = "Forbidden"
	}
	return new(403, "FORBIDDEN", message, true, nil)
}

func NotFound(resource string) *AppError {
	if resource == "" {
		resource = "Resource"
	}
	return new(404, "NOT_FOUND", resource+" not found", true, nil)
}

func Conflict(message string) *AppError {
	if message == "" {
		message = "Resource already exists"
	}
	return new(409, "CONFLICT", message, true, nil)
}

func Validation(message string, details map[string]any) *AppError {
	if message == "" {
		message = "Validation failed"
	}
	return new(422, "VALIDATION_ERROR", message, true, details)
}

func RateLimit(retryAfterSeconds int) *AppError {
	return new(429, "RATE_LIMIT_EXCEEDED", "Too many requests", true, map[string]any{"retryAfter": retryAfterSeconds})
}

func Internal(message string) *AppError {
	if message == "" {
		message = "Internal server error"
	}
	return new(500, "INTERNAL_ERROR", message, false, nil)
}

func ServiceUnavailable(service string) *AppError {
	if service == "" {
		service = "Service"
	}
	return new(503, "SERVICE_UNAVAILABLE", service+" is temporarily unavailable", true, nil)
}

func DuplicateEmail() *AppError {
	return new(409, "DUPLICATE_EMAIL", "Email already registered", true, nil)
}

func InvalidCredentials() *AppError {
	return new(401, "INVALID_CREDENTIALS", "Invalid email or password", true, nil)
}

func EmailNotVerified() *AppError {
	return new(403, "EMAIL_NOT_VERIFIED", "Email not verified", true, nil)
}

func TokenExpired() *AppError {
	return new(401, "TOKEN_EXPIRED", "Token has expired", true, nil)
}

func InvalidToken() *AppError {
	return new(401, "INVALID_TOKEN", "Invalid token", true, nil)
}

func CallInProgress() *AppError {
	return new(409, "CALL_IN_PROGRESS", "User already in a call", true, nil)
}

func CallNotFound() *AppError {
	return new(404, "CALL_NOT_FOUND", "Call not found", true, nil)
}

func NotGroupMember() *AppError {
	return new(403, "NOT_GROUP_MEMBER", "User is not a member of this group", true, nil)
}

func InsufficientPermissions(action string) *AppError {
	if action == "" {
		action = "perform this action"
	}
	return new(403, "INSUFFICIENT_PERMISSIONS", "Insufficient permissions to "+action, true, nil)
}
