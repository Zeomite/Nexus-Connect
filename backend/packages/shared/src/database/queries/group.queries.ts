// ===========================================
// Group Table Queries
// ===========================================

export const GroupQueries = {
  // Select queries
  SELECT: {
    BY_ID: `
      SELECT id, name, description, avatar_url, created_by_id, created_at, updated_at
      FROM groups 
      WHERE id = $1
    `,

    USER_GROUPS: `
      SELECT g.id, g.name, gm.role 
      FROM groups g
      INNER JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
    `,

    USER_GROUPS_PAGINATED: `
      SELECT g.id, g.name, g.description, gm.role 
      FROM groups g
      INNER JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
      LIMIT $2 OFFSET $3
    `,

    COUNT_BY_USER: `
      SELECT COUNT(*) as count 
      FROM group_members 
      WHERE user_id = $1
    `,
  },

  // Insert queries
  INSERT: {
    GROUP: `
      INSERT INTO groups (id, name, description, avatar_url, created_by_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    `,
  },

  // Update queries
  UPDATE: {
    NAME: `
      UPDATE groups 
      SET name = $1, updated_at = NOW() 
      WHERE id = $2
    `,

    DESCRIPTION: `
      UPDATE groups 
      SET description = $1, updated_at = NOW() 
      WHERE id = $2
    `,

    AVATAR: `
      UPDATE groups 
      SET avatar_url = $1, updated_at = NOW() 
      WHERE id = $2
    `,
  },

  // Delete queries
  DELETE: {
    BY_ID: `
      DELETE FROM groups WHERE id = $1
    `,
  },
} as const;

// ===========================================
// Group Members Queries
// ===========================================

export const GroupMemberQueries = {
  // Select queries
  SELECT: {
    BY_GROUP: `
      SELECT gm.user_id, gm.role, gm.joined_at, gm.invited_by_id, u.display_name, u.profile_picture_url
      FROM group_members gm
      INNER JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
    `,

    BY_GROUP_AND_USER: `
      SELECT group_id, user_id, role, joined_at, invited_by_id
      FROM group_members 
      WHERE group_id = $1 AND user_id = $2
    `,

    ROLE_BY_GROUP_AND_USER: `
      SELECT role FROM group_members 
      WHERE group_id = $1 AND user_id = $2
    `,

    IS_MEMBER: `
      SELECT 1 FROM group_members 
      WHERE group_id = $1 AND user_id = $2
    `,

    COUNT_BY_GROUP: `
      SELECT COUNT(*) as count FROM group_members WHERE group_id = $1
    `,

    OWNER_BY_GROUP: `
      SELECT user_id FROM group_members 
      WHERE group_id = $1 AND role = 'owner'
    `,
  },

  // Insert queries
  INSERT: {
    MEMBER: `
      INSERT INTO group_members (group_id, user_id, role, joined_at, invited_by_id)
      VALUES ($1, $2, $3, NOW(), $4)
    `,

    MEMBER_IF_NOT_EXISTS: `
      INSERT INTO group_members (group_id, user_id, role, joined_at, invited_by_id)
      VALUES ($1, $2, 'member', NOW(), $3)
      ON CONFLICT DO NOTHING
    `,
  },

  // Update queries
  UPDATE: {
    ROLE: `
      UPDATE group_members 
      SET role = $1 
      WHERE group_id = $2 AND user_id = $3
    `,
  },

  // Delete queries
  DELETE: {
    MEMBER: `
      DELETE FROM group_members 
      WHERE group_id = $1 AND user_id = $2
    `,

    ALL_BY_GROUP: `
      DELETE FROM group_members WHERE group_id = $1
    `,
  },
} as const;
