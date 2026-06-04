import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getChatWebSocket,
  disconnectChatWebSocket,
  type ChatWebSocket,
  type NewMessageData,
  type TypingData,
  type MessageReadData,
} from '@/lib/websocket/ChatWebSocket';
import { queryKeys } from '@/lib/api/hooks';
import { useAuth } from '@/contexts/AuthContext';

interface TypingUser {
  chatId: string;
  userId: string;
  displayName: string;
}

export function useChatWebSocket() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const wsRef = useRef<ChatWebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, TypingUser>>(new Map());

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectChatWebSocket();
      setIsConnected(false);
      return;
    }

    const ws = getChatWebSocket();
    wsRef.current = ws;
    ws.connect();

    // Handle connection
    const unsubConnected = ws.on('connected', () => {
      setIsConnected(true);
    });

    // Handle new messages
    const unsubNewMessage = ws.on<NewMessageData>('message:new', (data) => {
      // Invalidate chat messages query to trigger refresh
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(data.chatId) });
      // Also invalidate chats list to update last message
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    });

    // Handle message delivered
    const unsubDelivered = ws.on<{ messageId: string; chatId: string }>('message:delivered', (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(data.chatId) });
    });

    // Handle message read
    const unsubRead = ws.on<MessageReadData>('message:read', (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(data.chatId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    });

    // Handle typing indicators
    const unsubTypingStart = ws.on<TypingData>('typing:start', (data) => {
      setTypingUsers((prev) => {
        const newMap = new Map(prev);
        newMap.set(`${data.chatId}-${data.userId}`, {
          chatId: data.chatId,
          userId: data.userId,
          displayName: data.displayName || 'Someone',
        });
        return newMap;
      });

      // Auto-remove typing indicator after 5 seconds
      setTimeout(() => {
        setTypingUsers((prev) => {
          const newMap = new Map(prev);
          newMap.delete(`${data.chatId}-${data.userId}`);
          return newMap;
        });
      }, 5000);
    });

    const unsubTypingStop = ws.on<TypingData>('typing:stop', (data) => {
      setTypingUsers((prev) => {
        const newMap = new Map(prev);
        newMap.delete(`${data.chatId}-${data.userId}`);
        return newMap;
      });
    });

    // Handle chat created
    const unsubChatCreated = ws.on('chat:created', () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    });

    return () => {
      unsubConnected();
      unsubNewMessage();
      unsubDelivered();
      unsubRead();
      unsubTypingStart();
      unsubTypingStop();
      unsubChatCreated();
    };
  }, [isAuthenticated, queryClient]);

  const startTyping = useCallback((chatId: string) => {
    wsRef.current?.startTyping(chatId);
  }, []);

  const stopTyping = useCallback((chatId: string) => {
    wsRef.current?.stopTyping(chatId);
  }, []);

  const markAsRead = useCallback((chatId: string, messageIds: string[]) => {
    wsRef.current?.markAsRead(chatId, messageIds);
  }, []);

  const subscribeToChat = useCallback((chatId: string) => {
    wsRef.current?.subscribeToChat(chatId);
  }, []);

  const unsubscribeFromChat = useCallback((chatId: string) => {
    wsRef.current?.unsubscribeFromChat(chatId);
  }, []);

  const getTypingUsersForChat = useCallback(
    (chatId: string): TypingUser[] => {
      return Array.from(typingUsers.values()).filter((u) => u.chatId === chatId);
    },
    [typingUsers]
  );

  return {
    isConnected,
    startTyping,
    stopTyping,
    markAsRead,
    subscribeToChat,
    unsubscribeFromChat,
    getTypingUsersForChat,
  };
}
