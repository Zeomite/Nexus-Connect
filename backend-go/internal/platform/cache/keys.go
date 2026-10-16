package cache

import "fmt"

// Direct port of backend/packages/shared/src/database/redis.ts's SessionKeys.

func UserSessionKey(userID string) string {
	return fmt.Sprintf("session:user:%s", userID)
}

func RefreshTokenKey(token string) string {
	return fmt.Sprintf("refresh:%s", token)
}

func EmailVerificationKey(token string) string {
	return fmt.Sprintf("email_verify:%s", token)
}

func PasswordResetKey(token string) string {
	return fmt.Sprintf("password_reset:%s", token)
}

func UserStatusKey(userID string) string {
	return fmt.Sprintf("status:%s", userID)
}

func UserConnectionsKey(userID string) string {
	return fmt.Sprintf("connections:%s", userID)
}

func CallRoomKey(roomID string) string {
	return fmt.Sprintf("call:room:%s", roomID)
}

func CallParticipantsKey(callID string) string {
	return fmt.Sprintf("call:participants:%s", callID)
}

func TypingIndicatorKey(chatID, userID string) string {
	return fmt.Sprintf("typing:%s:%s", chatID, userID)
}

func OnlineUsersKey() string {
	return "online:users"
}

func RateLimitKey(identifier, action string) string {
	return fmt.Sprintf("ratelimit:%s:%s", action, identifier)
}

// PasswordResetVerifiedKey matches the literal "password_reset_verified:" prefix
// backend/services/auth-service/src/services/auth.service.ts's verifyResetCode/
// updatePassword inline (it bypasses SessionKeys entirely in the original —
// ported verbatim here as a proper helper instead of an inline string, with
// zero behavior difference).
func PasswordResetVerifiedKey(email string) string {
	return fmt.Sprintf("password_reset_verified:%s", email)
}
