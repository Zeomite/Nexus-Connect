export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],

  // JWT
  jwt: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-production',
    refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production',
    accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // Email
  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'noreply@nexus.com',
  },

  // Rate limiting
  rateLimit: {
    loginWindow: 15 * 60 * 1000, // 15 minutes
    loginMax: 5,
    registerWindow: 60 * 60 * 1000, // 1 hour
    registerMax: 5,
    verifyWindow: 60 * 60 * 1000, // 1 hour
    verifyMax: 10,
  },

  // Token expiry (Redis TTL in seconds)
  tokenExpiry: {
    emailVerification: 24 * 60 * 60, // 24 hours
    passwordReset: 60 * 60, // 1 hour
    refreshToken: 7 * 24 * 60 * 60, // 7 days
  },

  // Frontend URLs
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  emailVerificationUrl: process.env.EMAIL_VERIFICATION_URL || 'http://localhost:3000/verify-email',
  passwordResetUrl: process.env.PASSWORD_RESET_URL || 'http://localhost:3000/reset-password',
} as const;
