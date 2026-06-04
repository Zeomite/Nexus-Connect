# Environment Configuration

## Required Environment Variables

### JWT Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_ACCESS_SECRET` | Secret for signing access tokens | (required) |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | (required) |
| `JWT_ACCESS_EXPIRY` | Access token expiry | `15m` |
| `JWT_REFRESH_EXPIRY` | Refresh token expiry | `7d` |

### PostgreSQL Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_HOST` | Database host | `localhost` |
| `POSTGRES_PORT` | Database port | `5432` |
| `POSTGRES_DB` | Database name | `nexus` |
| `POSTGRES_USER` | Database user | `postgres` |
| `POSTGRES_PASSWORD` | Database password | (required) |
| `POSTGRES_POOL_MAX` | Max pool connections | `20` |

### Redis Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | (optional) |
| `REDIS_DB` | Redis database | `0` |

### Kafka Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `KAFKA_BROKERS` | Kafka broker list (comma-separated) | `localhost:9092` |
| `KAFKA_SSL` | Enable SSL | `false` |
| `KAFKA_SASL_USERNAME` | SASL username | (optional) |
| `KAFKA_SASL_PASSWORD` | SASL password | (optional) |

### SMTP Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server host | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Use TLS | `false` |
| `SMTP_USER` | SMTP username | (required for email) |
| `SMTP_PASSWORD` | SMTP password | (required for email) |
| `EMAIL_FROM` | From email address | `noreply@nexus.com` |

### Frontend URLs
| Variable | Description | Default |
|----------|-------------|---------|
| `FRONTEND_URL` | Frontend application URL | `http://localhost:3000` |
| `EMAIL_VERIFICATION_URL` | Email verification page URL | `http://localhost:3000/verify-email` |
| `PASSWORD_RESET_URL` | Password reset page URL | `http://localhost:3000/reset-password` |

### Media Service (mediasoup)
| Variable | Description | Default |
|----------|-------------|---------|
| `MEDIASOUP_NUM_WORKERS` | Number of workers | CPU count |
| `MEDIASOUP_LISTEN_IP` | Listen IP | `0.0.0.0` |
| `MEDIASOUP_ANNOUNCED_IP` | Public IP (for NAT) | (auto-detect) |
| `RTC_MIN_PORT` | Minimum RTC port | `40000` |
| `RTC_MAX_PORT` | Maximum RTC port | `49999` |

### Object Storage
| Variable | Description | Default |
|----------|-------------|---------|
| `STORAGE_BUCKET` | S3 bucket name | `nexus-profiles` |
| `STORAGE_REGION` | S3 region | `us-east-1` |
| `STORAGE_ENDPOINT` | Custom endpoint (for MinIO) | (optional) |
| `STORAGE_ACCESS_KEY` | Access key | (required for uploads) |
| `STORAGE_SECRET_KEY` | Secret key | (required for uploads) |

### TURN Server (WebRTC)
| Variable | Description | Default |
|----------|-------------|---------|
| `TURN_URL` | TURN server URL | (optional) |
| `TURN_USERNAME` | TURN username | (optional) |
| `TURN_CREDENTIAL` | TURN credential | (optional) |

## Sample Development Configuration

```bash
# Create .env file
cat > .env << 'EOF'
# JWT
JWT_ACCESS_SECRET=dev-access-secret-32-chars-min
JWT_REFRESH_SECRET=dev-refresh-secret-32-chars-min

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=nexus
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Kafka
KAFKA_BROKERS=localhost:29092

# CORS
CORS_ORIGINS=http://localhost:3000
EOF
```

## Production Recommendations

1. **Secrets Management**: Use Kubernetes Secrets or a vault service
2. **JWT Secrets**: Generate cryptographically secure 256-bit secrets
3. **Database**: Use managed PostgreSQL with SSL enabled
4. **Redis**: Use managed Redis with password authentication
5. **Kafka**: Use managed Kafka with SASL authentication
6. **TURN Server**: Deploy TURN servers for WebRTC NAT traversal
