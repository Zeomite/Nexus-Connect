# API Contracts

## Base URL

- Development: `http://localhost:8080`
- Production: `https://api.nexus.com`

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```http
Authorization: Bearer <access_token>
```

---

## Auth Service

### Register User
```http
POST /api/v1/auth/register

Request:
{
  "email": "user@example.com",
  "password": "SecureP@ss123!",
  "displayName": "John Doe"
}

Response 201:
{
  "message": "Registration successful. Please check your email.",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "uniqueNumber": "1234567890"
}

Errors:
- 409: Email already registered
- 422: Validation error
- 429: Rate limit exceeded
```

### Login
```http
POST /api/v1/auth/login

Request:
{
  "email": "user@example.com",
  "password": "SecureP@ss123!"
}

Response 200:
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "expiresIn": 900,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "displayName": "John Doe",
    "uniqueNumber": "1234567890"
  }
}

Errors:
- 401: Invalid credentials
- 403: Email not verified
- 429: Rate limit exceeded
```

### Refresh Token
```http
POST /api/v1/auth/refresh

Request:
{
  "refreshToken": "eyJhbG..."
}

Response 200:
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "expiresIn": 900
}
```

### Verify Email
```http
POST /api/v1/auth/verify-email

Request:
{
  "token": "verification-token"
}

Response 200:
{
  "message": "Email verified successfully"
}
```

### Forgot Password
```http
POST /api/v1/auth/forgot-password

Request:
{
  "email": "user@example.com"
}

Response 200:
{
  "message": "If the email exists, a password reset link has been sent"
}
```

### Reset Password
```http
POST /api/v1/auth/reset-password

Request:
{
  "token": "reset-token",
  "password": "NewSecureP@ss123!"
}

Response 200:
{
  "message": "Password reset successfully"
}
```

---

## User Service

### Get Current User Profile
```http
GET /api/v1/users/me
Authorization: Bearer <token>

Response 200:
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "uniqueNumber": "1234567890",
  "displayName": "John Doe",
  "profilePictureUrl": "https://...",
  "status": "online",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Update Profile
```http
PATCH /api/v1/users/me
Authorization: Bearer <token>

Request:
{
  "displayName": "John Smith",
  "profilePictureUrl": "https://..."
}

Response 200:
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "John Smith",
  "profilePictureUrl": "https://..."
}
```

### Update Status
```http
PATCH /api/v1/users/me/status
Authorization: Bearer <token>

Request:
{
  "status": "busy"
}

Response 200:
{
  "status": "busy"
}

Valid statuses: online, offline, busy, away, do_not_disturb
```

### Search by Unique Number
```http
GET /api/v1/search/by-number/1234567890
Authorization: Bearer <token>

Response 200:
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "John Doe",
  "uniqueNumber": "1234567890",
  "profilePictureUrl": "https://...",
  "status": "online"
}
```

### Search Users by Name
```http
GET /api/v1/search/users?query=john&page=1&limit=20
Authorization: Bearer <token>

