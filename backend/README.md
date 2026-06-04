# Nexus - Real-Time Communication Platform

A globally scalable, secure, real-time communication platform built with microservices architecture.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           API Gateway (Nginx)                            │
│                              Port: 8080                                  │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
    ▼                     ▼                     ▼
┌─────────┐         ┌─────────┐           ┌─────────┐
│  Auth   │         │  User   │           │  Chat   │
│ Service │         │ Service │           │ Service │
│  :3001  │         │  :3002  │           │  :3003  │
└────┬────┘         └────┬────┘           └────┬────┘
     │                   │                     │
     └───────────────────┼─────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
┌─────────┐        ┌─────────┐          ┌─────────┐
│  Call   │        │  Media  │          │  Group  │
│Signaling│        │ Service │          │ Service │
│  :3004  │        │  :3005  │          │  :3006  │
└─────────┘        └─────────┘          └─────────┘

    ┌────────────────────┬────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
┌─────────┐        ┌─────────┐          ┌─────────┐
│ Expense │        │Notifica-│          │  Call   │
│ Service │        │  tion   │          │ History │
│  :3007  │        │  :3008  │          │  :3009  │
└─────────┘        └─────────┘          └─────────┘

                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
    ▼                    ▼                    ▼
┌─────────┐        ┌─────────┐          ┌─────────┐
│PostgreSQL│       │  Redis  │          │  Kafka  │
│  :5432  │        │  :6379  │          │  :9092  │
└─────────┘        └─────────┘          └─────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- npm or yarn

### Local Development

```bash
# Clone the repository
git clone https://github.com/your-org/nexus.git
cd nexus

# Install dependencies
npm install

# Start infrastructure services
docker-compose up -d postgres redis kafka zookeeper

# Run migrations
npm run migrate --workspace=@nexus/auth-service

# Start services in development mode
npm run dev --workspace=@nexus/auth-service
npm run dev --workspace=@nexus/user-service
npm run dev --workspace=@nexus/chat-service
# ... start other services as needed

# Or start everything with Docker Compose
docker-compose up
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# JWT Secrets (use strong random values in production)
JWT_ACCESS_SECRET=your-256-bit-access-secret
JWT_REFRESH_SECRET=your-256-bit-refresh-secret

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
KAFKA_BROKERS=localhost:9092

# SMTP (for email notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASSWORD=your-password
EMAIL_FROM=noreply@nexus.com
```

## 📦 Microservices

### 1. Auth Service (Port 3001)
- Email registration with verification
- JWT + refresh token authentication
- Password hashing (bcrypt)
- Unique 10-digit user number generation
- Rate limiting with Redis

### 2. User Service (Port 3002)
- Profile management (CRUD)
- Status updates (online/offline/busy/away/dnd)
- Search by 10-digit number
- Profile picture upload

### 3. Chat Service (Port 3003)
- 1-to-1 and group chat
- Real-time messaging via WebSocket
- Message persistence (PostgreSQL)
- Read receipts
- Typing indicators
- Kafka events for message lifecycle

### 4. Call Signaling Service (Port 3004)
- WebRTC signaling (offer/answer/ICE)
- Call state management
- Conference room coordination
- WebSocket-based real-time signaling

### 5. Media Service (Port 3005)
- WebRTC SFU (mediasoup)
- RTP handling
- Conference scaling
- Media state events (mute/video/screen-share)

### 6. Group Service (Port 3006)
- Group creation and management
- Member management with roles (owner/admin/member)
- Permission-based access control

### 7. Expense Service (Port 3007)
- Expense creation with split types (equal/exact/percentage)
- Balance calculation
- Settlement tracking
- Immutable ledger

### 8. Notification Service (Port 3008)
- Email notifications
- Missed call alerts
- Kafka consumer-based processing

### 9. Call History Service (Port 3009)
- Incoming/outgoing/missed call logs
- Conference participant tracking
- Duration and metadata

## 🔌 API Contracts

### Authentication

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecureP@ss123",
  "displayName": "John Doe"
}

Response: 201
{
  "message": "Registration successful. Please check your email.",
  "userId": "uuid",
  "uniqueNumber": "1234567890"
}
```

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecureP@ss123"
}

Response: 200
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "expiresIn": 900,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "John Doe",
    "uniqueNumber": "1234567890"
  }
}
```

### Messaging

```http
POST /api/v1/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "chatId": "uuid",
  "type": "text",
  "content": "Hello, World!"
}
```

### WebSocket Events

#### Chat WebSocket (`/ws/chat`)
```javascript
// Connect
ws://api.nexus.com/ws/chat?token=<access_token>

// Send message
{ "type": "typing:start", "payload": { "chatId": "uuid" } }
{ "type": "message:read", "payload": { "chatId": "uuid", "messageIds": ["uuid1", "uuid2"] } }

// Receive events
{ "event": "message:new", "data": { ... } }
{ "event": "typing:start", "data": { "chatId": "uuid", "userId": "uuid" } }
{ "event": "message:read", "data": { "messageIds": [...], "readBy": "uuid" } }
```

