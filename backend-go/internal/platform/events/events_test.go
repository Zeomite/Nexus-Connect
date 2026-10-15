package events_test

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/logger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testEvent struct {
	msg string
}

func (t testEvent) EventType() string { return "test.event" }

func TestPublish_DeliversToSubscriber(t *testing.T) {
	bus := events.NewBus(logger.New("test"))

	received := make(chan string, 1)
	bus.Subscribe("test.event", func(ctx context.Context, e events.Event) {
		received <- e.(testEvent).msg
	})

	bus.Publish(context.Background(), testEvent{msg: "hello"})

	select {
	case msg := <-received:
		assert.Equal(t, "hello", msg)
	case <-time.After(time.Second):
		t.Fatal("subscriber was never called")
	}
}

func TestPublish_DeliversToMultipleSubscribers(t *testing.T) {
	bus := events.NewBus(logger.New("test"))
	var mu sync.Mutex
	var calls int

	for i := 0; i < 3; i++ {
		bus.Subscribe("test.event", func(ctx context.Context, e events.Event) {
			mu.Lock()
			calls++
			mu.Unlock()
		})
	}

	bus.Publish(context.Background(), testEvent{msg: "x"})
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 3, calls)
}

func TestPublish_NoSubscribersDoesNotBlock(t *testing.T) {
	bus := events.NewBus(logger.New("test"))
	done := make(chan struct{})
	go func() {
		bus.Publish(context.Background(), testEvent{msg: "nobody listening"})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Publish blocked with no subscribers")
	}
}

func TestPublish_RecoversFromPanickingSubscriber(t *testing.T) {
	var buf bytes.Buffer
	log := logger.NewWithWriter("test", &buf)
	bus := events.NewBus(log)

	recovered := make(chan struct{})
	bus.Subscribe("test.event", func(ctx context.Context, e events.Event) {
		defer close(recovered)
		panic("boom")
	})

	require.NotPanics(t, func() {
		bus.Publish(context.Background(), testEvent{msg: "x"})
	})

	select {
	case <-recovered:
	case <-time.After(time.Second):
		t.Fatal("panicking subscriber was never invoked")
	}
}

// TestNewBus_NilLoggerSurvivesPanickingSubscriber re-execs this test binary as a
// subprocess because the bug it guards against (NewBus(nil) + a panicking
// subscriber) crashes the whole process, not just the test: the recover()
// in Publish's goroutine swallows the subscriber's panic, but logging it via
// a nil *slog.Logger nil-derefs inside that same deferred func — a second,
// unrecovered panic that takes down the process. That can't be observed with
// require.NotPanics in-process; it has to be an exit-code check on a child.
func TestNewBus_NilLoggerSurvivesPanickingSubscriber(t *testing.T) {
	if os.Getenv("EVENTS_TEST_SUBPROCESS") == "1" {
		bus := events.NewBus(nil)
		bus.Subscribe("test.event", func(ctx context.Context, e events.Event) {
			panic("boom")
		})
		bus.Publish(context.Background(), testEvent{msg: "x"})
		time.Sleep(200 * time.Millisecond)
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=TestNewBus_NilLoggerSurvivesPanickingSubscriber")
	cmd.Env = append(os.Environ(), "EVENTS_TEST_SUBPROCESS=1")
	output, err := cmd.CombinedOutput()
	require.NoError(t, err, "subprocess must exit cleanly; a crash means NewBus(nil) is unsafe when a subscriber panics:\n%s", output)
}
