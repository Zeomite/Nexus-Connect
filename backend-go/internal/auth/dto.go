package auth

// Request DTOs. JSON tags match the wire format the frontend already sends
// (zero frontend changes, per spec §1). validate tags enforce exactly what
// the original enforces — see this plan's Global Constraints for the two
// documented asymmetries (no password_strength anywhere; UpdatePassword has
// no password max length, unlike Register).
//
// Four fields below deliberately have no `required` tag even though they
// are logically mandatory: LoginUserSchema/RefreshTokenSchema in the
// original are `z.string()` with no `.min()`, and update-password's
// resetToken is validated only by Fastify's `{type: 'string'}` route
// schema — none reject an empty string at the validation layer. Each lets
// an empty value fall through to the domain-specific downstream error
// (401 INVALID_CREDENTIALS/INVALID_TOKEN, or Logout's idempotent 200) the
// same way the original does. Adding `required` here would make validation
// stricter than the system being replaced, same class of mistake as
// applying password_strength above.

type registerRequest struct {
	Email       string `json:"email" validate:"required,email"`
	Password    string `json:"password" validate:"required,min=8,max=128"`
	DisplayName string `json:"displayName" validate:"required,min=1,max=100"`
}

type loginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type logoutRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type verifyEmailRequest struct {
	Email string `json:"email" validate:"required,email"`
	Code  string `json:"code" validate:"required,len=6"`
}

type resendVerificationRequest struct {
	Email string `json:"email" validate:"required,email"`
}

type forgotPasswordRequest struct {
	Email string `json:"email" validate:"required,email"`
}

type verifyResetCodeRequest struct {
	Email string `json:"email" validate:"required,email"`
	Code  string `json:"code" validate:"required,len=6"`
}

type updatePasswordRequest struct {
	Email      string `json:"email" validate:"required,email"`
	ResetToken string `json:"resetToken"`
	Password   string `json:"password" validate:"required,min=8"`
}
