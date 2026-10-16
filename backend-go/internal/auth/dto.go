package auth

// Request DTOs. JSON tags match the wire format the frontend already sends
// (zero frontend changes, per spec §1). validate tags enforce exactly what
// the original enforces — see this plan's Global Constraints for the two
// documented asymmetries (no password_strength anywhere; UpdatePassword has
// no password max length, unlike Register).

type registerRequest struct {
	Email       string `json:"email" validate:"required,email"`
	Password    string `json:"password" validate:"required,min=8,max=128"`
	DisplayName string `json:"displayName" validate:"required,min=1,max=100"`
}

type loginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken" validate:"required"`
}

type logoutRequest struct {
	RefreshToken string `json:"refreshToken" validate:"required"`
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
	ResetToken string `json:"resetToken" validate:"required"`
	Password   string `json:"password" validate:"required,min=8"`
}
