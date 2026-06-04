// Auth Service API calls

import { api, tokenManager } from './client';
import { API_CONFIG } from './config';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  VerifyEmailRequest,
  ForgotPasswordRequest,
  VerifyResetCodeRequest,
  VerifyResetCodeResponse,
  UpdatePasswordRequest,
  User,
  UpdateProfileRequest,
  UpdateStatusRequest,
  UserStatus,
} from './types';

export const authApi = {
  /**
   * Register a new user
   */
  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    return api.post<RegisterResponse>(
      API_CONFIG.endpoints.register,
      data,
      { requiresAuth: false }
    );
  },

  /**
   * Login user and store tokens
   */
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await api.post<LoginResponse>(
      API_CONFIG.endpoints.login,
      data,
      { requiresAuth: false }
    );

    // Store tokens and user data
    tokenManager.setTokens(response.accessToken, response.refreshToken);
    tokenManager.setStoredUser(response.user);

    return response;
  },

  /**
   * Logout user and clear tokens
   */
  logout: (): void => {
    tokenManager.clearTokens();
  },

  /**
   * Verify email with code
   */
  verifyEmail: async (data: VerifyEmailRequest): Promise<{ message: string }> => {
    return api.post<{ message: string }>(
      API_CONFIG.endpoints.verifyEmail,
      data,
      { requiresAuth: false }
    );
  },

  /**
   * Resend verification email
   */
  resendVerification: async (email: string): Promise<{ message: string }> => {
    return api.post<{ message: string }>(
      API_CONFIG.endpoints.resendVerification,
      { email },
      { requiresAuth: false }
    );
  },

  /**
   * Request password reset code (Step 1)
   */
  forgotPassword: async (data: ForgotPasswordRequest): Promise<{ message: string }> => {
    return api.post<{ message: string }>(
      API_CONFIG.endpoints.forgotPassword,
      data,
      { requiresAuth: false }
    );
  },

  /**
   * Verify reset code and get reset token (Step 2)
   */
  verifyResetCode: async (data: VerifyResetCodeRequest): Promise<VerifyResetCodeResponse> => {
    return api.post<VerifyResetCodeResponse>(
      API_CONFIG.endpoints.verifyResetCode,
      data,
      { requiresAuth: false }
    );
  },

  /**
   * Update password with reset token (Step 3)
   */
  updatePassword: async (data: UpdatePasswordRequest): Promise<{ message: string }> => {
    return api.post<{ message: string }>(
      API_CONFIG.endpoints.updatePassword,
      data,
      { requiresAuth: false }
    );
  },

  /**
   * Get current user profile
   */
  getCurrentUser: async (): Promise<User> => {
    const user = await api.get<User>(API_CONFIG.endpoints.me);
    tokenManager.setStoredUser(user);
    return user;
  },

  /**
   * Update user profile
   */
  updateProfile: async (data: UpdateProfileRequest): Promise<User> => {
    const user = await api.patch<User>(API_CONFIG.endpoints.me, data);
    tokenManager.setStoredUser(user);
    return user;
  },

  /**
   * Update user status
   */
  updateStatus: async (status: UserStatus): Promise<{ status: UserStatus }> => {
    const data: UpdateStatusRequest = { status };
    return api.patch<{ status: UserStatus }>(API_CONFIG.endpoints.updateStatus, data);
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated: (): boolean => {
    return !!tokenManager.getAccessToken();
  },

  /**
   * Get stored user (from localStorage)
   */
  getStoredUser: (): User | null => {
    return tokenManager.getStoredUser();
  },
};
