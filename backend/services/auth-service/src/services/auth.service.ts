import {
  PostgresClient,
  RedisClient,
  KafkaClient,
  RegisterUserInput,
  LoginUserInput,
  TokenPayload,
  hashPassword,
  comparePassword,
  generateTokenPair,
  verifyRefreshToken,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  generateUniqueNumber,
  generateTimeOrderedUuid,
  DuplicateEmailError,
  InvalidCredentialsError,
  EmailNotVerifiedError,
  TokenExpiredError,
  InvalidTokenError,
  NotFoundError,
  SessionKeys,
  KafkaTopics,
  UserEventTypes,
  // Import centralized queries and messages
  UserQueries,
  ResponseMessages,
  ErrorMessages,
} from '@nexus/shared';
import { config } from '../config';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  unique_number: string;
  display_name: string;
  email_verified: boolean;
}

export class AuthService {
  constructor(
    private readonly postgres: PostgresClient,
    private readonly redis: RedisClient,
    private readonly kafka: KafkaClient
  ) {}

  async register(input: RegisterUserInput): Promise<{
    userId: string;
    uniqueNumber: string;
    verificationCode: string;
  }> {
    // Check if email already exists
    const existingUser = await this.postgres.queryOne<{ id: string }>(
      UserQueries.SELECT.EXISTS_BY_EMAIL,
      [input.email.toLowerCase()]
    );

    if (existingUser) {
      throw new DuplicateEmailError();
    }

    // Generate unique 10-digit number
    const uniqueNumber = await generateUniqueNumber(async (num) => {
      const result = await this.postgres.queryOne<{ id: string }>(
        UserQueries.SELECT.EXISTS_BY_UNIQUE_NUMBER,
        [num]
      );
      return !!result;
    });

    // Hash password
    const passwordHash = await hashPassword(input.password);

    // Generate user ID
    const userId = generateTimeOrderedUuid();

    // Insert user
    await this.postgres.query(
      UserQueries.INSERT.USER,
      [userId, input.email.toLowerCase(), passwordHash, uniqueNumber, input.displayName]
    );

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Store verification code in Redis (keyed by email)
    await this.redis.set(
      SessionKeys.emailVerification(input.email.toLowerCase()),
      JSON.stringify({ userId, code: verificationCode }),
      config.tokenExpiry.emailVerification
    );

    // Publish user registered event
    await this.kafka.publish(KafkaTopics.USER_EVENTS, {
      eventType: UserEventTypes.USER_REGISTERED,
      payload: {
        userId,
        email: input.email.toLowerCase(),
        uniqueNumber,
        displayName: input.displayName,
      },
    });

    return {
      userId,
      uniqueNumber,
      verificationCode,
    };
  }

