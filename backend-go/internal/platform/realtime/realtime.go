package realtime

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"nexus-connect/backend-go/internal/platform/cache"
)

// ErrClosed is returned by Subscribe once Close has been called.
var ErrClosed = errors.New("realtime: fanout is closed")

// Fanout is the piece the original TS codebase was missing: a Redis-pub/sub
// subscription that actually has a message handler wired up, so an event
// published by one process reaches subscribers running in a different
// process. See spec §2 ("WebSocket horizontal scaling") and
// ARCHITECTURE.md risk #1 in the harness docs for the gap this closes.
type Fanout struct {
	cache *cache.Cache
	log   *slog.Logger

	mu     sync.Mutex
	closed bool
	nextID uint64
	// subs is keyed by a per-call subscription ID, not channel name —
	// two independent Subscribe calls on the same channel must not share a
	// bookkeeping slot, or unsubscribing one silently drops the other's
	// entry and leaks its goroutine + Redis connection past Close().
	subs map[uint64]func()
}

func NewFanout(c *cache.Cache, log *slog.Logger) *Fanout {
	if log == nil {
		log = slog.Default()
	}
	return &Fanout{
		cache: c,
		log:   log,
		subs:  make(map[uint64]func()),
	}
}

func (f *Fanout) Publish(ctx context.Context, channel string, payload []byte) error {
	return f.cache.Publish(ctx, channel, string(payload))
}

// Subscribe starts a goroutine that forwards every message received on
// channel to handler, until the returned unsubscribe func is called or ctx
// is cancelled. Unlike the original dead-code subscription, this handler is
// the whole point — it is what makes cross-replica delivery actually work.
func (f *Fanout) Subscribe(ctx context.Context, channel string, handler func(payload []byte)) (func(), error) {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return nil, ErrClosed
	}
	id := f.nextID
	f.nextID++
	f.mu.Unlock()

	pubsub := f.cache.Subscribe(ctx, channel)
	subCtx, cancel := context.WithCancel(ctx)
	msgCh := pubsub.Channel()

	// unsubscribe is idempotent (cancel, pubsub.Close, and the map delete all
	// tolerate repeat calls), which matters because it can run from three
	// places: the caller invoking the returned func, Close() tearing down
	// every subscription, and the goroutine below cleaning up after itself
	// when ctx is cancelled out from under it — any two of which may race.
	unsubscribe := func() {
		cancel()
		_ = pubsub.Close()
		f.mu.Lock()
		delete(f.subs, id)
		f.mu.Unlock()
	}

	go func() {
		for {
			select {
			case <-subCtx.Done():
				unsubscribe()
				return
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				func() {
					defer func() {
						if r := recover(); r != nil {
							f.log.Error("realtime subscriber handler panicked",
								"channel", channel, "panic", r)
						}
					}()
					handler([]byte(msg.Payload))
				}()
			}
		}
	}()

	// Re-check closed: Close() may have run its snapshot-and-unlock between
	// our first check above and here, in which case it never saw this
	// subscription and won't tear it down — so we must tear ourselves down
	// instead of registering into a map nothing will ever iterate again.
	// This branch has no deterministic test: the window is microseconds
	// wide (no I/O happens between the two checks) and forcing it open
	// would mean adding a test-only synchronization hook to this method.
	// Verified correct by direct reasoning instead (see Task 10 review
	// notes in docs/superpowers/plans/2026-10-15-go-monolith-foundation.md).
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		unsubscribe()
		return nil, ErrClosed
	}
	f.subs[id] = unsubscribe
	f.mu.Unlock()

	return unsubscribe, nil
}

// Close tears down every active subscription and rejects any future
// Subscribe call. It must not hold f.mu while calling unsubscribe(), since
// unsubscribe() re-acquires f.mu itself to remove its own entry — holding
// the lock across that call would deadlock on Go's non-reentrant sync.Mutex.
func (f *Fanout) Close() error {
	f.mu.Lock()
	f.closed = true
	unsubscribes := make([]func(), 0, len(f.subs))
	for _, unsubscribe := range f.subs {
		unsubscribes = append(unsubscribes, unsubscribe)
	}
	f.mu.Unlock()

	for _, unsubscribe := range unsubscribes {
		unsubscribe()
	}
	return nil
}
