// React Query hooks for API calls

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client';
import { API_CONFIG } from './config';
import type {
  User,
  SearchUserResult,
  SearchUsersResponse,
  Chat,
  ChatsResponse,
  ChatMessage,
  ChatMessagesResponse,
  CreateDirectChatRequest,
  CreateDirectChatResponse,
  CreateGroupChatRequest,
  CreateGroupChatResponse,
  SendMessageRequest,
  SendMessageResponse,
  MarkMessagesReadRequest,
  CallHistoryResponse,
  CallHistoryRecord,
  Group,
  GroupsResponse,
  InitiateCallRequest,
  InitiateCallResponse,
  AcceptCallResponse,
  ActiveCallsResponse,
} from './types';

// Query Keys
export const queryKeys = {
  user: ['user'] as const,
  chats: ['chats'] as const,
  chat: (chatId: string) => ['chat', chatId] as const,
  messages: (chatId: string) => ['messages', chatId] as const,
  contacts: ['contacts'] as const,
  searchUsers: (query: string) => ['searchUsers', query] as const,
  searchByNumber: (number: string) => ['searchByNumber', number] as const,
  callHistory: ['callHistory'] as const,
  groups: ['groups'] as const,
  activeCalls: ['activeCalls'] as const,
};

// ============ User Hooks ============

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.user,
    queryFn: () => api.get<User>(API_CONFIG.endpoints.me),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: queryKeys.searchUsers(query),
    queryFn: () =>
      api.get<SearchUsersResponse>(API_CONFIG.endpoints.searchUsers, {
        params: { query, page: 1, limit: 20 },
      }),
    enabled: query.length >= 2,
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useSearchByNumber(number: string) {
  return useQuery({
    queryKey: queryKeys.searchByNumber(number),
    queryFn: () =>
      api.get<SearchUserResult>(API_CONFIG.endpoints.searchByNumber(number)),
    enabled: number.length === 10,
    staleTime: 60 * 1000, // 1 minute
  });
}

// ============ Chat Hooks ============

export function useChats(page = 1, limit = 20) {
  return useQuery({
    queryKey: [...queryKeys.chats, page, limit],
    queryFn: () =>
      api.get<ChatsResponse>(API_CONFIG.endpoints.chats, {
        params: { page, limit },
      }),
    staleTime: 30 * 1000,
  });
}

export function useChatMessages(chatId: string | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.messages(chatId || ''),
    queryFn: ({ pageParam }) =>
      api.get<ChatMessagesResponse>(API_CONFIG.endpoints.chatMessages(chatId!), {
        params: { page: pageParam, limit: 50 },
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length + 1 : undefined,
    enabled: !!chatId,
    staleTime: 0, // Always fresh for messages
  });
}

export function useCreateDirectChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDirectChatRequest) =>
      api.post<CreateDirectChatResponse>(API_CONFIG.endpoints.directChat, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

export function useCreateGroupChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateGroupChatRequest) =>
      api.post<CreateGroupChatResponse>(API_CONFIG.endpoints.groupChat, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SendMessageRequest) =>
      api.post<SendMessageResponse>(API_CONFIG.endpoints.messages, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(variables.chatId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

export function useMarkMessagesRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: MarkMessagesReadRequest) =>
      api.post<{ message: string }>(API_CONFIG.endpoints.markRead, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages(variables.chatId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

// ============ Call Hooks ============

export function useInitiateCall() {
  return useMutation({
    mutationFn: (data: InitiateCallRequest) =>
      api.post<InitiateCallResponse>(API_CONFIG.endpoints.initiateCall, data),
  });
}

export function useAcceptCall() {
  return useMutation({
    mutationFn: (callId: string) =>
      api.post<AcceptCallResponse>(API_CONFIG.endpoints.acceptCall(callId)),
  });
}

export function useDeclineCall() {
  return useMutation({
    mutationFn: (callId: string) =>
      api.post<{ message: string }>(API_CONFIG.endpoints.declineCall(callId)),
  });
}

export function useEndCall() {
  return useMutation({
    mutationFn: (callId: string) =>
      api.post<{ message: string }>(API_CONFIG.endpoints.endCall(callId)),
  });
}

export function useActiveCalls() {
  return useQuery({
    queryKey: queryKeys.activeCalls,
    queryFn: () => api.get<ActiveCallsResponse>(API_CONFIG.endpoints.activeCalls),
    refetchInterval: 5000, // Poll every 5 seconds
  });
}

// ============ Call History Hooks ============

export function useCallHistory(page = 1, limit = 20) {
  return useQuery({
    queryKey: [...queryKeys.callHistory, page, limit],
    queryFn: () =>
      api.get<CallHistoryResponse>(API_CONFIG.endpoints.callHistory, {
        params: { page, limit },
      }),
    staleTime: 60 * 1000,
  });
}

// ============ Group Hooks ============

export function useGroups() {
  return useQuery({
    queryKey: queryKeys.groups,
    queryFn: () => api.get<GroupsResponse>(API_CONFIG.endpoints.groups),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; description?: string; memberIds: string[] }) =>
      api.post<{ id: string; name: string }>(API_CONFIG.endpoints.groups, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });
}

export function useAddGroupMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.post<{ message: string }>(API_CONFIG.endpoints.groupMembers(groupId), { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups });
    },
  });
}

// ============ Optimistic Updates Helper ============

export function useOptimisticMessage() {
  const queryClient = useQueryClient();

  const addOptimisticMessage = (chatId: string, message: Partial<ChatMessage>) => {
    queryClient.setQueryData(
      queryKeys.messages(chatId),
      (oldData: { pages: { messages: ChatMessage[] }[] } | undefined) => {
        if (!oldData) return oldData;

        const newMessage: ChatMessage = {
          id: `temp-${Date.now()}`,
          content: message.content || '',
          senderId: message.senderId || '',
          type: message.type || 'text',
          status: 'sent',
          createdAt: new Date().toISOString(),
          ...message,
        };

        return {
          ...oldData,
          pages: oldData.pages.map((page, index) =>
            index === 0
              ? { ...page, messages: [...page.messages, newMessage] }
              : page
          ),
        };
      }
    );
  };

  return { addOptimisticMessage };
}
