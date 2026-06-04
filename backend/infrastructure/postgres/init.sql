-- Nexus Database Schema
-- Initialize all tables for the microservices

-- Users table (Auth Service)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    unique_number VARCHAR(10) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    profile_picture_url TEXT,
    status VARCHAR(20) DEFAULT 'offline',
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_unique_number ON users(unique_number);
CREATE INDEX idx_users_status ON users(status);

-- Chats table (Chat Service)
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY,
    type VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'group')),
    name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_chats_type ON chats(type);

-- Chat participants
CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_read_at TIMESTAMP WITH TIME ZONE,
    is_admin BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_chat_participants_user ON chat_participants(user_id);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL,
    type VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file', 'audio', 'video', 'system')),
    content TEXT NOT NULL,
    metadata JSONB,
    status VARCHAR(10) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    reply_to_id UUID REFERENCES messages(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_messages_chat ON messages(chat_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_created ON messages(chat_id, created_at DESC);

-- Calls table (Call Service)
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('audio', 'video')),
    status VARCHAR(20) NOT NULL DEFAULT 'initiating',
    initiator_id UUID NOT NULL,
    is_group_call BOOLEAN DEFAULT FALSE,
    group_id UUID,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_calls_initiator ON calls(initiator_id);
CREATE INDEX idx_calls_status ON calls(status);

-- Call participants
CREATE TABLE IF NOT EXISTS call_participants (
    id UUID PRIMARY KEY,
    call_id UUID REFERENCES calls(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'invited',
    is_muted BOOLEAN DEFAULT FALSE,
    is_video_enabled BOOLEAN DEFAULT TRUE,
    is_screen_sharing BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMP WITH TIME ZONE,
    left_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_call_participants_call ON call_participants(call_id);
CREATE INDEX idx_call_participants_user ON call_participants(user_id);

-- Call history
CREATE TABLE IF NOT EXISTS call_history (
    id UUID PRIMARY KEY,
    call_id UUID NOT NULL,
    user_id UUID NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    type VARCHAR(10) NOT NULL CHECK (type IN ('audio', 'video')),
    status VARCHAR(10) NOT NULL CHECK (status IN ('answered', 'missed', 'declined', 'ongoing', 'ringing')),
    duration INTEGER,
    participant_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_call_history_user ON call_history(user_id, created_at DESC);
CREATE INDEX idx_call_history_call ON call_history(call_id);

-- Groups table (Group Service)
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    avatar_url TEXT,
    created_by_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_groups_created_by ON groups(created_by_id);

-- Group members
CREATE TABLE IF NOT EXISTS group_members (
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    invited_by_id UUID,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);

-- Expenses table (Expense Service)
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    created_by_id UUID NOT NULL,
    description VARCHAR(200) NOT NULL,
    total_amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    split_type VARCHAR(20) NOT NULL CHECK (split_type IN ('equal', 'exact', 'percentage')),
    paid_by_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settled_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_expenses_group ON expenses(group_id);
CREATE INDEX idx_expenses_created_by ON expenses(created_by_id);

-- Expense splits
CREATE TABLE IF NOT EXISTS expense_splits (
    id UUID PRIMARY KEY,
    expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    percentage DECIMAL(5, 2),
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX idx_expense_splits_user ON expense_splits(user_id);

-- Ledger entries (immutable)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    expense_id UUID,
    from_user_id UUID NOT NULL,
    to_user_id UUID NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    type VARCHAR(20) NOT NULL CHECK (type IN ('expense', 'settlement', 'adjustment')),
    description VARCHAR(200),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ledger_group ON ledger_entries(group_id);
CREATE INDEX idx_ledger_from_user ON ledger_entries(from_user_id);
CREATE INDEX idx_ledger_to_user ON ledger_entries(to_user_id);

-- Migrations tracking
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert migration records
INSERT INTO migrations (name) VALUES 
    ('001_initial_schema')
ON CONFLICT DO NOTHING;
