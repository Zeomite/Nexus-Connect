// ===========================================
// User Table Queries
// ===========================================

export const UserQueries = {
  // Select queries
  SELECT: {
    BY_ID: `
      SELECT id, email, password_hash, unique_number, display_name, 
             profile_picture_url, status, email_verified, created_at, updated_at, last_seen_at
      FROM users 
      WHERE id = $1
    `,

    BY_EMAIL: `
      SELECT id, email, password_hash, unique_number, display_name, 
             profile_picture_url, status, email_verified, created_at, updated_at, last_seen_at
      FROM users 
      WHERE email = $1
    `,

    BY_UNIQUE_NUMBER: `
      SELECT id, email, password_hash, unique_number, display_name, 
             profile_picture_url, status, email_verified, created_at, updated_at, last_seen_at
      FROM users 
      WHERE unique_number = $1
    `,

    EXISTS_BY_EMAIL: `
      SELECT id FROM users WHERE email = $1
    `,

    EXISTS_BY_UNIQUE_NUMBER: `
      SELECT id FROM users WHERE unique_number = $1
    `,

    PROFILE_BY_ID: `
      SELECT id, email, unique_number, display_name, profile_picture_url, status, created_at
      FROM users 
      WHERE id = $1
    `,

    PUBLIC_PROFILE_BY_ID: `
      SELECT id, display_name, unique_number, profile_picture_url, status
      FROM users 
      WHERE id = $1
    `,

    PUBLIC_PROFILE_BY_UNIQUE_NUMBER: `
      SELECT id, display_name, unique_number, profile_picture_url, status
      FROM users 
      WHERE unique_number = $1
    `,

    STATUS_BY_ID: `
      SELECT status FROM users WHERE id = $1
    `,

    STATUSES_BY_IDS: `
      SELECT id, status FROM users WHERE id = ANY($1)
    `,

    SEARCH_BY_NAME: `
      SELECT id, display_name, unique_number, profile_picture_url, status
      FROM users 
      WHERE id != $1 AND display_name ILIKE $2
      ORDER BY display_name ASC
      LIMIT $3 OFFSET $4
    `,

    COUNT_SEARCH_BY_NAME: `
      SELECT COUNT(*) as count 
      FROM users 
      WHERE id != $1 AND display_name ILIKE $2
    `,

    FOR_LOGIN: `
      SELECT id, email, password_hash, unique_number, display_name, email_verified
      FROM users 
      WHERE email = $1
    `,

    EMAIL_VERIFIED: `
      SELECT id, email_verified FROM users WHERE email = $1
    `,
  },

  // Insert queries
  INSERT: {
    USER: `
      INSERT INTO users (id, email, password_hash, unique_number, display_name, email_verified, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, false, NOW(), NOW())
    `,
  },

  // Update queries
  UPDATE: {
    EMAIL_VERIFIED: `
      UPDATE users 
      SET email_verified = true, updated_at = NOW() 
      WHERE id = $1
    `,

    PASSWORD: `
      UPDATE users 
      SET password_hash = $1, updated_at = NOW() 
      WHERE id = $2
    `,

    LAST_SEEN: `
      UPDATE users 
      SET last_seen_at = NOW() 
      WHERE id = $1
    `,

    STATUS: `
      UPDATE users 
      SET status = $1, last_seen_at = NOW(), updated_at = NOW() 
      WHERE id = $2
    `,

    PROFILE_PICTURE: `
      UPDATE users 
      SET profile_picture_url = $1, updated_at = NOW() 
      WHERE id = $2
    `,

    DISPLAY_NAME: `
      UPDATE users 
      SET display_name = $1, updated_at = NOW() 
      WHERE id = $2
    `,
  },

  // Delete queries
  DELETE: {
    BY_ID: `
      DELETE FROM users WHERE id = $1
    `,
  },
} as const;
