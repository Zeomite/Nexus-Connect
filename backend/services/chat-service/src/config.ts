export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],

  jwt: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-production',
  },

  // WebSocket settings
  ws: {
    heartbeatInterval: 30000, // 30 seconds
    connectionTimeout: 60000, // 60 seconds
  },

  // Message settings
  message: {
    maxLength: 10000,
    maxFileSize: 10 * 1024 * 1024, // 10MB
  },

  // Typing indicator TTL
  typingTtl: 10, // seconds
} as const;
