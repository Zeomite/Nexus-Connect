import { WebSocket } from 'ws';
import { createLogger, generateConnectionId } from '@nexus/shared';

const logger = createLogger({ serviceName: 'call-signaling:notifications' });

export interface UserConnection {
  socket: WebSocket;
  userId: string;
  connectionId: string;
  connectedAt: number;
  lastPing: number;
}

export interface IncomingCallNotification {
  callId: string;
  roomId: string;
  type: 'audio' | 'video';
  initiatorId: string;
  isGroupCall: boolean;
  timestamp: number;
}

export class NotificationManager {
  // Map of userId -> Set of connections (user can have multiple devices)
  private userConnections: Map<string, Map<string, UserConnection>> = new Map();
  
  // Heartbeat interval for connection health checks
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_TIMEOUT = 60000; // 60 seconds

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Register a new user connection for receiving notifications
   */
  addConnection(socket: WebSocket, userId: string): UserConnection {
    const connectionId = generateConnectionId();
    const now = Date.now();

    const connection: UserConnection = {
      socket,
      userId,
      connectionId,
      connectedAt: now,
      lastPing: now,
    };

    // Get or create user's connection map
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Map());
    }
    
    this.userConnections.get(userId)!.set(connectionId, connection);

    logger.info({ userId, connectionId }, 'User connected for notifications');

    return connection;
  }

  /**
   * Remove a user connection
   */
  removeConnection(connectionId: string): void {
    for (const [userId, connections] of this.userConnections) {
      if (connections.has(connectionId)) {
        connections.delete(connectionId);
        logger.info({ userId, connectionId }, 'User disconnected from notifications');

        // Clean up empty user entries
        if (connections.size === 0) {
          this.userConnections.delete(userId);
        }
        break;
      }
    }
  }

  /**
   * Check if a user is online (has at least one active connection)
   */
  isUserOnline(userId: string): boolean {
    const connections = this.userConnections.get(userId);
    return connections !== undefined && connections.size > 0;
  }

  /**
   * Get all connection IDs for a user
   */
  getUserConnections(userId: string): UserConnection[] {
    const connections = this.userConnections.get(userId);
    return connections ? Array.from(connections.values()) : [];
  }

  /**
   * Send a notification to a specific user (all their devices)
   */
  sendToUser(userId: string, event: string, data: unknown): boolean {
    const connections = this.userConnections.get(userId);
    if (!connections || connections.size === 0) {
      logger.debug({ userId, event }, 'User not online, cannot send notification');
      return false;
    }

    const message = JSON.stringify({ event, data, timestamp: Date.now() });
    let sent = false;

    for (const connection of connections.values()) {
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(message);
        sent = true;
      }
    }

    if (sent) {
      logger.debug({ userId, event }, 'Notification sent to user');
    }

    return sent;
  }

  /**
   * Send incoming call notification to a user
   */
  notifyIncomingCall(recipientId: string, notification: IncomingCallNotification): boolean {
    return this.sendToUser(recipientId, 'call:incoming', notification);
  }

  /**
   * Notify user that a call was cancelled/ended before they answered
   */
  notifyCallCancelled(recipientId: string, callId: string, reason: string): boolean {
    return this.sendToUser(recipientId, 'call:cancelled', { callId, reason, timestamp: Date.now() });
  }

  /**
   * Update lastPing for a connection (called when we receive a pong)
   */
  updatePing(connectionId: string): void {
    for (const connections of this.userConnections.values()) {
      const connection = connections.get(connectionId);
      if (connection) {
        connection.lastPing = Date.now();
        break;
      }
    }
  }

  /**
   * Start heartbeat to detect stale connections
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const staleConnections: string[] = [];

      for (const [userId, connections] of this.userConnections) {
        for (const [connectionId, connection] of connections) {
          // Check if connection is stale
          if (now - connection.lastPing > this.CONNECTION_TIMEOUT) {
            staleConnections.push(connectionId);
            logger.warn({ userId, connectionId }, 'Removing stale notification connection');
            connection.socket.close(4000, 'Connection timeout');
          } else if (connection.socket.readyState === WebSocket.OPEN) {
            // Send ping
            connection.socket.ping();
          }
        }
      }

      // Remove stale connections
      for (const connectionId of staleConnections) {
        this.removeConnection(connectionId);
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Get statistics about current connections
   */
  getStats(): { onlineUsers: number; totalConnections: number } {
    let totalConnections = 0;
    for (const connections of this.userConnections.values()) {
      totalConnections += connections.size;
    }

    return {
      onlineUsers: this.userConnections.size,
      totalConnections,
    };
  }

  /**
   * Close all connections and cleanup
   */
  closeAll(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const connections of this.userConnections.values()) {
      for (const connection of connections.values()) {
        connection.socket.close(1000, 'Server shutting down');
      }
    }

    this.userConnections.clear();
    logger.info('All notification connections closed');
  }
}
