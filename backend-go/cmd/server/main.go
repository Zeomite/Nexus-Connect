package main

import (
	"nexus-connect/backend-go/internal/auth"
	"nexus-connect/backend-go/internal/platform"
	"nexus-connect/backend-go/internal/user"

	"go.uber.org/fx"
)

func main() {
	fx.New(platform.Module, auth.Module, user.Module).Run()
}
