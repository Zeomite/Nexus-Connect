// Chat WebSocket Client

import { API_CONFIG } from '../api/config';
import { tokenManager } from '../api/client';

export type ChatWSEventType =
  | 'connected'
  | 'pong'
  | 'message:new'
  | 'message:delivered'
  | 'message:read'
  | 'message:deleted'
  | 'typing:start'
  | 'typing:stop'
  | 'chat:created'
  | 'error';

export interface ChatWSMessage {
  event: ChatWSEventType;
  data: unknown;
  timestamp?: number;
}

export interface NewMessageData {
  id: string;
  chatId: string;
  senderId: string;
  type: 'text' | 'image' | 'file' | 'audio' | 'video';
  content: string;
  status: 'sent' | 'delivered' | 'read';
  createdAt: string;
}

export interface TypingData {
  chatId: string;
  userId: string;
  displayName?: string;
}

export interface MessageReadData {
  chatId: string;
  messageIds: string[];
  readBy: string;
  readAt: string;
}

type EventHandler<T = unknown> = (data: T) => void;

export class ChatWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Map<ChatWSEventType, Set<EventHandler>> = new Map();
  private connectionId: string | null = null;

  constructor() {
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Initialize event handler sets for all event types
    const eventTypes: ChatWSEventType[] = [
      'connected',
      'pong',
      'message:new',
      'message:delivered',
      'message:read',
      'message:deleted',
      'typing:start',
      'typing:stop',
      'chat:created',
      'error',
    ];
    eventTypes.forEach((type) => {
      this.eventHandlers.set(type, new Set());
    });
  }

  connect(): void {
    const token = tokenManager.getAccessToken();
    if (!token) {
      console.error('ChatWebSocket: No access token available');
      return;
    }

    const wsUrl = `${API_CONFIG.wsBaseUrl}${API_CONFIG.websocket.chat}?token=${token}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketListeners();
    } catch (error) {
      console.error('ChatWebSocket: Failed to connect', error);
      this.handleReconnect();
    }
  }

  private setupWebSocketListeners(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('ChatWebSocket: Connected');
      this.reconnectAttempts = 0;
      this.startPingInterval();
    };

    this.ws.onmessage = (event) => {
      try {
        const message: ChatWSMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('ChatWebSocket: Failed to parse message', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('ChatWebSocket: Connection closed', event.code, event.reason);
      this.stopPingInterval();

      // Don't reconnect if closed normally
      if (event.code !== 1000) {
        this.handleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('ChatWebSocket: Error', error);
    };
  }

  private handleMessage(message: ChatWSMessage): void {
    const { event, data } = message;

    // Handle connected event
    if (event === 'connected') {
      this.connectionId = (data as { connectionId: string }).connectionId;
    }

    // Emit to registered handlers
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('ChatWebSocket: Max reconnect attempts reached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    console.log(`ChatWebSocket: Reconnecting in ${delay}ms...`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Send a message through the WebSocket
  send(message: { type: string; payload?: unknown }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('ChatWebSocket: Cannot send, connection not open');
    }
  }

  // Event subscription
  on<T = unknown>(event: ChatWSEventType, handler: EventHandler<T>): () => void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler as EventHandler);
    }

    // Return unsubscribe function
    return () => {
      handlers?.delete(handler as EventHandler);
    };
  }

  // Send typing indicator
  startTyping(chatId: string): void {
    this.send({
      type: 'typing:start',
      payload: { chatId },
    });
  }

  stopTyping(chatId: string): void {
    this.send({
      type: 'typing:stop',
      payload: { chatId },
    });
  }

  // Mark messages as read
  markAsRead(chatId: string, messageIds: string[]): void {
    this.send({
      type: 'message:read',
      payload: { chatId, messageIds },
    });
  }

  // Subscribe/unsubscribe from chat
  subscribeToChat(chatId: string): void {
    this.send({
      type: 'subscribe:chat',
      payload: { chatId },
    });
  }

  unsubscribeFromChat(chatId: string): void {
    this.send({
      type: 'unsubscribe:chat',
      payload: { chatId },
    });
  }

  // Disconnect
  disconnect(): void {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  // Get connection state
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentConnectionId(): string | null {
    return this.connectionId;
  }
}

// Singleton instance
let chatWsInstance: ChatWebSocket | null = null;

export function getChatWebSocket(): ChatWebSocket {
  if (!chatWsInstance) {
    chatWsInstance = new ChatWebSocket();
  }
  return chatWsInstance;
}

export function disconnectChatWebSocket(): void {
  if (chatWsInstance) {
    chatWsInstance.disconnect();
    chatWsInstance = null;
  }
}
