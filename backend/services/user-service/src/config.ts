export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],

  jwt: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-production',
  },

  // Status TTL in seconds
  statusTtl: 300, // 5 minutes

  // S3/Object storage for profile pictures
  storage: {
    bucket: process.env.STORAGE_BUCKET || 'nexus-profiles',
    region: process.env.STORAGE_REGION || 'us-east-1',
    endpoint: process.env.STORAGE_ENDPOINT,
    accessKeyId: process.env.STORAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.STORAGE_SECRET_KEY || '',
  },
} as const;
