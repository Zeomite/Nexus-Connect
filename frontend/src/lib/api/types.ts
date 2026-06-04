// API Response Types

// ============ Auth Types ============

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface RegisterResponse {
  message: string;
  userId: string;
  uniqueNumber: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface VerifyEmailRequest {
  email: string;
  code: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface VerifyResetCodeRequest {
  email: string;
  code: string;
}

export interface VerifyResetCodeResponse {
  message: string;
  resetToken: string;
}

export interface UpdatePasswordRequest {
  email: string;
  resetToken: string;
  password: string;
}

// ============ User Types ============

export type UserStatus = 'online' | 'offline' | 'busy' | 'away' | 'do_not_disturb';

export interface User {
  id: string;
  email: string;
  uniqueNumber: string;
  displayName: string;
  profilePictureUrl?: string;
  status: UserStatus;
  createdAt?: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  profilePictureUrl?: string;
}

export interface UpdateStatusRequest {
  status: UserStatus;
}

export interface SearchUserResult {
  id: string;
  displayName: string;
  uniqueNumber: string;
  profilePictureUrl?: string;
  status: UserStatus;
}

export interface SearchUsersResponse {
  users: SearchUserResult[];
  total: number;
  page: number;
  limit: number;
}

// ============ Chat Types ============

export type MessageType = 'text' | 'image' | 'file' | 'audio' | 'video';
export type MessageStatus = 'sent' | 'delivered' | 'read';
export type ChatType = 'direct' | 'group';

export interface ChatParticipant {
  id: string;
  displayName: string;
  profilePictureUrl?: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  senderId: string;
  type: MessageType;
  status: MessageStatus;
  replyToId?: string;
  createdAt: string;
}

export interface Chat {
  id: string;
  type: ChatType;
  name: string;
  lastMessage?: ChatMessage;
  unreadCount: number;
  participants: ChatParticipant[];
}

export interface ChatsResponse {
  chats: Chat[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateDirectChatRequest {
  participantId: string;
}

export interface CreateDirectChatResponse {
  id: string;
  type: 'direct';
  isNew: boolean;
}

export interface CreateGroupChatRequest {
  name: string;
  participantIds: string[];
}

export interface CreateGroupChatResponse {
  id: string;
  type: 'group';
  name: string;
}

export interface SendMessageRequest {
  chatId: string;
  type: MessageType;
  content: string;
  replyToId?: string;
}

export interface SendMessageResponse {
  id: string;
  chatId: string;
  senderId: string;
  type: MessageType;
  content: string;
  status: MessageStatus;
  createdAt: string;
}

export interface ChatMessagesResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface MarkMessagesReadRequest {
  chatId: string;
  messageIds: string[];
}

// ============ Call Types ============

export type CallType = 'audio' | 'video';
export type CallStatus = 'ongoing' | 'ended';

export interface InitiateCallRequest {
  participantIds: string[];
  type: CallType;
  groupId?: string;
}

export interface InitiateCallResponse {
  callId: string;
  roomId: string;
  type: CallType;
  wsUrl: string;
}

export interface AcceptCallResponse {
  callId: string;
  roomId: string;
  wsUrl: string;
}

export interface ActiveCall {
  callId: string;
  type: CallType;
  status: CallStatus;
}

export interface ActiveCallsResponse {
  calls: ActiveCall[];
}

// ============ Call History Types ============

export type CallDirection = 'incoming' | 'outgoing';
export type CallHistoryStatus = 'answered' | 'missed' | 'declined';

export interface CallHistoryRecord {
  id: string;
  callId: string;
  direction: CallDirection;
  type: CallType;
  status: CallHistoryStatus;
  duration: number;
  participantCount: number;
  createdAt: string;
}

export interface CallHistoryResponse {
  history: CallHistoryRecord[];
  total: number;
  page: number;
  limit: number;
}

// ============ Group Types ============

export type GroupRole = 'owner' | 'admin' | 'member';

export interface Group {
  id: string;
  name: string;
  role: GroupRole;
}

export interface GroupsResponse {
  groups: Group[];
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  memberIds: string[];
}

export interface CreateGroupResponse {
  id: string;
  name: string;
}

export interface AddMemberRequest {
  userId: string;
}

// ============ Expense Types ============

export type SplitType = 'equal' | 'percentage' | 'custom';

export interface ExpenseSplit {
  userId: string;
  percentage?: number;
  amount?: number;
}

export interface CreateExpenseRequest {
  groupId: string;
  description: string;
  totalAmount: number;
  currency: string;
  splitType: SplitType;
  participantIds?: string[];
  splits?: ExpenseSplit[];
  paidById: string;
}

export interface CreateExpenseResponse {
  id: string;
}

export interface Balance {
  user_id: string;
  net_balance: number;
}

export interface GroupBalancesResponse {
  balances: Balance[];
}

export interface CreateSettlementRequest {
  groupId: string;
  toUserId: string;
  amount: number;
  currency: string;
}

export interface CreateSettlementResponse {
  id: string;
}

// ============ Error Types ============

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
