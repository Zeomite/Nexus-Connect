import { WebSocket } from 'ws';
import {
  RedisClient,
  SessionKeys,
  createLogger,
  generateConnectionId,
} from '@nexus/shared';
import { config } from '../config';

const logger = createLogger({ serviceName: 'chat-service:ws-manager' });

export interface WsConnection {
  socket: WebSocket;
  userId: string;
  connectionId: string;
  lastPing: number;
}

export class WebSocketManager {
  private connections: Map<string, WsConnection> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private readonly redis: RedisClient) {
    this.startHeartbeat();
  }

  // Add a new connection
  addConnection(socket: WebSocket, userId: string): string {
    const connectionId = generateConnectionId();

    const connection: WsConnection = {
      socket,
      userId,
      connectionId,
      lastPing: Date.now(),
    };

    this.connections.set(connectionId, connection);

    // Track user's connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    // Store in Redis for cross-instance communication
    this.redis.sadd(SessionKeys.userConnections(userId), connectionId);

    logger.info({ userId, connectionId }, 'WebSocket connection added');

    return connectionId;
  }

  // Remove a connection
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { userId } = connection;

    // Remove from local maps
    this.connections.delete(connectionId);

    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    // Remove from Redis
    this.redis.srem(SessionKeys.userConnections(userId), connectionId);

    logger.info({ userId, connectionId }, 'WebSocket connection removed');
  }

  // Get connection by ID
  getConnection(connectionId: string): WsConnection | undefined {
    return this.connections.get(connectionId);
  }

  // Get all connections for a user
  getUserConnections(userId: string): WsConnection[] {
    const connectionIds = this.userConnections.get(userId);
    if (!connectionIds) return [];

    return Array.from(connectionIds)
      .map((id) => this.connections.get(id))
      .filter((conn): conn is WsConnection => conn !== undefined);
  }

  // Send message to a specific user
  sendToUser(userId: string, event: string, data: unknown): void {
    const connections = this.getUserConnections(userId);

    const message = JSON.stringify({ event, data, timestamp: Date.now() });

    for (const connection of connections) {
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(message);
      }
    }

    // Also publish to Redis for other instances
    this.redis.publish(`user:${userId}`, message);
  }

  // Send message to multiple users
  sendToUsers(userIds: string[], event: string, data: unknown): void {
    for (const userId of userIds) {
      this.sendToUser(userId, event, data);
    }
  }

  // Send message to all participants in a chat
  async sendToChat(chatId: string, event: string, data: unknown, excludeUserId?: string): Promise<void> {
    // This would need to query chat participants from the database
    // For now, we use Redis to broadcast to a chat channel
    const message = JSON.stringify({ event, data, timestamp: Date.now(), excludeUserId });
    await this.redis.publish(`chat:${chatId}`, message);
  }

  // Broadcast to all connections
  broadcast(event: string, data: unknown): void {
    const message = JSON.stringify({ event, data, timestamp: Date.now() });

    for (const connection of this.connections.values()) {
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(message);
      }
    }
  }

  // Update last ping time
  updatePing(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastPing = Date.now();
    }
  }

  // Start heartbeat checker
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = config.ws.connectionTimeout;

      for (const [connectionId, connection] of this.connections) {
        if (now - connection.lastPing > timeout) {
          logger.warn({ connectionId, userId: connection.userId }, 'Connection timed out');
          connection.socket.terminate();
          this.removeConnection(connectionId);
        } else if (connection.socket.readyState === WebSocket.OPEN) {
          // Send ping
          connection.socket.ping();
        }
      }
    }, config.ws.heartbeatInterval);
  }

  // Close all connections
  closeAll(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    for (const connection of this.connections.values()) {
      connection.socket.close(1000, 'Server shutting down');
    }

    this.connections.clear();
    this.userConnections.clear();
  }

  // Get stats
  getStats(): { totalConnections: number; uniqueUsers: number } {
    return {
      totalConnections: this.connections.size,
      uniqueUsers: this.userConnections.size,
    };
  }
}
