export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],

  jwt: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-production',
  },

  // Call settings
  call: {
    maxParticipants: 50,
    ringTimeout: 60000, // 60 seconds
    reconnectTimeout: 30000, // 30 seconds
  },

  // ICE servers for WebRTC
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Add TURN servers in production
    // {
    //   urls: 'turn:turn.example.com:3478',
    //   username: process.env.TURN_USERNAME,
    //   credential: process.env.TURN_CREDENTIAL,
    // },
  ],

  // Redis TTLs
  ttl: {
    callRoom: 24 * 60 * 60, // 24 hours
    participant: 60 * 60, // 1 hour
  },
} as const;
