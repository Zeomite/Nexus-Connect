package auth

import "go.uber.org/fx"

var Module = fx.Module("auth",
	fx.Provide(NewStore, NewEmailSender, NewService, NewHandler),
	fx.Invoke(RegisterRoutes),
)
