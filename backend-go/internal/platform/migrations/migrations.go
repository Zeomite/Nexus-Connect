package migrations

import (
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres" // registers the "postgres" driver via its init()
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

// Run applies every pending migration in sql/ against dsn. Running it
// against an already-up-to-date database is a no-op, not an error —
// Review Focus item: "golang-migrate run twice must not fail."
func Run(dsn string) error {
	source, err := iofs.New(sqlFiles, "sql")
	if err != nil {
		return fmt.Errorf("migrations: loading embedded SQL: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", source, dsn)
	if err != nil {
		return fmt.Errorf("migrations: creating migrate instance: %w", err)
	}

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrations: applying: %w", err)
	}

	srcErr, dbErr := m.Close()
	if srcErr != nil {
		return fmt.Errorf("migrations: closing source: %w", srcErr)
	}
	if dbErr != nil {
		return fmt.Errorf("migrations: closing db: %w", dbErr)
	}
	return nil
}
