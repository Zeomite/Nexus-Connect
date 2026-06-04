# WebSocket Event Definitions

## Chat WebSocket

### Connection

```javascript
// Connect to chat WebSocket
const ws = new WebSocket('wss://api.nexus.com/ws/chat?token=<access_token>');

// Connection confirmed
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.event === 'connected') {
    console.log('Connected:', message.data.connectionId);
  }
};
```

### Client → Server Events

#### Ping
```javascript
ws.send(JSON.stringify({
  type: 'ping'
}));
```

#### Start Typing
```javascript
ws.send(JSON.stringify({
  type: 'typing:start',
  payload: {
    chatId: 'chat-uuid'
  }
}));
```

#### Stop Typing
```javascript
ws.send(JSON.stringify({
  type: 'typing:stop',
  payload: {
    chatId: 'chat-uuid'
  }
}));
```

#### Mark Messages as Read
```javascript
ws.send(JSON.stringify({
  type: 'message:read',
  payload: {
    chatId: 'chat-uuid',
    messageIds: ['msg-uuid-1', 'msg-uuid-2']
  }
}));
```

#### Subscribe to Chat
```javascript
ws.send(JSON.stringify({
  type: 'subscribe:chat',
  payload: {
    chatId: 'chat-uuid'
  }
}));
```

#### Unsubscribe from Chat
```javascript
ws.send(JSON.stringify({
  type: 'unsubscribe:chat',
  payload: {
    chatId: 'chat-uuid'
  }
}));
```

### Server → Client Events

#### Connected
```javascript
{
  event: 'connected',
  data: {
    connectionId: 'ws_abc123',
    userId: 'user-uuid'
  }
}
```

#### Pong
```javascript
{
  event: 'pong',
  data: {
    timestamp: 1704067200000
  }
}
```

#### New Message
```javascript
{
  event: 'message:new',
  data: {
    id: 'msg-uuid',
    chatId: 'chat-uuid',
    senderId: 'user-uuid',
    type: 'text',
    content: 'Hello!',
    status: 'sent',
    createdAt: '2024-01-01T12:00:00Z'
  },
  timestamp: 1704067200000
}
```

#### Message Delivered
```javascript
{
  event: 'message:delivered',
  data: {
    messageId: 'msg-uuid',
    chatId: 'chat-uuid',
    deliveredTo: 'user-uuid',
    deliveredAt: '2024-01-01T12:00:01Z'
  }
}
```

#### Message Read
```javascript
{
  event: 'message:read',
  data: {
    chatId: 'chat-uuid',
    messageIds: ['msg-uuid-1', 'msg-uuid-2'],
    readBy: 'user-uuid',
    readAt: '2024-01-01T12:00:02Z'
  }
}
```

#### Message Deleted
```javascript
{
  event: 'message:deleted',
  data: {
    messageId: 'msg-uuid',
    chatId: 'chat-uuid'
  }
}
```

#### Typing Start
```javascript
{
  event: 'typing:start',
  data: {
    chatId: 'chat-uuid',
    userId: 'user-uuid',
    displayName: 'John Doe'
  }
}
```

#### Typing Stop
```javascript
{
  event: 'typing:stop',
  data: {
    chatId: 'chat-uuid',
    userId: 'user-uuid'
  }
}
```

#### Chat Created
```javascript
{
  event: 'chat:created',
  data: {
    chatId: 'chat-uuid',
    type: 'group'
  }
}
```

#### Error
```javascript
{
  event: 'error',
  data: {
    code: 'INVALID_MESSAGE',
    message: 'Failed to process message'
  }
}
```

---

## Call Signaling WebSocket

### Connection

```javascript
// Connect to signaling WebSocket
const ws = new WebSocket('wss://api.nexus.com/ws/signaling?token=<access_token>&callId=<call_id>');

// Joined call
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.event === 'call:joined') {
    console.log('Joined call:', message.data);
  }
};
```

### Client → Server Events

#### Send Offer (WebRTC SDP)
```javascript
ws.send(JSON.stringify({
  type: 'offer',
  payload: {
    toUserId: 'recipient-user-uuid',
    offer: {
      type: 'offer',
      sdp: 'v=0\r\no=- 123456789...'
    }
  }
}));
```

#### Send Answer (WebRTC SDP)
```javascript
ws.send(JSON.stringify({
  type: 'answer',
  payload: {
    toUserId: 'recipient-user-uuid',
    answer: {
      type: 'answer',
      sdp: 'v=0\r\no=- 987654321...'
    }
  }
}));
```

