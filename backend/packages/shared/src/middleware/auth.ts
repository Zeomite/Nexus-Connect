import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../utils/crypto';
import { UnauthorizedError, TokenExpiredError, InvalidTokenError } from '../utils/errors';
import { TokenPayload } from '../types/user';

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

export interface AuthPluginOptions {
  accessTokenSecret: string;
  excludePaths?: string[];
  excludePatterns?: RegExp[];
}

// Auth plugin for Fastify
export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const { accessTokenSecret, excludePaths = [], excludePatterns = [] } = options;

  // Add authentication hook
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip authentication for excluded paths
    if (excludePaths.includes(request.url)) {
      return;
    }

    // Skip authentication for excluded patterns
    for (const pattern of excludePatterns) {
      if (pattern.test(request.url)) {
        return;
      }
    }

    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw new UnauthorizedError('Missing authorization header');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedError('Invalid authorization header format');
    }

    const token = parts[1];

    try {
      const payload = verifyAccessToken(token, accessTokenSecret);
      request.user = payload;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new TokenExpiredError();
      }
      throw new InvalidTokenError();
    }
  });
};

export default fp(authPlugin, {
  name: 'auth-plugin',
  fastify: '4.x',
});

// Decorator for route-level authentication
export const authenticate = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  if (!request.user) {
    throw new UnauthorizedError('Authentication required');
  }
};

// Get current user from request
export const getCurrentUser = (request: FastifyRequest): TokenPayload => {
  if (!request.user) {
    throw new UnauthorizedError('User not authenticated');
  }
  return request.user;
};

// WebSocket authentication helper
export const authenticateWebSocket = (
  token: string,
  accessTokenSecret: string
): TokenPayload => {
  if (!token) {
    throw new UnauthorizedError('Missing authentication token');
  }

  try {
    return verifyAccessToken(token, accessTokenSecret);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new TokenExpiredError();
    }
    throw new InvalidTokenError();
  }
};

// Service-to-service authentication
export interface ServiceAuthConfig {
  serviceSecret: string;
  serviceName: string;
}

export const authenticateService = (
  request: FastifyRequest,
  config: ServiceAuthConfig
): boolean => {
  const serviceHeader = request.headers['x-service-auth'];
  const serviceName = request.headers['x-service-name'];

  if (!serviceHeader || !serviceName) {
    return false;
  }

  return serviceHeader === config.serviceSecret && serviceName === config.serviceName;
};

// Permission check helpers
export const requireUserId = (request: FastifyRequest, userId: string): void => {
  const currentUser = getCurrentUser(request);
  if (currentUser.userId !== userId) {
    throw new UnauthorizedError('Access denied');
  }
};
