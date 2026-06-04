import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { TokenPayload } from '../types/user';

const SALT_ROUNDS = 12;

// Password hashing
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// JWT token generation and verification
export interface TokenConfig {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenExpiry: string;
  refreshTokenExpiry: string;
}

export const generateAccessToken = (payload: TokenPayload, config: TokenConfig): string => {
  return jwt.sign(payload, config.accessTokenSecret, {
    expiresIn: config.accessTokenExpiry as string | number,
  } as jwt.SignOptions);
};

export const generateRefreshToken = (payload: TokenPayload, config: TokenConfig): string => {
  return jwt.sign(payload, config.refreshTokenSecret, {
    expiresIn: config.refreshTokenExpiry as string | number,
  } as jwt.SignOptions);
};

export const verifyAccessToken = (token: string, secret: string): TokenPayload => {
  return jwt.verify(token, secret) as TokenPayload;
};

export const verifyRefreshToken = (token: string, secret: string): TokenPayload => {
  return jwt.verify(token, secret) as TokenPayload;
};

// Generate tokens pair
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const generateTokenPair = (payload: TokenPayload, config: TokenConfig): TokenPair => {
  const accessToken = generateAccessToken(payload, config);
  const refreshToken = generateRefreshToken(payload, config);

  // Parse expiry to seconds
  const expiresIn = parseExpiry(config.accessTokenExpiry);

  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
};

const parseExpiry = (expiry: string): number => {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 3600; // default 1 hour

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return 3600;
  }
};

// Generate random tokens/codes
export const generateSecureToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

export const generateVerificationCode = (length: number = 6): string => {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return crypto.randomInt(min, max).toString();
};

// Generate email verification token
export const generateEmailVerificationToken = (): string => {
  return generateSecureToken(32);
};

// Generate password reset token
export const generatePasswordResetToken = (): string => {
  return generateSecureToken(32);
};

// Encryption for sensitive data (E2E encryption hooks)
export interface EncryptionResult {
  encrypted: string;
  iv: string;
  authTag: string;
}

export const encryptData = (data: string, key: Buffer): EncryptionResult => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
};

export const decryptData = (
  encrypted: string,
  key: Buffer,
  iv: string,
  authTag: string
): string => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

// Key derivation for E2E encryption
export const deriveKey = async (password: string, salt: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
};

// Generate room/call ID for WebRTC
export const generateRoomId = (): string => {
  return `room_${crypto.randomBytes(12).toString('base64url')}`;
};
