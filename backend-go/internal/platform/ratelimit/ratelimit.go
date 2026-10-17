package ratelimit

import (
	"context"
	"fmt"
	"time"

	"nexus-connect/backend-go/internal/platform/cache"
)

// slidingWindowScript is a direct port of the Lua script in
// backend/packages/shared/src/middleware/rate-limiter.ts.
const slidingWindowScript = `
	local key = KEYS[1]
	local now = tonumber(ARGV[1])
	local window = tonumber(ARGV[2])
	local limit = tonumber(ARGV[3])
	local ttl = tonumber(ARGV[4])

	redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
	local count = redis.call('ZCARD', key)

	if count < limit then
		redis.call('ZADD', key, now, now .. '-' .. math.random())
		redis.call('PEXPIRE', key, ttl)
		return {1, limit - count - 1, now + window}
	else
		local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
		local resetTime = oldest[2] and (tonumber(oldest[2]) + window) or (now + window)
		return {0, 0, resetTime}
	end
`

type Result struct {
	Allowed           bool
	Remaining         int
	ResetTimeMs       int64
	RetryAfterSeconds int
}

type Limiter struct {
	cache     *cache.Cache
	windowMs  int64
	max       int
	keyPrefix string
}

func New(c *cache.Cache, windowMs int64, max int, keyPrefix string) *Limiter {
	return &Limiter{cache: c, windowMs: windowMs, max: max, keyPrefix: keyPrefix}
}

func (l *Limiter) Check(ctx context.Context, identifier string) (Result, error) {
	key := cache.RateLimitKey(identifier, l.keyPrefix)
	now := time.Now().UnixMilli()

	raw, err := l.cache.Eval(ctx, slidingWindowScript, []string{key}, now, l.windowMs, l.max, l.windowMs+1000)
	if err != nil {
		return Result{}, fmt.Errorf("ratelimit: eval failed: %w", err)
	}

	arr, ok := raw.([]any)
	if !ok || len(arr) != 3 {
		return Result{}, fmt.Errorf("ratelimit: unexpected script return shape: %v", raw)
	}

	allowed := toInt64(arr[0]) == 1
	remaining := int(toInt64(arr[1]))
	resetTime := toInt64(arr[2])

	result := Result{Allowed: allowed, Remaining: remaining, ResetTimeMs: resetTime}
	if !allowed {
		result.RetryAfterSeconds = int((resetTime - now + 999) / 1000)
	}
	return result, nil
}

func toInt64(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	default:
		return 0
	}
}

func NewAuthLimiter(c *cache.Cache) *Limiter {
	return New(c, 15*60*1000, 5, "auth")
}

func NewLoginLimiter(c *cache.Cache) *Limiter {
	return New(c, 60*60*1000, 10, "login")
}

func NewAPILimiter(c *cache.Cache) *Limiter {
	return New(c, 60*1000, 100, "api")
}

func NewMessageLimiter(c *cache.Cache) *Limiter {
	return New(c, 60*1000, 60, "message")
}

func NewCallLimiter(c *cache.Cache) *Limiter {
	return New(c, 60*1000, 10, "call")
}
