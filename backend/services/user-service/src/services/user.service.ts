import { MultipartFile } from '@fastify/multipart';
import {
  PostgresClient,
  RedisClient,
  KafkaClient,
  UpdateProfileInput,
  UserStatusType,
  NotFoundError,
  SessionKeys,
  KafkaTopics,
  UserEventTypes,
  // Import centralized queries
  UserQueries,
} from '@nexus/shared';
import { config } from '../config';

interface UserRow {
  id: string;
  email: string;
  unique_number: string;
  display_name: string;
  profile_picture_url: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
}

interface PublicUserProfile {
  id: string;
  displayName: string;
  uniqueNumber: string;
  profilePictureUrl: string | null;
  status: string;
}

export class UserService {
  constructor(
    private readonly postgres: PostgresClient,
    private readonly redis: RedisClient,
    private readonly kafka: KafkaClient
  ) {}

  async getProfile(userId: string): Promise<{
    id: string;
    email: string;
    uniqueNumber: string;
    displayName: string;
    profilePictureUrl: string | null;
    status: string;
    createdAt: string;
  }> {
    const user = await this.postgres.queryOne<UserRow>(
      UserQueries.SELECT.PROFILE_BY_ID,
      [userId]
    );

    if (!user) {
      throw new NotFoundError('User');
    }

    // Get real-time status from Redis if available
    const cachedStatus = await this.redis.get(SessionKeys.userStatus(userId));

    return {
      id: user.id,
      email: user.email,
      uniqueNumber: user.unique_number,
      displayName: user.display_name,
      profilePictureUrl: user.profile_picture_url,
      status: cachedStatus || user.status,
      createdAt: user.created_at.toISOString(),
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<{
    id: string;
    displayName: string;
    profilePictureUrl: string | null;
  }> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.displayName !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(input.displayName);
    }

    if (input.profilePictureUrl !== undefined) {
      updates.push(`profile_picture_url = $${paramIndex++}`);
      values.push(input.profilePictureUrl);
    }

    if (updates.length === 0) {
      return this.getProfile(userId) as Promise<{
        id: string;
        displayName: string;
        profilePictureUrl: string | null;
      }>;
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await this.postgres.queryOne<UserRow>(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} 
       RETURNING id, display_name, profile_picture_url`,
      values
    );

    if (!result) {
      throw new NotFoundError('User');
    }

    // Publish profile updated event
    await this.kafka.publish(KafkaTopics.USER_EVENTS, {
      eventType: UserEventTypes.USER_PROFILE_UPDATED,
      payload: {
        userId,
        changes: input,
      },
    });

    return {
      id: result.id,
      displayName: result.display_name,
      profilePictureUrl: result.profile_picture_url,
    };
  }

  async updateStatus(userId: string, status: UserStatusType): Promise<void> {
    // Store in Redis for real-time access
    await this.redis.set(SessionKeys.userStatus(userId), status, config.statusTtl);

    // Update database
    await this.postgres.query(UserQueries.UPDATE.STATUS, [status, userId]);

    // Manage online users set
    if (status === 'online') {
      await this.redis.sadd(SessionKeys.onlineUsers(), userId);
    } else if (status === 'offline') {
      await this.redis.srem(SessionKeys.onlineUsers(), userId);
    }

    // Publish status change event
    await this.kafka.publish(KafkaTopics.USER_STATUS, {
      eventType: UserEventTypes.USER_STATUS_CHANGED,
      payload: {
        userId,
        newStatus: status,
      },
    }, userId); // Use userId as key for partitioning
  }

  async getStatus(userId: string): Promise<string> {
    // Try Redis first
    const cachedStatus = await this.redis.get(SessionKeys.userStatus(userId));
    if (cachedStatus) {
      return cachedStatus;
    }

    // Fall back to database
    const user = await this.postgres.queryOne<{ status: string }>(
      UserQueries.SELECT.STATUS_BY_ID,
      [userId]
    );

    return user?.status || 'offline';
  }

  async getStatuses(userIds: string[]): Promise<Record<string, string>> {
    const statuses: Record<string, string> = {};

    // Batch get from Redis
    const pipeline = this.redis.pipeline();
    for (const userId of userIds) {
      pipeline.get(SessionKeys.userStatus(userId));
    }
    const results = await pipeline.exec();

    const missingUserIds: string[] = [];
    if (results) {
      for (let i = 0; i < userIds.length; i++) {
        const [err, status] = results[i] as [Error | null, string | null];
        if (!err && status) {
          statuses[userIds[i]] = status;
        } else {
          missingUserIds.push(userIds[i]);
        }
      }
    }

    // Fetch missing from database
    if (missingUserIds.length > 0) {
      const dbUsers = await this.postgres.query<{ id: string; status: string }>(
        UserQueries.SELECT.STATUSES_BY_IDS,
        [missingUserIds]
      );

      for (const user of dbUsers.rows) {
        statuses[user.id] = user.status;
      }
    }

    return statuses;
  }

  async findByUniqueNumber(uniqueNumber: string): Promise<PublicUserProfile> {
    const user = await this.postgres.queryOne<UserRow>(
      UserQueries.SELECT.PUBLIC_PROFILE_BY_UNIQUE_NUMBER,
      [uniqueNumber]
    );

    if (!user) {
      throw new NotFoundError('User');
    }

    const cachedStatus = await this.redis.get(SessionKeys.userStatus(user.id));

    return {
      id: user.id,
      displayName: user.display_name,
      uniqueNumber: user.unique_number,
      profilePictureUrl: user.profile_picture_url,
      status: cachedStatus || user.status,
    };
  }

  async searchByName(
    query: string,
    excludeUserId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    users: PublicUserProfile[];
    total: number;
    page: number;
    limit: number;
  }> {
    const offset = (page - 1) * limit;

    // Full-text search on display_name
    const [usersResult, countResult] = await Promise.all([
      this.postgres.query<UserRow>(
        UserQueries.SELECT.SEARCH_BY_NAME,
        [excludeUserId, `%${query}%`, limit, offset]
      ),
      this.postgres.queryOne<{ count: string }>(
        UserQueries.SELECT.COUNT_SEARCH_BY_NAME,
        [excludeUserId, `%${query}%`]
      ),
    ]);

    const users: PublicUserProfile[] = usersResult.rows.map((user) => ({
      id: user.id,
      displayName: user.display_name,
      uniqueNumber: user.unique_number,
      profilePictureUrl: user.profile_picture_url,
      status: user.status,
    }));

    return {
      users,
      total: parseInt(countResult?.count || '0', 10),
      page,
      limit,
    };
  }

  async uploadAvatar(
    userId: string,
    file: MultipartFile
  ): Promise<{ profilePictureUrl: string }> {
    // In production, upload to S3/Cloud Storage
    // For now, we'll store metadata and return a placeholder URL
    const buffer = await file.toBuffer();
    const fileName = `${userId}-${Date.now()}.${file.mimetype.split('/')[1]}`;

    // TODO: Implement actual S3 upload
    // const s3Client = new S3Client({ ... });
    // await s3Client.send(new PutObjectCommand({ ... }));

    const profilePictureUrl = `https://${config.storage.bucket}.s3.${config.storage.region}.amazonaws.com/avatars/${fileName}`;

    // Update user profile
    await this.postgres.query(UserQueries.UPDATE.PROFILE_PICTURE, [profilePictureUrl, userId]);

    return { profilePictureUrl };
  }
}
