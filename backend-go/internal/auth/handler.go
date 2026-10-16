package auth

import (
	"encoding/json"
	"log/slog"
	"net/http"

	apperrors "nexus-connect/backend-go/internal/platform/errors"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/validate"
)

type Handler struct {
	svc *Service
	log *slog.Logger
}

func NewHandler(svc *Service, log *slog.Logger) *Handler {
	return &Handler{svc: svc, log: log}
}

func decodeAndValidate[T any](r *http.Request) (T, error) {
	var req T
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, apperrors.BadRequest("Invalid request body", nil)
	}
	if err := validate.Struct(req); err != nil {
		return req, err
	}
	return req, nil
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[registerRequest](r)
	if err != nil {
		return err
	}

	result, err := h.svc.Register(r.Context(), RegisterInput{
		Email: req.Email, Password: req.Password, DisplayName: req.DisplayName,
	})
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusCreated, map[string]any{
		"message":      "Registration successful. Please check your email to verify your account.",
		"userId":       result.UserID,
		"uniqueNumber": result.UniqueNumber,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[loginRequest](r)
	if err != nil {
		return err
	}

	result, err := h.svc.Login(r.Context(), LoginInput{Email: req.Email, Password: req.Password})
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken":  result.AccessToken,
		"refreshToken": result.RefreshToken,
		"expiresIn":    result.ExpiresIn,
		"user": map[string]any{
			"id":           result.User.ID,
			"email":        result.User.Email,
			"displayName":  result.User.DisplayName,
			"uniqueNumber": result.User.UniqueNumber,
		},
	})
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[refreshRequest](r)
	if err != nil {
		return err
	}

	result, err := h.svc.RefreshTokens(r.Context(), req.RefreshToken)
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken":  result.AccessToken,
		"refreshToken": result.RefreshToken,
		"expiresIn":    result.ExpiresIn,
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[logoutRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.Logout(r.Context(), req.RefreshToken); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[verifyEmailRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.VerifyEmail(r.Context(), req.Email, req.Code); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"message": "Email verified successfully"})
}

func (h *Handler) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[resendVerificationRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.ResendVerificationEmail(r.Context(), req.Email); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"message": "If the email exists, a verification email has been sent",
	})
}

func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[forgotPasswordRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.ForgotPassword(r.Context(), req.Email); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"message": "If the email exists, a password reset link has been sent",
	})
}

func (h *Handler) VerifyResetCode(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[verifyResetCodeRequest](r)
	if err != nil {
		return err
	}

	resetToken, err := h.svc.VerifyResetCode(r.Context(), req.Email, req.Code)
	if err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{
		"message":    "Code verified successfully",
		"resetToken": resetToken,
	})
}

func (h *Handler) UpdatePassword(w http.ResponseWriter, r *http.Request) error {
	req, err := decodeAndValidate[updatePasswordRequest](r)
	if err != nil {
		return err
	}

	if err := h.svc.UpdatePassword(r.Context(), req.Email, req.ResetToken, req.Password); err != nil {
		return err
	}

	return httpserver.WriteJSON(w, http.StatusOK, map[string]string{"message": "Password reset successfully"})
}
