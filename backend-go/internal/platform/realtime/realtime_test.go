//go:build integration

package realtime_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/platform/realtime"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
)

// startSharedRedis strips the "redis://" scheme from testcontainers'
// ConnectionString — see backend-go/internal/platform/cache/cache_test.go's
// startRedis for why.
func startSharedRedis(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })
	connStr, err := container.ConnectionString(ctx)
	require.NoError(t, err)
	return strings.TrimPrefix(connStr, "redis://")
}

// TestCrossReplicaDelivery simulates the exact scenario documented as a known
// gap in the original TS code (ARCHITECTURE.md risk #1): a message published
// by "replica A" must be received by a subscriber running in "replica B",
// where A and B are two independent Fanout instances sharing only Redis —
// no shared Go memory, proving this isn't accidentally working via a
// process-local shortcut.
func TestCrossReplicaDelivery(t *testing.T) {
	addr := startSharedRedis(t)

	replicaA := realtime.NewFanout(cache.New(addr, "", 0), logger.New("replica-a"))
	defer replicaA.Close()
	replicaB := realtime.NewFanout(cache.New(addr, "", 0), logger.New("replica-b"))
	defer replicaB.Close()

	ctx := context.Background()
	received := make(chan string, 1)

	unsubscribe, err := replicaB.Subscribe(ctx, "chat:room-1", func(payload []byte) {
		received <- string(payload)
	})
	require.NoError(t, err)
	defer unsubscribe()

	time.Sleep(200 * time.Millisecond) // allow the subscription to register with Redis

	require.NoError(t, replicaA.Publish(ctx, "chat:room-1", []byte("hello from replica A")))

	select {
	case msg := <-received:
		assert.Equal(t, "hello from replica A", msg)
	case <-time.After(3 * time.Second):
		t.Fatal("replica B never received the message published by replica A")
	}
}

func TestConcurrentPublish_NoDataRace(t *testing.T) {
	addr := startSharedRedis(t)
	f := realtime.NewFanout(cache.New(addr, "", 0), logger.New("concurrent-test"))
	defer f.Close()
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_ = f.Publish(ctx, "stress-channel", []byte("msg"))
		}(i)
	}
	wg.Wait()
}

func TestUnsubscribe_StopsDelivery(t *testing.T) {
	addr := startSharedRedis(t)
	publisher := realtime.NewFanout(cache.New(addr, "", 0), logger.New("pub"))
	defer publisher.Close()
	subscriber := realtime.NewFanout(cache.New(addr, "", 0), logger.New("sub"))
	defer subscriber.Close()
	ctx := context.Background()

	var mu sync.Mutex
	count := 0
	unsubscribe, err := subscriber.Subscribe(ctx, "unsub-test", func(payload []byte) {
		mu.Lock()
		count++
		mu.Unlock()
	})
	require.NoError(t, err)

	time.Sleep(200 * time.Millisecond)
	require.NoError(t, publisher.Publish(ctx, "unsub-test", []byte("one")))
	time.Sleep(200 * time.Millisecond)

	unsubscribe()
	time.Sleep(100 * time.Millisecond)

	require.NoError(t, publisher.Publish(ctx, "unsub-test", []byte("two")))
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 1, count, "no message should be delivered after unsubscribe")
}

// TestClose_TearsDownActiveSubscriptionWithoutDeadlock calls Close() while a
// subscription is still registered (never unsubscribed first) — the actual
// shutdown scenario Task 15's fx OnStop hook will trigger. None of the other
// tests exercise this: they all call unsubscribe() (explicitly or via defer
// ordering) before Close() ever runs, so Close() always sees an empty f.subs
// in practice. This matters because Close()'s per-entry call used to hold
// f.mu for the whole iteration while each unsubscribe() also tried to
// re-acquire f.mu to delete its own entry — a self-deadlock on Go's
// non-reentrant sync.Mutex, invisible unless Close() runs with subs non-empty.
func TestClose_TearsDownActiveSubscriptionWithoutDeadlock(t *testing.T) {
	addr := startSharedRedis(t)
	f := realtime.NewFanout(cache.New(addr, "", 0), logger.New("close-test"))
	ctx := context.Background()

	_, err := f.Subscribe(ctx, "close-test-channel", func(payload []byte) {})
	require.NoError(t, err)
	time.Sleep(200 * time.Millisecond)

	done := make(chan struct{})
	go func() {
		_ = f.Close()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Close() deadlocked tearing down an active subscription")
	}
}

// TestSubscribe_AfterCloseReturnsError guards against a Close()/Subscribe()
// ordering gap: a Subscribe racing or following Close() must not silently
// succeed and leave a live, untracked goroutine + Redis connection that
// Close() already believes it tore down everything for.
func TestSubscribe_AfterCloseReturnsError(t *testing.T) {
	addr := startSharedRedis(t)
	f := realtime.NewFanout(cache.New(addr, "", 0), logger.New("closed-test"))
	require.NoError(t, f.Close())

	_, err := f.Subscribe(context.Background(), "after-close", func(payload []byte) {})
	assert.ErrorIs(t, err, realtime.ErrClosed)
}

// TestSubscribe_SameChannelTwiceIndependentUnsubscribe guards against f.subs
// being keyed by channel name alone: two independent Subscribe calls on the
// same channel must not clobber each other's bookkeeping — unsubscribing one
// must not silently drop the other's tracking entry (which would leak its
// goroutine + Redis connection forever once Close() can no longer find it).
func TestSubscribe_SameChannelTwiceIndependentUnsubscribe(t *testing.T) {
	addr := startSharedRedis(t)
	publisher := realtime.NewFanout(cache.New(addr, "", 0), logger.New("pub"))
	defer publisher.Close()
	subscriber := realtime.NewFanout(cache.New(addr, "", 0), logger.New("sub"))
	defer subscriber.Close()
	ctx := context.Background()

	var mu sync.Mutex
	var count1, count2 int
	unsub1, err := subscriber.Subscribe(ctx, "dup-channel", func(payload []byte) {
		mu.Lock()
		count1++
		mu.Unlock()
	})
	require.NoError(t, err)
	unsub2, err := subscriber.Subscribe(ctx, "dup-channel", func(payload []byte) {
		mu.Lock()
		count2++
		mu.Unlock()
	})
	require.NoError(t, err)
	defer unsub2()

	time.Sleep(200 * time.Millisecond)
	require.NoError(t, publisher.Publish(ctx, "dup-channel", []byte("one")))
	time.Sleep(200 * time.Millisecond)

	unsub1()
	time.Sleep(100 * time.Millisecond)

	require.NoError(t, publisher.Publish(ctx, "dup-channel", []byte("two")))
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 1, count1, "handler 1 should only have received the message published before it unsubscribed")
	assert.Equal(t, 2, count2, "handler 2 must keep receiving messages — unsubscribing handler 1 must not affect it")
}
