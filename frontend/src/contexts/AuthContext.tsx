import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/lib/api/auth';
import { tokenManager } from '@/lib/api/client';
import type { User, LoginRequest, RegisterRequest, UserStatus } from '@/lib/api/types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<{ userId: string; uniqueNumber: string }>;
  logout: () => void;
  updateProfile: (data: { displayName?: string; profilePictureUrl?: string }) => Promise<void>;
  updateStatus: (status: UserStatus) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(() => authApi.getStoredUser());
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  const isAuthenticated = !!user && !!tokenManager.getAccessToken();

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = tokenManager.getAccessToken();
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
      } catch {
        // Token invalid, clear everything
        tokenManager.clearTokens();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback(async (data: LoginRequest) => {
    const response = await authApi.login(data);
    setUser(response.user);
    navigate('/chats');
  }, [navigate]);

  const register = useCallback(async (data: RegisterRequest) => {
    const response = await authApi.register(data);
    return {
      userId: response.userId,
      uniqueNumber: response.uniqueNumber,
    };
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setUser(null);
    navigate('/login');
  }, [navigate]);

  const updateProfile = useCallback(async (data: { displayName?: string; profilePictureUrl?: string }) => {
    const updatedUser = await authApi.updateProfile(data);
    setUser((prev) => prev ? { ...prev, ...updatedUser } : null);
  }, []);

  const updateStatus = useCallback(async (status: UserStatus) => {
    await authApi.updateStatus(status);
    setUser((prev) => prev ? { ...prev, status } : null);
  }, []);

  const refreshUser = useCallback(async () => {
    const currentUser = await authApi.getCurrentUser();
    setUser(currentUser);
  }, []);

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated,
    login,
    register,
    logout,
    updateProfile,
    updateStatus,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
