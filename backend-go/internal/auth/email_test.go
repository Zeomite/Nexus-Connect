package auth_test

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testEmailConfig() config.Config {
	return config.Config{
		SMTPHost:  "smtp.example.com",
		SMTPPort:  587,
		SMTPUser:  "",
		EmailFrom: "noreply@nexus.com",
	}
}

func TestSendVerificationEmail_CallsSendFuncWithCodeInBody(t *testing.T) {
	var capturedTo []string
	var capturedMsg []byte
	sender := auth.NewEmailSender(testEmailConfig(), logger.New("test"))
	sender.SetSendFuncForTest(func(addr string, from string, to []string, msg []byte) error {
		capturedTo = to
		capturedMsg = msg
		return nil
	})

	sender.SendVerificationEmail("user@example.com", "123456")

	require.Equal(t, []string{"user@example.com"}, capturedTo)
	assert.True(t, bytes.Contains(capturedMsg, []byte("123456")), "email body must contain the verification code")
	assert.True(t, bytes.Contains(capturedMsg, []byte("Your verification code")), "email subject must match the original")
}

func TestSendPasswordResetEmail_CallsSendFuncWithCodeInBody(t *testing.T) {
	var capturedMsg []byte
	sender := auth.NewEmailSender(testEmailConfig(), logger.New("test"))
	sender.SetSendFuncForTest(func(addr string, from string, to []string, msg []byte) error {
		capturedMsg = msg
		return nil
	})

	sender.SendPasswordResetEmail("user@example.com", "654321")

	assert.True(t, bytes.Contains(capturedMsg, []byte("654321")))
	assert.True(t, bytes.Contains(capturedMsg, []byte("password reset code")), "email subject must match the original")
}

func TestSendVerificationEmail_SwallowsSendError(t *testing.T) {
	var buf bytes.Buffer
	sender := auth.NewEmailSender(testEmailConfig(), logger.NewWithWriter("test", &buf))
	sender.SetSendFuncForTest(func(addr string, from string, to []string, msg []byte) error {
		return errors.New("smtp: connection refused")
	})

	assert.NotPanics(t, func() {
		sender.SendVerificationEmail("user@example.com", "123456")
	})
	assert.True(t, strings.Contains(buf.String(), "level\":\"ERROR\""), "a send failure must be logged, not thrown")
}
