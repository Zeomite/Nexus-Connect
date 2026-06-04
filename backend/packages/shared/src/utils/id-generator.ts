import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Generate UUID v4 (random)
export const generateUuid = (): string => {
  return uuidv4();
};

// Generate UUID v7 (time-ordered) - better for database indexing
// Fallback to custom implementation since uuid v7 may not be available
export const generateTimeOrderedUuid = (): string => {
  // Custom UUIDv7-like implementation: timestamp + random
  const timestamp = Date.now();
  const timestampHex = timestamp.toString(16).padStart(12, '0');
  const randomPart = crypto.randomBytes(10).toString('hex');
  // Format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-7${randomPart.slice(0, 3)}-${randomPart.slice(3, 7)}-${randomPart.slice(7, 19)}`;
};

// Generate unique 10-digit number for user identification
// This uses a combination of timestamp and random to ensure uniqueness
export const generateUniqueNumber = async (
  checkExists: (number: string) => Promise<boolean>,
  maxAttempts: number = 10
): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const number = generateRandomTenDigit();
    const exists = await checkExists(number);
    if (!exists) {
      return number;
    }
  }
  throw new Error('Failed to generate unique number after maximum attempts');
};

// Generate a random 10-digit number
const generateRandomTenDigit = (): string => {
  // Ensure first digit is not 0
  const firstDigit = crypto.randomInt(1, 10);
  const remainingDigits = crypto.randomInt(0, 1000000000).toString().padStart(9, '0');
  return `${firstDigit}${remainingDigits}`;
};

// Generate short ID for sharing (e.g., meeting links)
export const generateShortId = (length: number = 8): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
};

// Generate idempotency key for API operations
export const generateIdempotencyKey = (prefix: string = 'idem'): string => {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('base64url');
  return `${prefix}_${timestamp}_${random}`;
};

// Generate correlation ID for distributed tracing
export const generateCorrelationId = (): string => {
  return `corr_${uuidv4()}`;
};

// Generate request ID
export const generateRequestId = (): string => {
  return `req_${generateTimeOrderedUuid()}`;
};

// Generate session ID
export const generateSessionId = (): string => {
  return `sess_${crypto.randomBytes(24).toString('base64url')}`;
};

// Generate WebSocket connection ID
export const generateConnectionId = (): string => {
  return `ws_${crypto.randomBytes(16).toString('base64url')}`;
};

// Snowflake-like ID generator for high-throughput scenarios
export class SnowflakeGenerator {
  private sequence: number = 0;
  private lastTimestamp: number = -1;

  constructor(
    private readonly nodeId: number = 0,
    private readonly epoch: number = 1704067200000 // 2024-01-01
  ) {
    if (nodeId < 0 || nodeId > 1023) {
      throw new Error('Node ID must be between 0 and 1023');
    }
  }

  generate(): bigint {
    let timestamp = Date.now();

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1) & 4095;
      if (this.sequence === 0) {
        // Wait for next millisecond
        while (timestamp <= this.lastTimestamp) {
          timestamp = Date.now();
        }
      }
    } else {
      this.sequence = 0;
    }

    this.lastTimestamp = timestamp;

    // 41 bits for timestamp, 10 bits for node ID, 12 bits for sequence
    const id =
      BigInt(timestamp - this.epoch) << 22n |
      BigInt(this.nodeId) << 12n |
      BigInt(this.sequence);

    return id;
  }

  generateString(): string {
    return this.generate().toString();
  }
}
