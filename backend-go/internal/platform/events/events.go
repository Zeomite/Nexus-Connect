package events

import (
	"context"
	"log/slog"
	"sync"
)

type Event interface {
	EventType() string
}

type Handler func(ctx context.Context, e Event)

type Bus struct {
	mu          sync.RWMutex
	subscribers map[string][]Handler
	log         *slog.Logger
}

func NewBus(log *slog.Logger) *Bus {
	if log == nil {
		log = slog.Default()
	}
	return &Bus{
		subscribers: make(map[string][]Handler),
		log:         log,
	}
}

func (b *Bus) Subscribe(eventType string, h Handler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subscribers[eventType] = append(b.subscribers[eventType], h)
}

// Publish dispatches e to every subscriber of its EventType() in its own
// goroutine. Mirrors KafkaClient.publish()'s fire-and-forget semantics:
// a subscriber failing (panic or otherwise) is logged, never returned to
// the caller, and never blocks or affects other subscribers.
func (b *Bus) Publish(ctx context.Context, e Event) {
	b.mu.RLock()
	handlers := append([]Handler(nil), b.subscribers[e.EventType()]...)
	b.mu.RUnlock()

	for _, h := range handlers {
		go func(h Handler) {
			defer func() {
				if r := recover(); r != nil {
					b.log.Error("event subscriber panicked",
						"eventType", e.EventType(), "panic", r)
				}
			}()
			h(ctx, e)
		}(h)
	}
}
