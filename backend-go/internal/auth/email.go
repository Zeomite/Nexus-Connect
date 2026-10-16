package auth

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"strconv"

	"nexus-connect/backend-go/internal/platform/config"
)

// sendFunc matches the shape of net/smtp.SendMail minus the smtp.Auth
// parameter (constructed internally from cfg, since it's nil whenever
// SMTPUser is empty — exactly like the original's `auth: config.email.user
// ? {...} : undefined`), so tests can inject a fake without a real SMTP
// server.
type sendFunc func(addr string, from string, to []string, msg []byte) error

// EmailSender ports EmailService from
// backend/services/auth-service/src/services/email.service.ts. Every send
// method swallows its own error (logs instead) — "email failures shouldn't
// block registration" in the original's own words — so nothing in this type
// ever returns an error to its caller.
type EmailSender struct {
	cfg  config.Config
	log  *slog.Logger
	send sendFunc
}

func NewEmailSender(cfg config.Config, log *slog.Logger) *EmailSender {
	e := &EmailSender{cfg: cfg, log: log}
	e.send = e.realSend
	return e
}

// SetSendFuncForTest overrides the SMTP transport. Exported (not a
// lowercase field) so this package's own _test.go files, which are in the
// external auth_test package like every other test in this module, can use
// it without needing internal-package test-only exports.
func (e *EmailSender) SetSendFuncForTest(fn sendFunc) {
	e.send = fn
}

func (e *EmailSender) realSend(addr string, from string, to []string, msg []byte) error {
	var auth smtp.Auth
	if e.cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", e.cfg.SMTPUser, e.cfg.SMTPPassword, e.cfg.SMTPHost)
	}
	return smtp.SendMail(addr, auth, from, to, msg)
}

func (e *EmailSender) SendVerificationEmail(to, code string) {
	subject := "Your verification code - Nexus"
	body := fmt.Sprintf(
		"Welcome to Nexus! Your verification code is: %s. Enter this code in the app to verify your email.",
		code,
	)
	e.sendOne(to, subject, body, "verification")
}

func (e *EmailSender) SendPasswordResetEmail(to, code string) {
	subject := "Your password reset code - Nexus"
	body := fmt.Sprintf(
		"Your password reset code is: %s. Enter this code in the app to reset your password. This code expires in 1 hour.",
		code,
	)
	e.sendOne(to, subject, body, "password reset")
}

func (e *EmailSender) sendOne(to, subject, body, kind string) {
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n",
		e.cfg.EmailFrom, to, subject, body)

	addr := e.cfg.SMTPHost + ":" + strconv.Itoa(e.cfg.SMTPPort)
	if err := e.send(addr, e.cfg.EmailFrom, []string{to}, []byte(msg)); err != nil {
		e.log.Error("failed to send "+kind+" email", "to", to, "error", err)
		return
	}
	e.log.Info(kind+" email sent", "to", to)
}
