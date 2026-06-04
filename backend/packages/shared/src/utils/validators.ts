import { z, ZodError, ZodSchema } from 'zod';
import { ValidationError } from './errors';

// Validate input against schema
export const validate = <T>(schema: ZodSchema<T>, data: unknown): T => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.errors.reduce(
        (acc, err) => {
          const path = err.path.join('.');
          acc[path] = err.message;
          return acc;
        },
        {} as Record<string, string>
      );
      throw new ValidationError('Validation failed', details);
    }
    throw error;
  }
};

// Safe validate (returns result object)
export const safeValidate = <T>(
  schema: ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: ValidationError } => {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.errors.reduce(
        (acc, err) => {
          const path = err.path.join('.');
          acc[path] = err.message;
          return acc;
        },
        {} as Record<string, string>
      );
      return { success: false, error: new ValidationError('Validation failed', details) };
    }
    throw error;
  }
};

// Common validation schemas
export const UuidSchema = z.string().uuid();

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;

export const SortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type SortInput = z.infer<typeof SortSchema>;

export const DateRangeSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type DateRangeInput = z.infer<typeof DateRangeSchema>;

// Email validation regex (more strict than zod default)
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 254;
};

// Password strength validation
export const PasswordStrengthSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((password) => /[A-Z]/.test(password), 'Password must contain at least one uppercase letter')
  .refine((password) => /[a-z]/.test(password), 'Password must contain at least one lowercase letter')
  .refine((password) => /[0-9]/.test(password), 'Password must contain at least one number')
  .refine(
    (password) => /[!@#$%^&*(),.?":{}|<>]/.test(password),
    'Password must contain at least one special character'
  );

// Sanitize string (prevent XSS)
export const sanitizeString = (input: string): string => {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

// Check if string contains only alphanumeric and allowed characters
export const isAlphanumeric = (str: string, allowedChars: string = ''): boolean => {
  const regex = new RegExp(`^[a-zA-Z0-9${allowedChars}]+$`);
  return regex.test(str);
};