#### Call Signaling WebSocket (`/ws/signaling`)
```javascript
// Connect
ws://api.nexus.com/ws/signaling?token=<access_token>&callId=<call_id>

// Signaling messages
{ "type": "offer", "payload": { "toUserId": "uuid", "offer": { "type": "offer", "sdp": "..." } } }
{ "type": "answer", "payload": { "toUserId": "uuid", "answer": { "type": "answer", "sdp": "..." } } }
{ "type": "ice-candidate", "payload": { "toUserId": "uuid", "candidate": { ... } } }
{ "type": "mute", "payload": { "isMuted": true } }
{ "type": "video", "payload": { "isVideoEnabled": false } }
```

## 📊 Database Schema

See `infrastructure/postgres/init.sql` for complete schema.

### Key Tables
- `users` - User accounts
- `chats` - Chat rooms
- `chat_participants` - Chat membership
- `messages` - Chat messages
- `calls` - Call sessions
- `call_participants` - Call membership
- `call_history` - Call logs
- `groups` - User groups
- `group_members` - Group membership
- `expenses` - Expense records
- `expense_splits` - Split amounts
- `ledger_entries` - Immutable transaction log

## 🔄 Kafka Topics

| Topic | Purpose | Partitions |
|-------|---------|------------|
| `nexus.user.events` | User lifecycle events | 6 |
| `nexus.user.status` | Online status changes | 12 |
| `nexus.chat.messages` | Message events | 24 |
| `nexus.chat.events` | Chat lifecycle events | 12 |
| `nexus.call.events` | Call lifecycle events | 12 |
| `nexus.call.signaling` | Signaling relay | 24 |
| `nexus.group.events` | Group lifecycle events | 6 |
| `nexus.expense.events` | Expense events | 6 |
| `nexus.notifications` | Notification dispatch | 12 |
| `nexus.notifications.email` | Email queue | 6 |

## 🔒 Security

### Authentication Flow
1. User registers → Email verification sent
2. User verifies email → Account activated
3. User logs in → JWT access token (15min) + refresh token (7days)
4. Client uses access token for API calls
5. On expiry, client uses refresh token to get new pair

### Security Features
- Password hashing with bcrypt (12 rounds)
- JWT with RS256/HS256
- Rate limiting per endpoint
- CORS configuration
- Helmet security headers
- Input validation with Zod
- SQL injection prevention (parameterized queries)

### E2E Encryption Hooks
The platform provides encryption utilities for implementing end-to-end encryption:
- `encryptData()` / `decryptData()` - AES-256-GCM
- `deriveKey()` - scrypt key derivation
- Key exchange can be implemented at the application layer

## 📈 Scaling Strategy

### 10 → 1M Users

| Stage | Users | Infrastructure |
|-------|-------|----------------|
| MVP | 10-1K | Single instance per service, managed DB |
| Growth | 1K-100K | 3 replicas, Redis cluster, Kafka cluster |
| Scale | 100K-1M | 10+ replicas, sharded DB, multi-region |

### Scaling Considerations

1. **Stateless Services**: All services are stateless, using Redis for session/state
2. **Database**: 
   - Read replicas for query scaling
   - Connection pooling (max 20 per service)
   - Consider sharding by user_id for 1M+ users
3. **Kafka**: 
   - Increase partitions for high-throughput topics
   - Consumer groups auto-scale with replicas
4. **WebSocket**: 
   - Redis pub/sub for cross-instance messaging
   - Sticky sessions via Ingress annotations
5. **Media**: 
   - Horizontal scaling with mediasoup workers
   - Geographic distribution with regional SFUs

## 🛠️ Development

### Project Structure

```
nexus/
├── packages/
│   └── shared/              # Shared types, utilities, middleware
├── services/
│   ├── auth-service/        # Authentication
│   ├── user-service/        # User profiles
│   ├── chat-service/        # Messaging
│   ├── call-signaling-service/  # WebRTC signaling
│   ├── media-service/       # SFU
│   ├── group-service/       # Groups
│   ├── expense-service/     # Expenses
│   ├── notification-service/    # Notifications
│   └── call-history-service/    # Call logs
├── infrastructure/
│   ├── postgres/            # Database init
│   ├── nginx/               # API gateway config
│   └── kubernetes/          # K8s manifests
├── docker-compose.yml
└── package.json
```

### Adding a New Service

1. Create directory under `services/`
2. Add `package.json`, `tsconfig.json`
3. Implement routes and services
4. Add Dockerfile
5. Update `docker-compose.yml`
6. Add Kubernetes manifests
7. Update ingress routes

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific service tests
npm test --workspace=@nexus/auth-service

# Run with coverage
npm test -- --coverage
```

## 📚 Documentation

- API docs available at `/docs` on each service (Swagger UI)
- WebSocket event documentation in this README
- Database schema in `infrastructure/postgres/init.sql`

## 🚢 Deployment

### Kubernetes

```bash
# Create namespace
kubectl apply -f infrastructure/kubernetes/namespace.yaml

# Apply configs and secrets
kubectl apply -f infrastructure/kubernetes/configmap.yaml

# Deploy services
kubectl apply -f infrastructure/kubernetes/deployments/

# Apply ingress
kubectl apply -f infrastructure/kubernetes/ingress.yaml
```

### Environment Requirements

- Kubernetes 1.25+
- Nginx Ingress Controller
- cert-manager (for TLS)
- PostgreSQL 15+ (managed recommended)
- Redis 7+ (managed recommended)
- Kafka 3.5+ (managed recommended)

## 📄 License

MIT License - see LICENSE file for details.
