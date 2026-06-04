// ===========================================
// Call Table Queries
// ===========================================

export const CallQueries = {
  // Select queries
  SELECT: {
    BY_ID: `
      SELECT id, room_id, type, status, initiator_id, is_group_call, group_id, started_at, ended_at, created_at
      FROM calls 
      WHERE id = $1
    `,

    BY_ROOM_ID: `
      SELECT id, room_id, type, status, initiator_id, is_group_call, group_id, started_at, ended_at, created_at
      FROM calls 
      WHERE room_id = $1
    `,

    ACTIVE_BY_INITIATOR: `
      SELECT id, room_id, type, status
      FROM calls 
      WHERE initiator_id = $1 AND status IN ('initiating', 'ringing', 'ongoing')
    `,

    STATUS_BY_ID: `
      SELECT status FROM calls WHERE id = $1
    `,
  },

  // Insert queries
  INSERT: {
    CALL: `
      INSERT INTO calls (id, room_id, type, status, initiator_id, is_group_call, group_id, created_at)
      VALUES ($1, $2, $3, 'initiating', $4, $5, $6, NOW())
    `,
  },

  // Update queries
  UPDATE: {
    STATUS: `
      UPDATE calls 
      SET status = $1 
      WHERE id = $2
    `,

    STATUS_WITH_START: `
      UPDATE calls 
      SET status = 'ongoing', started_at = NOW() 
      WHERE id = $1
    `,

    END_CALL: `
      UPDATE calls 
      SET status = 'ended', ended_at = NOW() 
      WHERE id = $1
    `,
  },

  // Delete queries
  DELETE: {
    BY_ID: `
      DELETE FROM calls WHERE id = $1
    `,
  },
} as const;

// ===========================================
// Call Participants Queries
// ===========================================

export const CallParticipantQueries = {
  // Select queries
  SELECT: {
    BY_CALL_ID: `
      SELECT id, call_id, user_id, status, is_muted, is_video_enabled, is_screen_sharing, joined_at, left_at
      FROM call_participants 
      WHERE call_id = $1
    `,

    BY_CALL_AND_USER: `
      SELECT id, call_id, user_id, status, is_muted, is_video_enabled, is_screen_sharing, joined_at, left_at
      FROM call_participants 
      WHERE call_id = $1 AND user_id = $2
    `,

    USER_IDS_BY_CALL: `
      SELECT user_id FROM call_participants WHERE call_id = $1
    `,

    COUNT_BY_CALL: `
      SELECT COUNT(*) as count FROM call_participants WHERE call_id = $1 AND status = 'joined'
    `,
  },

  // Insert queries
  INSERT: {
    PARTICIPANT: `
      INSERT INTO call_participants (id, call_id, user_id, status, is_muted, is_video_enabled, is_screen_sharing)
      VALUES ($1, $2, $3, 'invited', false, $4, false)
    `,
  },

  // Update queries
  UPDATE: {
    STATUS: `
      UPDATE call_participants 
      SET status = $1 
      WHERE call_id = $2 AND user_id = $3
    `,

    JOINED: `
      UPDATE call_participants 
      SET status = 'joined', joined_at = NOW() 
      WHERE call_id = $1 AND user_id = $2
    `,

    LEFT: `
      UPDATE call_participants 
      SET status = 'left', left_at = NOW() 
      WHERE call_id = $1 AND user_id = $2
    `,

    MUTE: `
      UPDATE call_participants 
      SET is_muted = $1 
      WHERE call_id = $2 AND user_id = $3
    `,

    VIDEO: `
      UPDATE call_participants 
      SET is_video_enabled = $1 
      WHERE call_id = $2 AND user_id = $3
    `,

    SCREEN_SHARE: `
      UPDATE call_participants 
      SET is_screen_sharing = $1 
      WHERE call_id = $2 AND user_id = $3
    `,
  },

  // Delete queries
  DELETE: {
    BY_CALL_AND_USER: `
      DELETE FROM call_participants 
      WHERE call_id = $1 AND user_id = $2
    `,
  },
} as const;

// ===========================================
// Call History Queries
// ===========================================

export const CallHistoryQueries = {
  // Select queries
  SELECT: {
    BY_USER: `
      SELECT id, call_id, user_id, direction, type, status, duration, participant_count, created_at
      FROM call_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,

    BY_CALL_AND_USER: `
      SELECT id, call_id, user_id, direction, type, status, duration, participant_count, created_at
      FROM call_history
      WHERE call_id = $1 AND user_id = $2
    `,

    COUNT_BY_USER: `
      SELECT COUNT(*) as count FROM call_history WHERE user_id = $1
    `,

    PARTICIPANTS_BY_CALL: `
      SELECT ch.user_id, u.display_name 
      FROM call_history ch
      INNER JOIN users u ON ch.user_id = u.id
      WHERE ch.call_id = $1
    `,
  },

  // Insert queries
  INSERT: {
    HISTORY: `
      INSERT INTO call_history (id, call_id, user_id, direction, type, status, participant_count, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `,
  },

  // Update queries
  UPDATE: {
    STATUS: `
      UPDATE call_history 
      SET status = $1 
      WHERE call_id = $2 AND user_id = $3
    `,

    ENDED: `
      UPDATE call_history 
      SET status = 'answered', duration = $1, participant_count = $2
      WHERE call_id = $3 AND status IN ('ongoing', 'ringing')
    `,

    MISSED: `
      UPDATE call_history 
      SET status = 'missed' 
      WHERE call_id = $1 AND user_id = $2
    `,
  },

  // Delete queries
  DELETE: {
    BY_ID: `
      DELETE FROM call_history WHERE id = $1
    `,
  },
} as const;
