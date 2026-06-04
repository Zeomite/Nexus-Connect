import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeclineCall, useActiveCalls } from '@/lib/api/hooks';
import { useAuth } from '@/contexts/AuthContext';
import {
  getNotificationWebSocket,
  disconnectNotificationWebSocket,
  type IncomingCallData,
  type CallCancelledData,
  type ConnectionState,
} from '@/lib/websocket/NotificationWebSocket';
import { tokenManager } from '@/lib/api/client';

// Incoming call data type
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

interface UseIncomingCallReturn {
  incomingCall: IncomingCall | null;
  acceptCall: () => void;
  declineCall: () => Promise<void>;
  dismissCall: () => void;
  // Status info
  wsConnected: boolean;
  connectionState: ConnectionState;
  usePollingFallback: boolean;
}

export function useIncomingCall(): UseIncomingCallReturn {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const declineCallMutation = useDeclineCall();

  // Local state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [usePollingFallback, setUsePollingFallback] = useState(false);

  // Track connection failures for fallback
  const connectionFailuresRef = useRef(0);
  const maxFailuresBeforeFallback = 3;

  // Polling interval ref
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        connectionFailuresRef.current = 0;
        setUsePollingFallback(false);
      } else if (state === 'disconnected') {
        connectionFailuresRef.current++;
        if (connectionFailuresRef.current >= maxFailuresBeforeFallback) {
          console.log('useIncomingCall: Enabling polling fallback');
          setUsePollingFallback(true);
        }
      }
    });

    // Handle connected event
    const unsubConnected = ws.on('connected', () => {
      console.log('useIncomingCall: WebSocket connected');
    });

    // Handle incoming call events
    const unsubIncoming = ws.on<IncomingCallData>('call:incoming', (data) => {
      console.log('useIncomingCall: Incoming call', data);

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
      console.log('useIncomingCall: Call cancelled', data);

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

  // Effect to handle token refresh
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

  // Handle visibility change (app returning from background)
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const ws = getNotificationWebSocket();
        if (!ws.isConnected) {
          console.log('useIncomingCall: App visible, reconnecting...');
          ws.connect();
          setUsePollingFallback(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated]);

  // Polling fallback using active calls API
  const { refetch: refetchActiveCalls } = useActiveCalls();

  // Setup polling fallback when WebSocket is not connected
  useEffect(() => {
    if (!isAuthenticated) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const wsConnected = connectionState === 'connected';

    if (usePollingFallback && !wsConnected) {
      console.log('useIncomingCall: Using polling fallback');

      pollingIntervalRef.current = setInterval(() => {
        refetchActiveCalls();
      }, 5000);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    } else {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [isAuthenticated, usePollingFallback, connectionState, refetchActiveCalls]);

  // Accept call handler
  const acceptCall = useCallback(() => {
    if (!incomingCall) return;

    navigate(`/call/${incomingCall.callId}`, {
      state: {
        callId: incomingCall.callId,
        roomId: incomingCall.roomId,
        isIncoming: true,
        isVideo: incomingCall.type === 'video',
        chatName: incomingCall.callerName || 'Unknown Caller',
        participantIds: [incomingCall.initiatorId],
        isGroupCall: incomingCall.isGroupCall,
      },
    });

    setIncomingCall(null);
  }, [incomingCall, navigate]);

  // Decline call handler
  const declineCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      await declineCallMutation.mutateAsync(incomingCall.callId);
    } catch (error) {
      console.error('Failed to decline call:', error);
    }

    setIncomingCall(null);
  }, [incomingCall, declineCallMutation]);

  // Dismiss call (cancelled, timeout, etc.)
  const dismissCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  return {
    incomingCall,
    acceptCall,
    declineCall,
    dismissCall,
    wsConnected: connectionState === 'connected',
    connectionState,
    usePollingFallback,
  };
}