Response 200:
{
  "users": [
    {
      "id": "...",
      "displayName": "John Doe",
      "uniqueNumber": "1234567890",
      "profilePictureUrl": "...",
      "status": "online"
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 20
}
```

---

## Chat Service

### Get User's Chats
```http
GET /api/v1/chats?page=1&limit=20
Authorization: Bearer <token>

Response 200:
{
  "chats": [
    {
      "id": "chat-uuid",
      "type": "direct",
      "name": "John Doe",
      "lastMessage": {
        "id": "msg-uuid",
        "content": "Hello!",
        "senderId": "user-uuid",
        "createdAt": "2024-01-01T12:00:00Z"
      },
      "unreadCount": 5,
      "participants": [
        {
          "id": "user-uuid",
          "displayName": "John Doe",
          "profilePictureUrl": "..."
        }
      ]
    }
  ],
  "total": 10,
  "page": 1,
  "limit": 20
}
```

### Create Direct Chat
```http
POST /api/v1/chats/direct
Authorization: Bearer <token>

Request:
{
  "participantId": "user-uuid"
}

Response 201:
{
  "id": "chat-uuid",
  "type": "direct",
  "isNew": true
}
```

### Create Group Chat
```http
POST /api/v1/chats/group
Authorization: Bearer <token>

Request:
{
  "name": "Project Team",
  "participantIds": ["user-uuid-1", "user-uuid-2"]
}

Response 201:
{
  "id": "chat-uuid",
  "type": "group",
  "name": "Project Team"
}
```

### Send Message
```http
POST /api/v1/messages
Authorization: Bearer <token>

Request:
{
  "chatId": "chat-uuid",
  "type": "text",
  "content": "Hello, World!",
  "replyToId": "msg-uuid" // optional
}

Response 201:
{
  "id": "msg-uuid",
  "chatId": "chat-uuid",
  "senderId": "user-uuid",
  "type": "text",
  "content": "Hello, World!",
  "status": "sent",
  "createdAt": "2024-01-01T12:00:00Z"
}

Message types: text, image, file, audio, video
```

### Get Chat Messages
```http
GET /api/v1/messages/chat/{chatId}?page=1&limit=50&before=2024-01-01T12:00:00Z
Authorization: Bearer <token>

Response 200:
{
  "messages": [
    {
      "id": "msg-uuid",
      "senderId": "user-uuid",
      "type": "text",
      "content": "Hello!",
      "status": "read",
      "replyToId": null,
      "createdAt": "2024-01-01T12:00:00Z"
    }
  ],
  "hasMore": true
}
```

### Mark Messages as Read
```http
POST /api/v1/messages/read
Authorization: Bearer <token>

Request:
{
  "chatId": "chat-uuid",
  "messageIds": ["msg-uuid-1", "msg-uuid-2"]
}

Response 200:
{
  "message": "Messages marked as read"
}
```

---

## Call Service

### Initiate Call
```http
POST /api/v1/calls/initiate
Authorization: Bearer <token>

Request:
{
  "participantIds": ["user-uuid-1", "user-uuid-2"],
  "type": "video",
  "groupId": "group-uuid" // optional for group calls
}

Response 201:
{
  "callId": "call-uuid",
  "roomId": "room_abc123",
  "type": "video",
  "wsUrl": "wss://api.nexus.com/ws/signaling?callId=call-uuid"
}
```

### Accept Call
```http
POST /api/v1/calls/{callId}/accept
Authorization: Bearer <token>

Response 200:
{
  "callId": "call-uuid",
  "roomId": "room_abc123",
  "wsUrl": "wss://api.nexus.com/ws/signaling?callId=call-uuid"
}
```

### Decline Call
```http
POST /api/v1/calls/{callId}/decline
Authorization: Bearer <token>

Response 200:
{
  "message": "Call declined"
}
```

### End Call
```http
POST /api/v1/calls/{callId}/end
Authorization: Bearer <token>

Response 200:
{
  "message": "Call ended"
}
```

### Get Active Calls
```http
GET /api/v1/calls/active
Authorization: Bearer <token>

Response 200:
{
  "calls": [
    {
      "callId": "call-uuid",
      "type": "video",
      "status": "ongoing"
    }
  ]
}
```

---

## Group Service

### Create Group
```http
POST /api/v1/groups
Authorization: Bearer <token>

Request:
{
  "name": "Project Team",
  "description": "Our awesome project team",
  "memberIds": ["user-uuid-1", "user-uuid-2"]
}

Response 201:
{
  "id": "group-uuid",
  "name": "Project Team"
}
```

### Get User's Groups
```http
GET /api/v1/groups
Authorization: Bearer <token>

Response 200:
{
  "groups": [
    {
      "id": "group-uuid",
      "name": "Project Team",
      "role": "owner"
    }
  ]
}
```

### Add Member
```http
POST /api/v1/groups/{groupId}/members
Authorization: Bearer <token>

Request:
{
  "userId": "user-uuid"
}

Response 200:
{
  "message": "Member added"
}
```

---

## Expense Service

### Create Expense (Equal Split)
```http
POST /api/v1/expenses
Authorization: Bearer <token>

Request:
{
  "groupId": "group-uuid",
  "description": "Dinner",
  "totalAmount": 100.00,
  "currency": "USD",
  "splitType": "equal",
  "participantIds": ["user-uuid-1", "user-uuid-2", "user-uuid-3"],
  "paidById": "user-uuid-1"
}

Response 201:
{
  "id": "expense-uuid"
}
```

### Create Expense (Percentage Split)
```http
POST /api/v1/expenses
Authorization: Bearer <token>

Request:
{
  "groupId": "group-uuid",
  "description": "Trip",
  "totalAmount": 500.00,
  "currency": "USD",
  "splitType": "percentage",
  "splits": [
    { "userId": "user-uuid-1", "percentage": 50 },
    { "userId": "user-uuid-2", "percentage": 30 },
    { "userId": "user-uuid-3", "percentage": 20 }
  ],
  "paidById": "user-uuid-1"
}

Response 201:
{
  "id": "expense-uuid"
}
```

### Get Group Balances
```http
GET /api/v1/groups/{groupId}/balances
Authorization: Bearer <token>

Response 200:
{
  "balances": [
    { "user_id": "user-uuid-1", "net_balance": 66.67 },
    { "user_id": "user-uuid-2", "net_balance": -33.33 },
    { "user_id": "user-uuid-3", "net_balance": -33.34 }
  ]
}
```

### Record Settlement
```http
POST /api/v1/settlements
Authorization: Bearer <token>

Request:
{
  "groupId": "group-uuid",
  "toUserId": "user-uuid-1",
  "amount": 33.33,
  "currency": "USD"
}

Response 201:
{
  "id": "ledger-entry-uuid"
}
```

---

## Call History Service

### Get Call History
```http
GET /api/v1/history?page=1&limit=20
Authorization: Bearer <token>

Response 200:
{
  "history": [
    {
      "id": "history-uuid",
      "callId": "call-uuid",
      "direction": "incoming",
      "type": "video",
      "status": "answered",
      "duration": 300,
      "participantCount": 2,
      "createdAt": "2024-01-01T12:00:00Z"
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 20
}

Status values: answered, missed, declined
Direction values: incoming, outgoing
```

---

## Error Response Format

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {} // Optional additional information
  }
}
```

### Common Error Codes
| Code | Status | Description |
|------|--------|-------------|
| `BAD_REQUEST` | 400 | Invalid request format |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `VALIDATION_ERROR` | 422 | Request validation failed |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
