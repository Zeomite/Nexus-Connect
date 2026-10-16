package platform

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
	"nexus-connect/backend-go/internal/platform/config"
	"nexus-connect/backend-go/internal/platform/db"
	"nexus-connect/backend-go/internal/platform/events"
	"nexus-connect/backend-go/internal/platform/httpserver"
	"nexus-connect/backend-go/internal/platform/logger"
	"nexus-connect/backend-go/internal/platform/migrations"
	"nexus-connect/backend-go/internal/platform/realtime"

	"github.com/go-chi/chi/v5"
	"go.uber.org/fx"
)

var Module = fx.Module("platform",
	fx.Provide(
		config.Load,
		provideLogger,
		provideDB,
		provideCache,
		provideEventBus,
		provideFanout,
		provideRouter,
	),
	fx.Invoke(
		registerHTTPServer,
		forceUnconsumedProviderConstruction,
	),
)

// forceUnconsumedProviderConstruction exists only because fx builds a
// constructor's value lazily — only when something else in the graph
// actually depends on it. registerHTTPServer takes *chi.Mux, config.Config,
// and *slog.Logger, but not *db.DB, *events.Bus, or *realtime.Fanout — and
// nothing else in this Foundation plan's own fx.Invoke list needs any of
// those three either (no domain module exists yet to query the database or
// subscribe to events/realtime fan-out). Without this, fx would never call
// provideDB/provideEventBus/provideFanout at all: provideDB's migration run
// and connection-pool construction would silently never happen (confirmed
// via a manual fx diagnostic-log run — provideDB never printed a "RUN
// provide:" line without this), and provideFanout's OnStop lifecycle hook
// would never register. Taking all three as plain parameters here forces fx
// to construct them (and their lifecycle hooks) as part of app startup,
// even though their only "consumer" right now is this no-op function. The
// first domain module to add a real dependency on any of them (e.g. `auth`
// requesting *db.DB in its own fx.Invoke) makes that part of this function
// redundant but harmless — fx providers are constructed at most once
// regardless of how many places request them.
func forceUnconsumedProviderConstruction(*db.DB, *events.Bus, *realtime.Fanout) {}

func provideLogger() *slog.Logger {
	return logger.New("nexus-backend-go")
}

func provideDB(lc fx.Lifecycle, cfg config.Config) (*db.DB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.New(ctx, cfg.PostgresDSN(), int32(cfg.PostgresPoolMax))
	if err != nil {
		return nil, err
	}

	if err := migrations.Run(cfg.PostgresDSN()); err != nil {
		pool.Close()
		return nil, err
	}

	lc.Append(fx.Hook{
		OnStop: func(ctx context.Context) error {
			pool.Close()
			return nil
		},
	})
	return pool, nil
}

func provideCache(lc fx.Lifecycle, cfg config.Config) *cache.Cache {
	c := cache.New(cfg.RedisAddr(), cfg.RedisPassword, cfg.RedisDB)
	lc.Append(fx.Hook{
		OnStop: func(ctx context.Context) error {
			return c.Close()
		},
	})
	return c
}

func provideEventBus(log *slog.Logger) *events.Bus {
	return events.NewBus(log)
}

func provideFanout(lc fx.Lifecycle, c *cache.Cache, log *slog.Logger) *realtime.Fanout {
	f := realtime.NewFanout(c, log)
	lc.Append(fx.Hook{
		OnStop: func(ctx context.Context) error {
			return f.Close()
		},
	})
	return f
}

func provideRouter(log *slog.Logger, cfg config.Config) *chi.Mux {
	return httpserver.NewRouter(log, cfg.CORSOrigins)
}

// registerHTTPServer starts the HTTP listener OnStart and performs a
// graceful (connection-draining) shutdown OnStop — Review Focus item:
// "SIGTERM while a request is in flight must drain, not cut off."
func registerHTTPServer(lc fx.Lifecycle, router *chi.Mux, cfg config.Config, log *slog.Logger) {
	server := &http.Server{
		Addr:    ":" + strconv.Itoa(cfg.Port),
		Handler: router,
	}

	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			ln, err := net.Listen("tcp", server.Addr)
			if err != nil {
				return err
			}
			go func() {
				if err := server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
					log.Error("http server error", "error", err)
				}
			}()
			return nil
		},
		OnStop: func(ctx context.Context) error {
			return server.Shutdown(ctx)
		},
	})
}
