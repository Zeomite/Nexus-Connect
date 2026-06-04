import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import {
    createLogger,
    authenticateWebSocket,
    TokenPayload,
} from '@nexus/shared';
import { config } from '../config';

const logger = createLogger({ serviceName: 'call-signaling:notifications-ws' });

interface WsQuerystring {
    token?: string;
}

interface NotificationMessage {
    type: string;
    payload?: unknown;
}

/**
 * WebSocket endpoint for receiving real-time notifications (especially incoming calls)
 * 
 * Clients should connect to this endpoint when the app is active to receive:
 * - Incoming call notifications
 * - Call cancelled notifications
 * - Other real-time events
 * 
 * Usage: ws://host:port/ws/notifications?token=<jwt_token>
 */
export const notificationsHandler: FastifyPluginAsync = async (server) => {
    server.get<{ Querystring: WsQuerystring }>('/notifications', { websocket: true }, (connection: SocketStream, request: FastifyRequest<{ Querystring: WsQuerystring }>) => {
        const socket = connection.socket;
        const token = request.query.token;

        // Authenticate
        let user: TokenPayload;
        try {
            user = authenticateWebSocket(token!, config.jwt.accessTokenSecret);
        } catch {
            socket.close(4001, 'Unauthorized');
            return;
        }

        // Register connection with notification manager
        const userConnection = server.notificationManager.addConnection(socket, user.userId);

        logger.info({ userId: user.userId, connectionId: userConnection.connectionId }, 'User connected for notifications');

        // Send acknowledgment
        socket.send(JSON.stringify({
            event: 'connected',
            data: {
                connectionId: userConnection.connectionId,
                timestamp: Date.now(),
            },
        }));

        // Handle incoming messages (mostly for ping/pong and acknowledgments)
        socket.on('message', async (data) => {
            try {
                const message: NotificationMessage = JSON.parse(data.toString());
                await handleNotificationMessage(server, user, userConnection.connectionId, message);
            } catch (error) {
                logger.error({ error, userId: user.userId }, 'Failed to process notification message');
            }
        });

        // Handle pong (response to our ping)
        socket.on('pong', () => {
            server.notificationManager.updatePing(userConnection.connectionId);
        });

        // Handle close
        socket.on('close', (code, reason) => {
            logger.info({ userId: user.userId, connectionId: userConnection.connectionId, code, reason: reason.toString() }, 'User disconnected from notifications');
            server.notificationManager.removeConnection(userConnection.connectionId);
        });

        // Handle errors
        socket.on('error', (error) => {
            logger.error({ error, userId: user.userId, connectionId: userConnection.connectionId }, 'Notification WebSocket error');
        });
    });
};

async function handleNotificationMessage(
    server: any,
    user: TokenPayload,
    connectionId: string,
    message: NotificationMessage
): Promise<void> {
    switch (message.type) {
        case 'ping':
            // Client-initiated ping, respond with pong
            server.notificationManager.updatePing(connectionId);
            const connections = server.notificationManager.getUserConnections(user.userId);
            const connection = connections.find((c: any) => c.connectionId === connectionId);
            if (connection && connection.socket.readyState === 1) {
                connection.socket.send(JSON.stringify({ event: 'pong', timestamp: Date.now() }));
            }
            break;

        case 'ack':
            // Client acknowledged receipt of a notification
            logger.debug({ userId: user.userId, payload: message.payload }, 'Notification acknowledged');
            break;

        default:
            logger.debug({ type: message.type, userId: user.userId }, 'Unknown notification message type');
    }
}
