import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Send, Smile, Paperclip, Phone, Video, MoreVertical, ArrowLeft, Loader2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ChatMessage } from "@/components/ChatMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useChatWebSocket } from "@/hooks/useChatWebSocket";
import { useChats, useChatMessages, useSendMessage } from "@/lib/api/hooks";
import type { Chat, ChatMessage as ChatMessageType } from "@/lib/api/types";

type Status = "online" | "busy" | "away" | "offline";

export default function Chats() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  
  // WebSocket hooks
  const { 
    startTyping, 
    stopTyping, 
    markAsRead, 
    subscribeToChat, 
    unsubscribeFromChat,
    getTypingUsersForChat 
  } = useChatWebSocket();
  
  // API hooks
  const { data: chatsData, isLoading: isLoadingChats } = useChats();
  const { 
    data: messagesData, 
    isLoading: isLoadingMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage 
  } = useChatMessages(selectedChat?.id || null);
  const sendMessageMutation = useSendMessage();

  // Flatten messages from infinite query
  const messages = messagesData?.pages.flatMap(page => page.messages) || [];
  const typingUsers = selectedChat ? getTypingUsersForChat(selectedChat.id) : [];

  // Subscribe to chat when selected
  useEffect(() => {
    if (selectedChat) {
      subscribeToChat(selectedChat.id);
      
      // Mark messages as read
      const unreadMessageIds = messages
        .filter(m => m.senderId !== user?.id && m.status !== 'read')
        .map(m => m.id);
      
      if (unreadMessageIds.length > 0) {
        markAsRead(selectedChat.id, unreadMessageIds);
      }
      
      return () => {
        unsubscribeFromChat(selectedChat.id);
      };
    }
  }, [selectedChat?.id]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Handle typing indicator
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const handleInputChange = useCallback((value: string) => {
    setNewMessage(value);
    
    if (selectedChat) {
      startTyping(selectedChat.id);
      
      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Stop typing after 2 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping(selectedChat.id);
      }, 2000);
    }
  }, [selectedChat, startTyping, stopTyping]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChat) return;
    
    // Stop typing indicator
    stopTyping(selectedChat.id);
    
    const messageContent = newMessage.trim();
    setNewMessage("");
    
    try {
      await sendMessageMutation.mutateAsync({
        chatId: selectedChat.id,
        type: 'text',
        content: messageContent,
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore the message on error
      setNewMessage(messageContent);
    }
  };

  const handleCall = (isVideo: boolean) => {
    if (selectedChat) {
      navigate("/call", { 
        state: { 
          participantIds: selectedChat.participants.map(p => p.id),
          isVideo,
          chatName: selectedChat.name,
        } 
      });
    }
  };

  // Filter chats based on search
  const filteredChats = chatsData?.chats.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const showChatList = !isMobile || !selectedChat;
  const showChat = !isMobile || selectedChat;

  // Map chat participant status
  const getParticipantStatus = (chat: Chat): Status => {
    if (chat.type === 'group') return 'online';
    // For direct chats, we'd need real-time status updates
    return 'online';
  };

  return (
    <div className="flex h-full">
      {/* Chat List */}
      <AnimatePresence mode="wait">
        {showChatList && (
          <motion.div
            key="chat-list"
            initial={isMobile ? { x: -300, opacity: 0 } : false}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className={cn(
              "flex flex-col border-r border-border bg-card",
              isMobile ? "w-full" : "w-80 lg:w-96"
            )}
          >
            {/* Header */}
            <div className="border-b border-border p-4">
              <h1 className="text-xl font-semibold text-foreground">Messages</h1>
              <div className="relative mt-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Contact List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {isLoadingChats ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <Search className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-foreground">No conversations yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Start a conversation from your contacts
                  </p>
                </div>
              ) : (
                filteredChats.map((chat) => (
                  <motion.button
                    key={chat.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedChat(chat)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border p-4 transition-colors hover:bg-secondary/50",
                      selectedChat?.id === chat.id && "bg-secondary"
                    )}
                  >
                    <Avatar
                      name={chat.name}
                      src={chat.participants[0]?.profilePictureUrl}
                      status={getParticipantStatus(chat)}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground truncate">
                          {chat.name}
                        </span>
                        {chat.lastMessage && (
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(new Date(chat.lastMessage.createdAt))}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-sm text-muted-foreground truncate">
                          {chat.lastMessage?.content || "No messages yet"}
                        </p>
                        {chat.unreadCount > 0 && (
                          <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                            {chat.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat View */}
      <AnimatePresence mode="wait">
        {showChat && (
          <motion.div
            key="chat-view"
            initial={isMobile ? { x: 300, opacity: 0 } : false}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="flex flex-1 flex-col"
          >
            {selectedChat ? (
              <>
                {/* Chat Header */}
                <div className="flex items-center gap-3 border-b border-border bg-card p-4">
                  {isMobile && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedChat(null)}
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                  )}
                  <Avatar
                    name={selectedChat.name}
                    src={selectedChat.participants[0]?.profilePictureUrl}
                    status={getParticipantStatus(selectedChat)}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-medium text-foreground truncate">
                      {selectedChat.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {typingUsers.length > 0
                        ? `${typingUsers[0].displayName} is typing...`
                        : selectedChat.type === 'group'
                        ? `${selectedChat.participants.length} members`
                        : 'Online'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleCall(false)}
                    >
                      <Phone className="h-5 w-5" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => handleCall(true)}
                    >
                      <Video className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-5 w-5" />
                    </Button>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-background">
                  {/* Load more button */}
                  {hasNextPage && (
                    <div className="flex justify-center py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                      >
                        {isFetchingNextPage ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : null}
                        Load older messages
                      </Button>
                    </div>
                  )}
                  
                  {isLoadingMessages ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : (
                    messages.map((message) => (
                      <ChatMessage
                        key={message.id}
                        id={message.id}
                        content={message.content}
                        timestamp={new Date(message.createdAt)}
                        isSent={message.senderId === user?.id}
                        status={message.status}
                      />
                    ))
                  )}
                  
                  {/* Typing indicator */}
                  {typingUsers.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <div className="flex gap-1">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </motion.div>
                  )}
                  
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <div className="border-t border-border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="text-muted-foreground">
                      <Smile className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground">
                      <Paperclip className="h-5 w-5" />
                    </Button>
                    <Input
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => handleInputChange(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                      className="flex-1"
                    />
                    <Button
                      variant="gradient"
                      size="icon"
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || sendMessageMutation.isPending}
                    >
                      {sendMessageMutation.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center bg-background">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-secondary">
                    <Search className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h2 className="text-xl font-semibold text-foreground">
                    Select a conversation
                  </h2>
                  <p className="mt-1 text-muted-foreground">
                    Choose a chat from the list to start messaging
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
