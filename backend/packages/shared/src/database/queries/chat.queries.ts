// ===========================================
// Chat Table Queries
// ===========================================

export const ChatQueries = {
  // Select queries
  SELECT: {
    BY_ID: `
      SELECT id, type, name, created_at, updated_at
      FROM chats 
      WHERE id = $1
    `,

    USER_CHATS: `
      SELECT c.id, c.type, c.name, c.created_at, c.updated_at,
             (SELECT MAX(created_at) FROM messages WHERE chat_id = c.id) as last_message_at
      FROM chats c
      INNER JOIN chat_participants cp ON c.id = cp.chat_id
      WHERE cp.user_id = $1
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `,

    USER_CHATS_COUNT: `
      SELECT COUNT(*) as count 
      FROM chat_participants 
      WHERE user_id = $1
    `,

    DIRECT_CHAT_EXISTS: `
      SELECT c.id FROM chats c
      WHERE c.type = 'direct'
      AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = $1)
      AND EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = c.id AND user_id = $2)
      AND (SELECT COUNT(*) FROM chat_participants WHERE chat_id = c.id) = 2
    `,

    TYPE_BY_ID: `
      SELECT type FROM chats WHERE id = $1
    `,
  },

  // Insert queries
  INSERT: {
    CHAT: `
      INSERT INTO chats (id, type, created_at, updated_at) 
      VALUES ($1, $2, NOW(), NOW())
    `,

    CHAT_WITH_NAME: `
      INSERT INTO chats (id, type, name, created_at, updated_at) 
      VALUES ($1, $2, $3, NOW(), NOW())
    `,
  },

  // Update queries
  UPDATE: {
    NAME: `
      UPDATE chats 
      SET name = $1, updated_at = NOW() 
      WHERE id = $2
    `,
  },

  // Delete queries
  DELETE: {
    BY_ID: `
      DELETE FROM chats WHERE id = $1
    `,
  },
} as const;

// ===========================================
// Chat Participants Queries
// ===========================================

export const ChatParticipantQueries = {
  // Select queries
  SELECT: {
    IS_PARTICIPANT: `
      SELECT 1 FROM chat_participants 
      WHERE chat_id = $1 AND user_id = $2
    `,

    BY_CHAT_ID: `
      SELECT u.id as user_id, u.display_name, u.profile_picture_url, cp.joined_at, cp.is_admin
      FROM chat_participants cp
      INNER JOIN users u ON cp.user_id = u.id
      WHERE cp.chat_id = $1
    `,

    PREVIEW_BY_CHAT: `
      SELECT u.id, u.display_name, u.profile_picture_url
      FROM chat_participants cp
      INNER JOIN users u ON cp.user_id = u.id
      WHERE cp.chat_id = $1 AND cp.user_id != $2
      LIMIT 3
    `,

    USER_IDS_BY_CHAT: `
      SELECT user_id FROM chat_participants 
      WHERE chat_id = $1 AND user_id != $2
    `,

    LAST_READ: `
      SELECT last_read_at FROM chat_participants 
      WHERE chat_id = $1 AND user_id = $2
    `,
  },

  // Insert queries
  INSERT: {
    PARTICIPANT: `
      INSERT INTO chat_participants (chat_id, user_id, joined_at, is_admin)
      VALUES ($1, $2, NOW(), $3)
    `,

    TWO_PARTICIPANTS: `
      INSERT INTO chat_participants (chat_id, user_id, joined_at, is_admin)
      VALUES ($1, $2, NOW(), false), ($1, $3, NOW(), false)
    `,
  },

  // Update queries
  UPDATE: {
    LAST_READ: `
      UPDATE chat_participants 
      SET last_read_at = NOW() 
      WHERE chat_id = $1 AND user_id = $2
    `,

    IS_ADMIN: `
      UPDATE chat_participants 
      SET is_admin = $1 
      WHERE chat_id = $2 AND user_id = $3
    `,
  },

  // Delete queries
  DELETE: {
    PARTICIPANT: `
      DELETE FROM chat_participants 
      WHERE chat_id = $1 AND user_id = $2
    `,
  },
} as const;

// ===========================================
// Message Queries
// ===========================================

export const MessageQueries = {
  // Select queries
  SELECT: {
    BY_ID: `
      SELECT id, chat_id, sender_id, type, content, metadata, status, reply_to_id, created_at, updated_at, deleted_at
      FROM messages 
      WHERE id = $1 AND deleted_at IS NULL
    `,

    BY_CHAT: `
      SELECT id, chat_id, sender_id, type, content, metadata, status, reply_to_id, created_at
      FROM messages
      WHERE chat_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2
    `,

    BY_CHAT_BEFORE: `
      SELECT id, chat_id, sender_id, type, content, metadata, status, reply_to_id, created_at
      FROM messages
      WHERE chat_id = $1 AND deleted_at IS NULL AND created_at < $2
      ORDER BY created_at DESC
      LIMIT $3
    `,

    BY_CHAT_AFTER: `
      SELECT id, chat_id, sender_id, type, content, metadata, status, reply_to_id, created_at
      FROM messages
      WHERE chat_id = $1 AND deleted_at IS NULL AND created_at > $2
      ORDER BY created_at DESC
      LIMIT $3
    `,

    LAST_BY_CHAT: `
      SELECT id, content, sender_id, created_at 
      FROM messages
      WHERE chat_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC 
      LIMIT 1
    `,

    UNREAD_COUNT: `
      SELECT COUNT(*) as count FROM messages m
      INNER JOIN chat_participants cp ON m.chat_id = cp.chat_id
      WHERE m.chat_id = $1 AND cp.user_id = $2
      AND m.sender_id != $2
      AND m.status != 'read'
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
    `,

    SENDER_ID: `
      SELECT id, chat_id, sender_id FROM messages 
      WHERE id = $1 AND deleted_at IS NULL
    `,
  },

  // Insert queries
  INSERT: {
    MESSAGE: `
      INSERT INTO messages (id, chat_id, sender_id, type, content, metadata, status, reply_to_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, NOW(), NOW())
    `,
  },

  // Update queries
  UPDATE: {
    STATUS: `
      UPDATE messages 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
    `,

    STATUS_BULK: `
      UPDATE messages 
      SET status = 'read', updated_at = NOW()
      WHERE id = ANY($1) AND chat_id = $2 AND sender_id != $3
    `,

    SOFT_DELETE: `
      UPDATE messages 
      SET deleted_at = NOW(), updated_at = NOW() 
      WHERE id = $1
    `,
  },

  // Delete queries
  DELETE: {
    BY_ID: `
      DELETE FROM messages WHERE id = $1
    `,
  },
} as const;
