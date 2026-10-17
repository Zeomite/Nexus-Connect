package main

import (
	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform"

	"go.uber.org/fx"
)

func main() {
	fx.New(platform.Module, auth.Module).Run()
}
