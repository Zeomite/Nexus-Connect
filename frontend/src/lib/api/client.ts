// API Client with authentication interceptors

import { API_CONFIG, STORAGE_KEYS } from './config';
import type { ApiError, RefreshTokenResponse } from './types';

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: RequestMethod;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | number | undefined>;
  requiresAuth?: boolean;
}

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

// Token management
export const tokenManager = {
  getAccessToken: (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.accessToken);
  },

  getRefreshToken: (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.refreshToken);
  },

  setTokens: (accessToken: string, refreshToken: string): void => {
    localStorage.setItem(STORAGE_KEYS.accessToken, accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, refreshToken);
  },

  clearTokens: (): void => {
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    localStorage.removeItem(STORAGE_KEYS.user);
  },

  getStoredUser: () => {
    const userStr = localStorage.getItem(STORAGE_KEYS.user);
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  },

  setStoredUser: (user: unknown): void => {
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  },
};

// Refresh token
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenManager.getRefreshToken();
  if (!refreshToken) {
    tokenManager.clearTokens();
    return null;
  }

  try {
    const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.refresh}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      tokenManager.clearTokens();
      window.location.href = '/login';
      return null;
    }

    const data: RefreshTokenResponse = await response.json();
    tokenManager.setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    tokenManager.clearTokens();
    window.location.href = '/login';
    return null;
  }
}

// Ensure single refresh at a time
async function ensureValidToken(): Promise<string | null> {
  const accessToken = tokenManager.getAccessToken();
  if (!accessToken) return null;

  // If already refreshing, wait for that to complete
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  return accessToken;
}

// Build URL with query params
function buildUrl(endpoint: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(`${API_CONFIG.baseUrl}${endpoint}`);
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }
  
  return url.toString();
}

// Main API request function
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    params,
    requiresAuth = true,
  } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (requiresAuth) {
    const token = await ensureValidToken();
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }
  }

  const url = buildUrl(endpoint, params);

  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
  };

  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  let response = await fetch(url, fetchOptions);

  // Handle token expiration
  if (response.status === 401 && requiresAuth) {
    // Try to refresh the token
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshAccessToken();
    }

    const newToken = await refreshPromise;
    isRefreshing = false;
    refreshPromise = null;

    if (newToken) {
      requestHeaders['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(url, {
        ...fetchOptions,
        headers: requestHeaders,
      });
    } else {
      throw new ApiRequestError('Session expired. Please login again.', 401, 'UNAUTHORIZED');
    }
  }

  if (!response.ok) {
    let errorData: ApiError | null = null;
    try {
      errorData = await response.json();
    } catch {
      // Response might not be JSON
    }

    throw new ApiRequestError(
      errorData?.error?.message || `Request failed with status ${response.status}`,
      response.status,
      errorData?.error?.code || 'UNKNOWN_ERROR',
      errorData?.error?.details
    );
  }

  // Handle empty responses
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    return {} as T;
  }

  return response.json();
}

// Custom error class for API errors
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

// Convenience methods
export const api = {
  get: <T>(endpoint: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'POST', body }),

  put: <T>(endpoint: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'PUT', body }),

  patch: <T>(endpoint: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'PATCH', body }),

  delete: <T>(endpoint: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
};
