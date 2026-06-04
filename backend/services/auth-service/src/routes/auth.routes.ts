import { FastifyPluginAsync } from 'fastify';
import { AuthService } from '../services/auth.service';
import { EmailService } from '../services/email.service';
import {
  RegisterUserSchema,
  LoginUserSchema,
  RefreshTokenSchema,
  validate,
  createLoginRateLimiter,
  createAuthRateLimiter,
  createRateLimitMiddleware,
  ResponseMessages,
} from '@nexus/shared';
import { z } from 'zod';

const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

export const authRoutes: FastifyPluginAsync = async (server) => {
  const authService = new AuthService(server.postgres, server.redis, server.kafka);
  const emailService = new EmailService();

  const loginRateLimiter = createLoginRateLimiter(server.redis);
  const authRateLimiter = createAuthRateLimiter(server.redis);

  // Register new user
  server.post('/register', {
    schema: {
      description: 'Register a new user',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'password', 'displayName'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            userId: { type: 'string' },
            uniqueNumber: { type: 'string' },
          },
        },
      },
    },
    preHandler: createRateLimitMiddleware(authRateLimiter),
  }, async (request, reply) => {
    const input = validate(RegisterUserSchema, request.body);
    const result = await authService.register(input);

    // Send verification email with code
    await emailService.sendVerificationEmail(input.email, result.verificationCode);

    return reply.status(201).send({
      message: ResponseMessages.AUTH.REGISTRATION_SUCCESS,
      userId: result.userId,
      uniqueNumber: result.uniqueNumber,
    });
  });

  // Login
  server.post('/login', {
    schema: {
      description: 'Login with email and password',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'number' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                displayName: { type: 'string' },
                uniqueNumber: { type: 'string' },
              },
            },
          },
        },
      },
    },
    preHandler: createRateLimitMiddleware(loginRateLimiter),
  }, async (request, reply) => {
    const input = validate(LoginUserSchema, request.body);
    const result = await authService.login(input);
    return reply.send(result);
  });

  // Refresh token
  server.post('/refresh', {
    schema: {
      description: 'Refresh access token',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const input = validate(RefreshTokenSchema, request.body);
    const result = await authService.refreshTokens(input.refreshToken);
    return reply.send(result);
  });

  // Logout
  server.post('/logout', {
    schema: {
      description: 'Logout and invalidate refresh token',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const input = validate(RefreshTokenSchema, request.body);
    await authService.logout(input.refreshToken);
    return reply.send({ message: ResponseMessages.AUTH.LOGOUT_SUCCESS });
  });

  // Verify email with code
  server.post('/verify-email', {
    schema: {
      description: 'Verify email with 6-digit code',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'code'],
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string', minLength: 6, maxLength: 6 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
    preHandler: createRateLimitMiddleware(authRateLimiter),
  }, async (request, reply) => {
    const { email, code } = request.body as { email: string; code: string };
    await authService.verifyEmail(email, code);
    return reply.send({ message: ResponseMessages.AUTH.EMAIL_VERIFIED });
  });

  // Resend verification email
  server.post('/resend-verification', {
    schema: {
      description: 'Resend verification email',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
    preHandler: createRateLimitMiddleware(authRateLimiter),
  }, async (request, reply) => {
    const input = validate(ForgotPasswordSchema, request.body);
    const token = await authService.resendVerificationEmail(input.email);
    if (token) {
      await emailService.sendVerificationEmail(input.email, token);
    }
    // Always return success to prevent email enumeration
    return reply.send({ message: ResponseMessages.AUTH.VERIFICATION_EMAIL_SENT });
  });

  // Forgot password
  server.post('/forgot-password', {
    schema: {
      description: 'Request password reset',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
    preHandler: createRateLimitMiddleware(authRateLimiter),
  }, async (request, reply) => {
    const input = validate(ForgotPasswordSchema, request.body);
    const token = await authService.forgotPassword(input.email);
    if (token) {
      await emailService.sendPasswordResetEmail(input.email, token);
    }
    // Always return success to prevent email enumeration
    return reply.send({ message: ResponseMessages.AUTH.PASSWORD_RESET_SENT });
  });

  // Verify reset code (step 1 of password reset)
  server.post('/verify-reset-code', {
    schema: {
      description: 'Verify 6-digit password reset code',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'code'],
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string', minLength: 6, maxLength: 6 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            resetToken: { type: 'string' },
          },
        },
      },
    },
    preHandler: createRateLimitMiddleware(authRateLimiter),
  }, async (request, reply) => {
    const { email, code } = request.body as { email: string; code: string };
    const resetToken = await authService.verifyResetCode(email, code);
    return reply.send({ 
      message: 'Code verified successfully',
      resetToken 
    });
  });

  // Update password (step 2 of password reset)
  server.post('/update-password', {
    schema: {
      description: 'Update password after code verification',
      tags: ['auth'],
      body: {
        type: 'object',
        required: ['email', 'resetToken', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          resetToken: { type: 'string' },
          password: { type: 'string', minLength: 8 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
    preHandler: createRateLimitMiddleware(authRateLimiter),
  }, async (request, reply) => {
    const { email, resetToken, password } = request.body as { email: string; resetToken: string; password: string };
    await authService.updatePassword(email, resetToken, password);
    return reply.send({ message: ResponseMessages.AUTH.PASSWORD_RESET_SUCCESS });
  });
};
