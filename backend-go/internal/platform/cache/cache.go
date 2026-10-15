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
