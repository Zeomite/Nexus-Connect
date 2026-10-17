package logger_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"nexus-connect/backend-go/internal/platform/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_RedactsSensitiveFields(t *testing.T) {
	var buf bytes.Buffer
	l := logger.NewWithWriter("test-service", &buf)

	l.Info("user logged in", "password", "hunter2", "token", "abc.def.ghi", "userId", "u-1")

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &decoded))

	assert.Equal(t, logger.RedactedValue, decoded["password"])
	assert.Equal(t, logger.RedactedValue, decoded["token"])
	assert.Equal(t, "u-1", decoded["userId"], "non-sensitive fields must pass through untouched")
}

func TestNew_IncludesServiceName(t *testing.T) {
	var buf bytes.Buffer
	l := logger.NewWithWriter("chat-service", &buf)
	l.Info("hello")

	assert.True(t, strings.Contains(buf.String(), `"service":"chat-service"`))
}

func TestNew_DefaultsToStdout(t *testing.T) {
	l := logger.New("foundation")
	assert.NotNil(t, l)
	assert.IsType(t, &slog.Logger{}, l)
}
