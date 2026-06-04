import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { PhoneCall, Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ApiRequestError } from "@/lib/api/client";

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Check for success message from registration
  const registrationSuccess = location.state?.registrationSuccess;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await login({ email, password });
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
    } catch (error) {
      let errorMessage = "An error occurred during login. Please try again.";
      
      if (error instanceof ApiRequestError) {
        switch (error.code) {
          case 'UNAUTHORIZED':
            errorMessage = "Invalid email or password.";
            break;
          case 'FORBIDDEN':
            errorMessage = "Please verify your email before logging in.";
            break;
          case 'RATE_LIMIT_EXCEEDED':
            errorMessage = "Too many login attempts. Please try again later.";
            break;
          default:
            errorMessage = error.message;
        }
      }

      toast({
        variant: "destructive",
        title: "Login failed",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen dark">
      {/* Left Side - Branding */}
      <div className="hidden w-1/2 flex-col justify-between gradient-dark p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-glow">
            <PhoneCall className="h-6 w-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">Connect</span>
        </div>

        <div className="space-y-6">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-5xl font-bold leading-tight text-white"
          >
            Stay connected
            <br />
            <span className="text-gradient">anywhere, anytime.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-lg text-white/70"
          >
            Crystal-clear calls, instant messaging, and seamless video
            conferencing — all in one beautiful app.
          </motion.p>
        </div>

        <div className="flex gap-6">
          {[
            { value: "10M+", label: "Active Users" },
            { value: "99.9%", label: "Uptime" },
            { value: "150+", label: "Countries" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.1 }}
              className="glass rounded-xl p-4"
            >
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-white/60">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8"
        >
          {/* Mobile Logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-glow">
              <PhoneCall className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-foreground">Connect</span>
          </div>

          {/* Success message from registration */}
          {registrationSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg bg-success/10 border border-success/20 p-4 text-success"
            >
              Registration successful! Please verify your email and log in.
            </motion.div>
          )}

          <div>
            <h2 className="text-3xl font-bold text-foreground">Welcome back</h2>
            <p className="mt-2 text-muted-foreground">
              Sign in to continue to your account
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 pl-10"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-10 pr-10"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="gradient"
              size="xl"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
