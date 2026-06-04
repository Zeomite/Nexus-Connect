// Base application error
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

// 400 Bad Request
export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request', details?: Record<string, unknown>) {
    super(message, 400, 'BAD_REQUEST', true, details);
  }
}

// 401 Unauthorized
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED', true);
  }
}

// 403 Forbidden
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN', true);
  }
}

// 404 Not Found
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND', true);
  }
}

// 409 Conflict
export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(message, 409, 'CONFLICT', true);
  }
}

// 422 Unprocessable Entity
export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', details?: Record<string, unknown>) {
    super(message, 422, 'VALIDATION_ERROR', true, details);
  }
}

// 429 Too Many Requests
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter: number = 60) {
    super('Too many requests', 429, 'RATE_LIMIT_EXCEEDED', true, { retryAfter });
    this.retryAfter = retryAfter;
  }
}

// 500 Internal Server Error
export class InternalError extends AppError {
  constructor(message: string = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR', false);
  }
}

// 503 Service Unavailable
export class ServiceUnavailableError extends AppError {
  constructor(service: string = 'Service') {
    super(`${service} is temporarily unavailable`, 503, 'SERVICE_UNAVAILABLE', true);
  }
}

// Domain-specific errors
export class DuplicateEmailError extends AppError {
  constructor() {
    super('Email already registered', 409, 'DUPLICATE_EMAIL', true);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super('Invalid email or password', 401, 'INVALID_CREDENTIALS', true);
  }
}

export class EmailNotVerifiedError extends AppError {
  constructor() {
    super('Email not verified', 403, 'EMAIL_NOT_VERIFIED', true);
  }
}

export class TokenExpiredError extends AppError {
  constructor() {
    super('Token has expired', 401, 'TOKEN_EXPIRED', true);
  }
}

export class InvalidTokenError extends AppError {
  constructor() {
    super('Invalid token', 401, 'INVALID_TOKEN', true);
  }
}

export class CallInProgressError extends AppError {
  constructor() {
    super('User already in a call', 409, 'CALL_IN_PROGRESS', true);
  }
}

export class CallNotFoundError extends AppError {
  constructor() {
    super('Call not found', 404, 'CALL_NOT_FOUND', true);
  }
}

export class NotGroupMemberError extends AppError {
  constructor() {
    super('User is not a member of this group', 403, 'NOT_GROUP_MEMBER', true);
  }
}

export class InsufficientPermissionsError extends AppError {
  constructor(action: string = 'perform this action') {
    super(`Insufficient permissions to ${action}`, 403, 'INSUFFICIENT_PERMISSIONS', true);
  }
}
