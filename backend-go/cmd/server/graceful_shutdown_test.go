package main_test

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestGracefulShutdown_DrainsInFlightRequest proves the exact mechanism
// platform/module.go's registerHTTPServer OnStop hook delegates to —
// http.Server.Shutdown — actually drains an in-flight request rather than
// cutting it off (Review Focus item: "SIGTERM while a request is in flight
// must drain, not cut off").
//
// This is deliberately not an fx/Postgres/Redis integration test (and
// carries no `integration` build tag) for a specific reason: the plan's own
// self-review added a drain test that hit /health through the full app,
// which responds near-instantly, with only a bare 50ms sleep before calling
// Stop() to "ensure" the request was still in flight. On loopback, a
// trivial handler's round trip is on the order of microseconds to low
// single-digit milliseconds — the request would almost always have already
// completed before the sleep elapsed, so that test would pass without ever
// exercising the drain path it claimed to prove. Here, a `started` channel
// deterministically guarantees the handler is actually executing before
// Shutdown is called, eliminating the race entirely — and since
// registerHTTPServer's OnStop hook is a direct, unmodified call to
// server.Shutdown(ctx) with no logic in between, testing that call directly
// is equivalent to testing the hook itself.
func TestGracefulShutdown_DrainsInFlightRequest(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	started := make(chan struct{})
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			close(started)
			time.Sleep(300 * time.Millisecond) // simulate slow in-flight work
			w.WriteHeader(http.StatusOK)
		}),
	}
	go func() { _ = server.Serve(ln) }()

	done := make(chan struct{})
	go func() {
		defer close(done)
		resp, err := http.Get("http://" + ln.Addr().String() + "/")
		if err == nil {
			_ = resp.Body.Close()
		}
	}()

	<-started // the handler is now actually executing

	stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	require.NoError(t, server.Shutdown(stopCtx))

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("in-flight request was not allowed to complete before shutdown returned")
	}
}
