// Notification WebSocket Client
// Handles real-time incoming call notifications

import { API_CONFIG } from '../api/config';
import { tokenManager } from '../api/client';

// Event types that can be received from the notification WebSocket
export type NotificationWSEventType =
    | 'connected'
    | 'pong'
    | 'call:incoming'
    | 'call:cancelled'
    | 'error';

// WebSocket message structure
export interface NotificationWSMessage {
    event: NotificationWSEventType;
    data: unknown;
    timestamp?: number;
}

// Connected event data
export interface ConnectedData {
    connectionId: string;
    timestamp: number;
}

// Incoming call event data
export interface IncomingCallData {
    callId: string;
    roomId: string;
    type: 'audio' | 'video';
    initiatorId: string;
    isGroupCall: boolean;
    timestamp: number;
}

// Call cancelled event data
export interface CallCancelledData {
    callId: string;
    reason: string;
    timestamp: number;
}

type EventHandler<T = unknown> = (data: T) => void;

// Connection state enum
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export class NotificationWebSocket {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private baseReconnectDelay = 1000;
    private maxReconnectDelay = 30000;
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    private pingIntervalMs = 25000; // 25 seconds as per requirement
    private eventHandlers: Map<NotificationWSEventType, Set<EventHandler>> = new Map();
    private connectionId: string | null = null;
    private connectionState: ConnectionState = 'disconnected';
    private currentToken: string | null = null;
    private stateChangeCallbacks: Set<(state: ConnectionState) => void> = new Set();

    constructor() {
        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        // Initialize event handler sets for all event types
        const eventTypes: NotificationWSEventType[] = [
            'connected',
            'pong',
            'call:incoming',
            'call:cancelled',
            'error',
        ];
        eventTypes.forEach((type) => {
            this.eventHandlers.set(type, new Set());
        });
    }

    private setConnectionState(state: ConnectionState): void {
        if (this.connectionState !== state) {
            this.connectionState = state;
            this.stateChangeCallbacks.forEach((callback) => callback(state));
        }
    }

    // Subscribe to connection state changes
    onStateChange(callback: (state: ConnectionState) => void): () => void {
        this.stateChangeCallbacks.add(callback);
        return () => {
            this.stateChangeCallbacks.delete(callback);
        };
    }

    connect(token?: string): void {
        // Use provided token or get from token manager
        const accessToken = token || tokenManager.getAccessToken();
        if (!accessToken) {
            console.error('NotificationWebSocket: No access token available');
            return;
        }

        // Store the current token for reconnection
        this.currentToken = accessToken;

        // Close existing connection if any
        if (this.ws) {
            this.ws.close(1000, 'Reconnecting with new token');
            this.ws = null;
        }

        this.setConnectionState('connecting');

        const wsUrl = `${API_CONFIG.wsBaseUrl}${API_CONFIG.websocket.notifications}?token=${accessToken}`;

        try {
            this.ws = new WebSocket(wsUrl);
            this.setupWebSocketListeners();
        } catch (error) {
            console.error('NotificationWebSocket: Failed to connect', error);
            this.handleReconnect();
        }
    }

    private setupWebSocketListeners(): void {
        if (!this.ws) return;

        this.ws.onopen = () => {
            console.log('NotificationWebSocket: Connected');
            this.reconnectAttempts = 0;
            this.setConnectionState('connected');
            this.startPingInterval();
        };

        this.ws.onmessage = (event) => {
            try {
                const message: NotificationWSMessage = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                console.error('NotificationWebSocket: Failed to parse message', error);
            }
        };

        this.ws.onclose = (event) => {
            console.log('NotificationWebSocket: Connection closed', event.code, event.reason);
            this.stopPingInterval();

            // Handle specific close codes
            if (event.code === 4001) {
                // Token invalid/expired - need to refresh token
                console.log('NotificationWebSocket: Token expired, waiting for token refresh');
                this.setConnectionState('disconnected');
                // Don't auto-reconnect - wait for new token
                return;
            }

            // Don't reconnect if closed normally (1000) or if we're already disconnected
            if (event.code !== 1000 && this.connectionState !== 'disconnected') {
                this.handleReconnect();
            } else {
                this.setConnectionState('disconnected');
            }
        };

        this.ws.onerror = (error) => {
            console.error('NotificationWebSocket: Error', error);
        };
    }

    private handleMessage(message: NotificationWSMessage): void {
        const { event, data } = message;

        // Handle connected event
        if (event === 'connected') {
            this.connectionId = (data as ConnectedData).connectionId;
        }

        // Emit to registered handlers
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach((handler) => handler(data));
        }
    }

    private handleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('NotificationWebSocket: Max reconnect attempts reached');
            this.setConnectionState('disconnected');
            return;
        }

        this.setConnectionState('reconnecting');

        // Calculate delay with exponential backoff, capped at max delay
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
            this.maxReconnectDelay
        );

        console.log(`NotificationWebSocket: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            this.reconnectAttempts++;
            // Try to get a fresh token for reconnection
            const token = tokenManager.getAccessToken() || this.currentToken;
            if (token) {
                this.connect(token);
            } else {
                console.error('NotificationWebSocket: No token available for reconnection');
                this.setConnectionState('disconnected');
            }
        }, delay);
    }

    private startPingInterval(): void {
        this.stopPingInterval(); // Clear any existing interval
        this.pingInterval = setInterval(() => {
            this.sendPing();
        }, this.pingIntervalMs);
    }

    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    // Send ping message for keep-alive
    private sendPing(): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
        }
    }

    // Event subscription
    on<T = unknown>(event: NotificationWSEventType, handler: EventHandler<T>): () => void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.add(handler as EventHandler);
        }

        // Return unsubscribe function
        return () => {
            handlers?.delete(handler as EventHandler);
        };
    }

    // Reconnect with a new token (e.g., after token refresh)
    reconnectWithNewToken(newToken: string): void {
        console.log('NotificationWebSocket: Reconnecting with new token');
        this.reconnectAttempts = 0; // Reset attempts for fresh token
        this.connect(newToken);
    }

    // Disconnect
    disconnect(): void {
        this.stopPingInterval();
        this.setConnectionState('disconnected');
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }
        this.currentToken = null;
    }

    // Get connection state
    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    get currentConnectionId(): string | null {
        return this.connectionId;
    }

    get state(): ConnectionState {
        return this.connectionState;
    }
}

// Singleton instance
let notificationWsInstance: NotificationWebSocket | null = null;

export function getNotificationWebSocket(): NotificationWebSocket {
    if (!notificationWsInstance) {
        notificationWsInstance = new NotificationWebSocket();
    }
    return notificationWsInstance;
}

export function disconnectNotificationWebSocket(): void {
    if (notificationWsInstance) {
        notificationWsInstance.disconnect();
        notificationWsInstance = null;
    }
}