  async login(input: LoginUserInput): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
      id: string;
      email: string;
      displayName: string;
      uniqueNumber: string;
    };
  }> {
    // Find user by email
    const user = await this.postgres.queryOne<UserRow>(
      UserQueries.SELECT.FOR_LOGIN,
      [input.email.toLowerCase()]
    );

    if (!user) {
      throw new InvalidCredentialsError();
    }

    // Verify password
    const isValidPassword = await comparePassword(input.password, user.password_hash);
    if (!isValidPassword) {
      throw new InvalidCredentialsError();
    }

    // Check if email is verified
    if (!user.email_verified) {
      throw new EmailNotVerifiedError();
    }

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      uniqueNumber: user.unique_number,
    };

    const tokens = generateTokenPair(tokenPayload, config.jwt);

    // Store refresh token in Redis
    await this.redis.set(
      SessionKeys.refreshToken(tokens.refreshToken),
      user.id,
      config.tokenExpiry.refreshToken
    );

    // Update last login
    await this.postgres.query(UserQueries.UPDATE.LAST_SEEN, [user.id]);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        uniqueNumber: user.unique_number,
      },
    };
  }

  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    // Verify refresh token exists in Redis
    const userId = await this.redis.get(SessionKeys.refreshToken(refreshToken));
    if (!userId) {
      throw new InvalidTokenError();
    }

    // Verify token signature
    let tokenPayload: TokenPayload;
    try {
      tokenPayload = verifyRefreshToken(refreshToken, config.jwt.refreshTokenSecret);
    } catch {
      // Invalid token, remove from Redis
      await this.redis.del(SessionKeys.refreshToken(refreshToken));
      throw new InvalidTokenError();
    }

    // Delete old refresh token
    await this.redis.del(SessionKeys.refreshToken(refreshToken));

    // Generate new tokens
    const newTokens = generateTokenPair(tokenPayload, config.jwt);

    // Store new refresh token
    await this.redis.set(
      SessionKeys.refreshToken(newTokens.refreshToken),
      userId,
      config.tokenExpiry.refreshToken
    );

    return newTokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.redis.del(SessionKeys.refreshToken(refreshToken));
  }

  async verifyEmail(email: string, code: string): Promise<void> {
    const storedData = await this.redis.get(SessionKeys.emailVerification(email.toLowerCase()));
    if (!storedData) {
      throw new TokenExpiredError();
    }

    const { userId, code: storedCode } = JSON.parse(storedData);
    
    if (code !== storedCode) {
      throw new InvalidTokenError();
    }

    // Update user email_verified status
    const result = await this.postgres.query(
      UserQueries.UPDATE.EMAIL_VERIFIED,
      [userId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }

    // Delete verification code
    await this.redis.del(SessionKeys.emailVerification(email.toLowerCase()));

    // Publish email verified event
    await this.kafka.publish(KafkaTopics.USER_EVENTS, {
      eventType: UserEventTypes.USER_EMAIL_VERIFIED,
      payload: { userId },
    });
  }

  async resendVerificationEmail(email: string): Promise<string | null> {
    const user = await this.postgres.queryOne<{ id: string; email_verified: boolean }>(
      UserQueries.SELECT.EMAIL_VERIFIED,
      [email.toLowerCase()]
    );

    if (!user || user.email_verified) {
      return null;
    }

    // Generate new 6-digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in Redis (keyed by email)
    await this.redis.set(
      SessionKeys.emailVerification(email.toLowerCase()),
      JSON.stringify({ userId: user.id, code }),
      config.tokenExpiry.emailVerification
    );

    return code;
  }

  async forgotPassword(email: string): Promise<string | null> {
    const user = await this.postgres.queryOne<{ id: string }>(
      UserQueries.SELECT.EXISTS_BY_EMAIL,
      [email.toLowerCase()]
    );

    if (!user) {
      return null;
    }

    // Generate 6-digit reset code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in Redis (keyed by email)
    await this.redis.set(
      SessionKeys.passwordReset(email.toLowerCase()),
      JSON.stringify({ userId: user.id, code }),
      config.tokenExpiry.passwordReset
    );

    return code;
  }

  async verifyResetCode(email: string, code: string): Promise<string> {
    const storedData = await this.redis.get(SessionKeys.passwordReset(email.toLowerCase()));
    if (!storedData) {
      throw new TokenExpiredError();
    }

    const { userId, code: storedCode } = JSON.parse(storedData);

    if (code !== storedCode) {
      throw new InvalidTokenError();
    }

    // Generate a temporary reset token (valid for 10 minutes)
    const resetToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
    
    // Store verified reset token in Redis
    await this.redis.set(
      `password_reset_verified:${email.toLowerCase()}`,
      JSON.stringify({ userId, resetToken }),
      600 // 10 minutes
    );

    // Delete the code (it's been used)
    await this.redis.del(SessionKeys.passwordReset(email.toLowerCase()));

    return resetToken;
  }

  async updatePassword(email: string, resetToken: string, newPassword: string): Promise<void> {
    const storedData = await this.redis.get(`password_reset_verified:${email.toLowerCase()}`);
    if (!storedData) {
      throw new TokenExpiredError();
    }

    const { userId, resetToken: storedToken } = JSON.parse(storedData);

    if (resetToken !== storedToken) {
      throw new InvalidTokenError();
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update password
    const result = await this.postgres.query(
      UserQueries.UPDATE.PASSWORD,
      [passwordHash, userId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('User');
    }

    // Delete verified reset token
    await this.redis.del(`password_reset_verified:${email.toLowerCase()}`);

    // Invalidate all refresh tokens for this user
    // In production, you'd want to track all refresh tokens per user
  }
}
