package logger

import (
	"io"
	"log/slog"
	"os"
)

const RedactedValue = "[REDACTED]"

var sensitiveKeys = map[string]bool{
	"password":     true,
	"token":        true,
	"refreshToken": true,
	"accessToken":  true,
}

func New(serviceName string) *slog.Logger {
	return NewWithWriter(serviceName, os.Stdout)
}

func NewWithWriter(serviceName string, w io.Writer) *slog.Logger {
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if sensitiveKeys[a.Key] {
				a.Value = slog.StringValue(RedactedValue)
			}
			return a
		},
	})
	return slog.New(handler).With("service", serviceName)
}