#### Send ICE Candidate
```javascript
ws.send(JSON.stringify({
  type: 'ice-candidate',
  payload: {
    toUserId: 'recipient-user-uuid',
    candidate: {
      candidate: 'candidate:1 1 UDP 2130706431...',
      sdpMid: '0',
      sdpMLineIndex: 0
    }
  }
}));
```

#### Toggle Mute
```javascript
ws.send(JSON.stringify({
  type: 'mute',
  payload: {
    isMuted: true
  }
}));
```

#### Toggle Video
```javascript
ws.send(JSON.stringify({
  type: 'video',
  payload: {
    isVideoEnabled: false
  }
}));
```

#### Toggle Screen Share
```javascript
ws.send(JSON.stringify({
  type: 'screen-share',
  payload: {
    isScreenSharing: true
  }
}));
```

#### Leave Call
```javascript
ws.send(JSON.stringify({
  type: 'leave'
}));
```

#### End Call (initiator only)
```javascript
ws.send(JSON.stringify({
  type: 'end-call'
}));
```

### Server → Client Events

#### Call Joined
```javascript
{
  event: 'call:joined',
  data: {
    callId: 'call-uuid',
    roomId: 'room_abc123',
    type: 'video',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ],
    participants: ['user-uuid-1', 'user-uuid-2']
  }
}
```

#### Participant Joined
```javascript
{
  event: 'call:participant_joined',
  data: {
    callId: 'call-uuid',
    userId: 'user-uuid'
  }
}
```

#### Participant Left
```javascript
{
  event: 'call:participant_left',
  data: {
    callId: 'call-uuid',
    userId: 'user-uuid',
    remainingCount: 2
  }
}
```

#### Receive Offer
```javascript
{
  event: 'call:offer',
  data: {
    callId: 'call-uuid',
    fromUserId: 'sender-user-uuid',
    offer: {
      type: 'offer',
      sdp: 'v=0\r\no=- 123456789...'
    }
  }
}
```

#### Receive Answer
```javascript
{
  event: 'call:answer',
  data: {
    callId: 'call-uuid',
    fromUserId: 'sender-user-uuid',
    answer: {
      type: 'answer',
      sdp: 'v=0\r\no=- 987654321...'
    }
  }
}
```

#### Receive ICE Candidate
```javascript
{
  event: 'call:ice_candidate',
  data: {
    callId: 'call-uuid',
    fromUserId: 'sender-user-uuid',
    candidate: {
      candidate: 'candidate:1 1 UDP 2130706431...',
      sdpMid: '0',
      sdpMLineIndex: 0
    }
  }
}
```

#### Media State Changed
```javascript
{
  event: 'call:media_state_changed',
  data: {
    callId: 'call-uuid',
    userId: 'user-uuid',
    isMuted: true,
    isVideoEnabled: true,
    isScreenSharing: false
  }
}
```

#### Call Declined
```javascript
{
  event: 'call:declined',
  data: {
    callId: 'call-uuid',
    userId: 'user-uuid'
  }
}
```

#### Call Ended
```javascript
{
  event: 'call:ended',
  data: {
    callId: 'call-uuid',
    endReason: 'normal' // normal, timeout, error, declined_all
  }
}
```

---

## WebRTC Signaling Sequence

```
Caller                           Signaling Server                     Callee
  |                                     |                                |
  |---- POST /calls/initiate ---------->|                                |
  |<--- callId, wsUrl ------------------|                                |
  |                                     |                                |
  |---- WebSocket connect ------------->|                                |
  |<--- call:joined --------------------|                                |
  |                                     |                                |
  |                                     |---- call:incoming ------------>|
  |                                     |                                |
  |                                     |<--- POST /calls/{id}/accept ---|
  |                                     |---- wsUrl -------------------->|
  |                                     |                                |
  |                                     |<--- WebSocket connect ---------|
  |<--- call:participant_joined --------|---- call:joined -------------->|
  |                                     |                                |
  |---- offer (SDP) ------------------->|---- call:offer --------------->|
  |                                     |                                |
  |<--- call:answer --------------------|<--- answer (SDP) --------------|
  |                                     |                                |
  |---- ice-candidate ----------------->|---- call:ice_candidate ------->|
  |<--- call:ice_candidate -------------|<--- ice-candidate -------------|
  |                                     |                                |
  |<============== Peer-to-Peer Media Connection ======================>|
  |                                     |                                |
  |---- leave ------------------------->|---- call:participant_left ---->|
  |                                     |                                |
```

---

## Error Handling

### Connection Errors
- `4001`: Unauthorized (invalid or missing token)
- `4002`: Missing required parameter (e.g., callId)
- `4003`: Failed to join (room full, invalid call)
- `4004`: Call/room not found

### Reconnection Strategy
```javascript
class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onclose = (event) => {
      if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connect();
        }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
      }
    };
  }
}
```
