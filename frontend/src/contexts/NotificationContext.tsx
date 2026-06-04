import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
    getNotificationWebSocket,
    disconnectNotificationWebSocket,
    type IncomingCallData,
    type CallCancelledData,
    type ConnectionState,
} from '@/lib/websocket/NotificationWebSocket';
import { tokenManager } from '@/lib/api/client';

// Extended incoming call data with caller info
export interface IncomingCall {
    callId: string;
    roomId: string;
    type: 'audio' | 'video';
    initiatorId: string;
    isGroupCall: boolean;
    timestamp: number;
    callerName?: string;
    callerAvatar?: string;
}

interface NotificationContextType {
    // Connection state
    isConnected: boolean;
    connectionState: ConnectionState;

    // Incoming call state
    incomingCall: IncomingCall | null;

    // Fallback status
    usePollingFallback: boolean;

    // Actions
    clearIncomingCall: () => void;
    reconnect: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

interface NotificationProviderProps {
    children: ReactNode;
}

export function NotificationProvider({ children }: NotificationProviderProps) {
    const { isAuthenticated, user } = useAuth();
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const [usePollingFallback, setUsePollingFallback] = useState(false);

    // Track connection failures to decide on fallback
    const [connectionFailures, setConnectionFailures] = useState(0);
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

        // Subscribe to connection state changes
        const unsubStateChange = ws.onStateChange((state) => {
            setConnectionState(state);

            if (state === 'connected') {
                setConnectionFailures(0);
                setUsePollingFallback(false);
            } else if (state === 'disconnected') {
                setConnectionFailures((prev) => {
                    const newCount = prev + 1;
                    if (newCount >= maxFailuresBeforeFallback) {
                        console.log('NotificationContext: Enabling polling fallback');
                        setUsePollingFallback(true);
                    }
                    return newCount;
                });
            }
        });

        // Handle connected event
        const unsubConnected = ws.on('connected', () => {
            console.log('NotificationContext: WebSocket connected');
        });

        // Handle incoming call events
        const unsubIncoming = ws.on<IncomingCallData>('call:incoming', (data) => {
            console.log('NotificationContext: Incoming call', data);

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
            });
        });

        // Handle call cancelled events
        const unsubCancelled = ws.on<CallCancelledData>('call:cancelled', (data) => {
            console.log('NotificationContext: Call cancelled', data);

            setIncomingCall((current) => {
                if (current && current.callId === data.callId) {
                    return null;
                }
                return current;
            });
        });

        // Connect the WebSocket
        ws.connect();

        return () => {
            unsubStateChange();
            unsubConnected();
            unsubIncoming();
            unsubCancelled();
        };
    }, [isAuthenticated, user?.id]);

    // Handle visibility change (app returning from background)
    useEffect(() => {
        if (!isAuthenticated) return;

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                const ws = getNotificationWebSocket();
                if (!ws.isConnected) {
                    console.log('NotificationContext: App visible, reconnecting...');
                    ws.connect();
                    // Enable fallback briefly
                    setUsePollingFallback(true);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isAuthenticated]);

    // Watch for token changes
    useEffect(() => {
        if (!isAuthenticated) return;

        const checkToken = () => {
            const ws = getNotificationWebSocket();
            const currentToken = tokenManager.getAccessToken();
            if (currentToken && ws.state === 'disconnected') {
                ws.reconnectWithNewToken(currentToken);
            }
        };

        const tokenCheckInterval = setInterval(checkToken, 30000);

        return () => {
            clearInterval(tokenCheckInterval);
        };
    }, [isAuthenticated]);

    const clearIncomingCall = useCallback(() => {
        setIncomingCall(null);
    }, []);

    const reconnect = useCallback(() => {
        const ws = getNotificationWebSocket();
        ws.connect();
    }, []);

    const value: NotificationContextType = {
        isConnected: connectionState === 'connected',
        connectionState,
        incomingCall,
        usePollingFallback,
        clearIncomingCall,
        reconnect,
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
}

export function useNotificationContext() {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotificationContext must be used within a NotificationProvider');
    }
    return context;
}
