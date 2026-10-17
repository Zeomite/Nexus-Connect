package cache

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

var ErrNotFound = errors.New("cache: key not found")

type Cache struct {
	client *redis.Client
}

func New(addr, password string, db int) *Cache {
	return &Cache{client: redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})}
}

func (c *Cache) Get(ctx context.Context, key string) (string, error) {
	val, err := c.client.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return val, nil
}

func (c *Cache) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	return c.client.Set(ctx, key, value, ttl).Err()
}

func (c *Cache) Del(ctx context.Context, keys ...string) error {
	return c.client.Del(ctx, keys...).Err()
}

// GetDel atomically reads and deletes key in one round trip (Redis GETDEL),
// closing the TOCTOU window a separate Get-then-Del leaves open: two
// concurrent callers racing the same key could otherwise both pass the Get
// before either Del lands. Only one caller of GetDel ever gets the value;
// every other concurrent (or later) caller gets ErrNotFound.
func (c *Cache) GetDel(ctx context.Context, key string) (string, error) {
	val, err := c.client.GetDel(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return val, nil
}

// MGet reads every key in one Redis round trip. The returned map contains
// an entry only for keys that actually had a value — go-redis's MGet
// returns a nil interface{} for a missing key, which this collapses to
// "absent from the map" rather than a zero-value "" entry, so callers
// can't mistake a cache miss for a cached empty string.
func (c *Cache) MGet(ctx context.Context, keys []string) (map[string]string, error) {
	if len(keys) == 0 {
		return map[string]string{}, nil
	}

	vals, err := c.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	result := make(map[string]string, len(keys))
	for i, v := range vals {
		if v == nil {
			continue
		}
		s, ok := v.(string)
		if !ok {
			continue
		}
		result[keys[i]] = s
	}
	return result, nil
}

func (c *Cache) SAdd(ctx context.Context, key string, members ...string) error {
	return c.client.SAdd(ctx, key, members).Err()
}

func (c *Cache) SRem(ctx context.Context, key string, members ...string) error {
	return c.client.SRem(ctx, key, members).Err()
}

func (c *Cache) Exists(ctx context.Context, key string) (bool, error) {
	n, err := c.client.Exists(ctx, key).Result()
	return n == 1, err
}

func (c *Cache) Eval(ctx context.Context, script string, keys []string, args ...any) (any, error) {
	return c.client.Eval(ctx, script, keys, args...).Result()
}

func (c *Cache) Publish(ctx context.Context, channel, message string) error {
	return c.client.Publish(ctx, channel, message).Err()
}

func (c *Cache) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	return c.client.Subscribe(ctx, channels...)
}

func (c *Cache) HealthCheck(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

func (c *Cache) Close() error {
	return c.client.Close()
}
