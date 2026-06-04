import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ProtectedRoute, PublicOnlyRoute } from "@/components/ProtectedRoute";
import MainLayout from "./layouts/MainLayout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Chats from "./pages/Chats";
import Dial from "./pages/Dial";
import Contacts from "./pages/Contacts";
import CallHistory from "./pages/CallHistory";
import Call from "./pages/Call";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <NotificationProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<Landing />} />
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <Login />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <PublicOnlyRoute>
                    <Register />
                  </PublicOnlyRoute>
                }
              />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Protected routes with layout */}
              <Route
                element={
                  <ProtectedRoute>
                    <MainLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/chats" element={<Chats />} />
                <Route path="/dial" element={<Dial />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/history" element={<CallHistory />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
              </Route>

              {/* Call screen (fullscreen, protected) */}
              <Route
                path="/call"
                element={
                  <ProtectedRoute>
                    <Call />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/call/:callId"
                element={
                  <ProtectedRoute>
                    <Call />
                  </ProtectedRoute>
                }
              />

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </NotificationProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
