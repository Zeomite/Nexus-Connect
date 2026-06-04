import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PhoneCall, Mail, Lock, User, Eye, EyeOff, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ApiRequestError } from "@/lib/api/client";

const passwordRequirements = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "One number", test: (p: string) => /\d/.test(p) },
  { label: "One special character", test: (p: string) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await register({ email, password, displayName });
      
      toast({
        title: "Registration successful!",
        description: "Please check your email to verify your account.",
      });

      // Navigate to verify email page with context
      navigate("/verify-email", { 
        state: { 
          email,
          uniqueNumber: result.uniqueNumber,
        } 
      });
    } catch (error) {
      let errorMessage = "An error occurred during registration. Please try again.";
      
      if (error instanceof ApiRequestError) {
        switch (error.code) {
          case 'CONFLICT':
            errorMessage = "This email is already registered. Please log in or use a different email.";
            break;
          case 'VALIDATION_ERROR':
            errorMessage = "Please check your input and try again.";
            break;
          case 'RATE_LIMIT_EXCEEDED':
            errorMessage = "Too many registration attempts. Please try again later.";
            break;
          default:
            errorMessage = error.message;
        }
      }

      toast({
        variant: "destructive",
        title: "Registration failed",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isPasswordValid = passwordRequirements.every((req) => req.test(password));

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
            Join millions of
            <br />
            <span className="text-gradient">connected users.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-lg text-white/70"
          >
            Get your unique 10-digit number and start connecting with friends,
            family, and colleagues instantly.
          </motion.p>
        </div>

        <div className="space-y-4">
          {[
            "Free HD video & voice calls",
            "End-to-end encrypted messaging",
            "Group conferences up to 100 people",
            "Screen sharing & file transfer",
          ].map((feature, i) => (
            <motion.div
              key={feature}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.1 }}
              className="flex items-center gap-3"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
                <Check className="h-4 w-4 text-primary" />
              </div>
              <span className="text-white/80">{feature}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Right Side - Register Form */}
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

          <div>
            <h2 className="text-3xl font-bold text-foreground">Create account</h2>
            <p className="mt-2 text-muted-foreground">
              Sign up to get your personal number
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Display name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="h-12 pl-10"
                  required
                  autoComplete="name"
                />
              </div>
            </div>

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
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-10 pr-10"
                  required
                  autoComplete="new-password"
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
              {/* Password Requirements */}
              {password && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="mt-3 space-y-2"
                >
                  {passwordRequirements.map((req) => (
                    <div
                      key={req.label}
                      className="flex items-center gap-2 text-sm"
                    >
                      <div
                        className={`flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                          req.test(password)
                            ? "bg-success text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </div>
                      <span
                        className={
                          req.test(password)
                            ? "text-success"
                            : "text-muted-foreground"
                        }
                      >
                        {req.label}
                      </span>
                    </div>
                  ))}
                </motion.div>
              )}
            </div>

            <Button
              type="submit"
              variant="gradient"
              size="xl"
              className="w-full"
              disabled={isLoading || !isPasswordValid || !displayName.trim()}
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  Create account
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            By signing up, you agree to our{" "}
            <a href="#" className="text-primary hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-primary hover:underline">
              Privacy Policy
            </a>
          </p>

          <p className="text-center text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
