import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    getNotificationWebSocket,
    disconnectNotificationWebSocket,
    type NotificationWebSocket,
    type IncomingCallData,
    type CallCancelledData,
    type ConnectionState,
} from '@/lib/websocket/NotificationWebSocket';
import { useAuth } from '@/contexts/AuthContext';
import { tokenManager } from '@/lib/api/client';

// Extended incoming call data with caller info
export interface IncomingCall {
    callId: string;
    roomId: string;
    type: 'audio' | 'video';
    initiatorId: string;
    isGroupCall: boolean;
    timestamp: number;
    // Caller info (to be fetched or expanded)
    callerName?: string;
    callerAvatar?: string;
}

interface UseNotificationWebSocketReturn {
    isConnected: boolean;
    connectionState: ConnectionState;
    incomingCall: IncomingCall | null;
    acceptCall: () => void;
    declineCall: () => void;
    dismissCall: () => void;
    usePollingFallback: boolean;
}

export function useNotificationWebSocket(): UseNotificationWebSocketReturn {
    const { isAuthenticated, user } = useAuth();
    const queryClient = useQueryClient();
    const wsRef = useRef<NotificationWebSocket | null>(null);
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const [usePollingFallback, setUsePollingFallback] = useState(false);

    // Track connection failures to decide on fallback
    const connectionFailuresRef = useRef(0);
    const maxFailuresBeforeFallback = 3;

    // Main effect to manage WebSocket connection
    useEffect(() => {
        if (!isAuthenticated) {
            disconnectNotificationWebSocket();
            setConnectionState('disconnected');
            setIncomingCall(null);
            return;
        }

        const ws = getNotificationWebSocket();
        wsRef.current = ws;

        // Subscribe to connection state changes
        const unsubStateChange = ws.onStateChange((state) => {
            setConnectionState(state);

            if (state === 'connected') {
                // Reset failure count and disable fallback when connected
                connectionFailuresRef.current = 0;
                setUsePollingFallback(false);
            } else if (state === 'disconnected') {
                // Increment failure count
                connectionFailuresRef.current++;
                if (connectionFailuresRef.current >= maxFailuresBeforeFallback) {
                    console.log('NotificationWebSocket: Enabling polling fallback due to connection failures');
                    setUsePollingFallback(true);
                }
            }
        });

        // Handle connected event
        const unsubConnected = ws.on('connected', () => {
            console.log('Notification WebSocket connected');
        });

        // Handle incoming call events
        const unsubIncoming = ws.on<IncomingCallData>('call:incoming', (data) => {
            console.log('Incoming call received:', data);

            // Don't show if we're the initiator
            if (data.initiatorId === user?.id) {
                return;
            }

            setIncomingCall({
                callId: data.callId,
                roomId: data.roomId,
                type: data.type,
                initiatorId: data.initiatorId,
                isGroupCall: data.isGroupCall,
                timestamp: data.timestamp,
                // Caller info will be fetched or provided by component
            });
        });

        // Handle call cancelled events
        const unsubCancelled = ws.on<CallCancelledData>('call:cancelled', (data) => {
            console.log('Call cancelled:', data);

            // Dismiss if this is the call we're showing
            setIncomingCall((current) => {
                if (current && current.callId === data.callId) {
                    return null;
                }
                return current;
            });
        });

        // Handle pong (for debugging/monitoring)
        const unsubPong = ws.on('pong', () => {
            // Pong received, connection is healthy
        });

        // Connect the WebSocket
        ws.connect();

        return () => {
            unsubStateChange();
            unsubConnected();
            unsubIncoming();
            unsubCancelled();
            unsubPong();
        };
    }, [isAuthenticated, user?.id]);

    // Effect to handle token refresh
    useEffect(() => {
        if (!isAuthenticated || !wsRef.current) return;

        // Watch for token changes and reconnect if needed
        const checkToken = () => {
            const currentToken = tokenManager.getAccessToken();
            if (currentToken && wsRef.current?.state === 'disconnected') {
                wsRef.current.reconnectWithNewToken(currentToken);
            }
        };

        // Check periodically for token refresh
        const tokenCheckInterval = setInterval(checkToken, 30000);

        return () => {
            clearInterval(tokenCheckInterval);
        };
    }, [isAuthenticated]);

    // Handle visibility change (app returning from background)
    useEffect(() => {
        if (!isAuthenticated) return;

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // App became visible - check WebSocket connection
                const ws = wsRef.current;
                if (ws && !ws.isConnected) {
                    console.log('App became visible, reconnecting WebSocket...');
                    ws.connect();
                }

                // Enable fallback briefly to catch any missed calls
                // This will be disabled once WebSocket reconnects
                if (!ws?.isConnected) {
                    setUsePollingFallback(true);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isAuthenticated]);

    // Accept call handler
    const acceptCall = useCallback(() => {
        if (!incomingCall) return;

        // The navigation will be handled by the component using this hook
        // Just clear the incoming call state here
        const callData = { ...incomingCall };
        setIncomingCall(null);

        // Return call data is handled via the incomingCall state
        return callData;
    }, [incomingCall]);

    // Decline call handler
    const declineCall = useCallback(() => {
        if (!incomingCall) return;

        // Clear the incoming call
        setIncomingCall(null);
    }, [incomingCall]);

    // Dismiss call (e.g., timeout or cancelled)
    const dismissCall = useCallback(() => {
        setIncomingCall(null);
    }, []);

    return {
        isConnected: connectionState === 'connected',
        connectionState,
        incomingCall,
        acceptCall,
        declineCall,
        dismissCall,
        usePollingFallback,
    };
}
