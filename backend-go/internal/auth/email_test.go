package auth_test

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testEmailConfig is the shared config.Config fixture for every Service
// test in this package (Task 7 onward), not just email tests — the name
// predates that reuse. JWT fields were added in Task 8, which is the first
// task whose Service methods (Login/RefreshTokens) touch them.
func testEmailConfig() config.Config {
	return config.Config{
		SMTPHost:         "smtp.example.com",
		SMTPPort:         587,
		SMTPUser:         "",
		EmailFrom:        "noreply@nexus.com",
		JWTAccessSecret:  "test-access-secret",
		JWTRefreshSecret: "test-refresh-secret",
		JWTAccessExpiry:  15 * time.Minute,
		JWTRefreshExpiry: 7 * 24 * time.Hour,
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

// TestSendVerificationEmail_RejectsHeaderInjectionInRecipient guards against
// CRLF/email-header injection (CWE-93): the raw SMTP message is built with
// plain fmt.Sprintf, unlike the original's nodemailer, which sanitizes
// addresses internally. A "to" value smuggling a CRLF could otherwise inject
// extra headers (e.g. a Bcc:) or additional message content that the SMTP
// server would interpret as part of the envelope. sendFunc must never be
// called at all for such an input.
func TestSendVerificationEmail_RejectsHeaderInjectionInRecipient(t *testing.T) {
	sendCalled := false
	sender := auth.NewEmailSender(testEmailConfig(), logger.New("test"))
	sender.SetSendFuncForTest(func(addr string, from string, to []string, msg []byte) error {
		sendCalled = true
		return nil
	})

	sender.SendVerificationEmail("victim@example.com\r\nBcc: attacker@evil.com", "123456")

	assert.False(t, sendCalled, "a recipient containing CRLF must never reach the SMTP transport")
}
