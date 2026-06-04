import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PhoneCall, Mail, ArrowLeft, RefreshCw, Lock, Eye, EyeOff, Check, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { authApi } from "@/lib/api/auth";
import { useToast } from "@/hooks/use-toast";
import { ApiRequestError } from "@/lib/api/client";

type Step = "email" | "code" | "password" | "success";

const passwordRequirements = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "One number", test: (p: string) => /\d/.test(p) },
  { label: "One special character", test: (p: string) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const isPasswordValid = passwordRequirements.every((req) => req.test(password));
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  // Step 1: Send code to email
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await authApi.forgotPassword({ email });
      setStep("code");
      setResendCooldown(60);
      toast({
        title: "Code sent!",
        description: "Check your email for the verification code.",
      });
    } catch {
      // Always show success to prevent email enumeration
      setStep("code");
      setResendCooldown(60);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);
    try {
      await authApi.forgotPassword({ email });
      toast({
        title: "Code sent!",
        description: "A new verification code has been sent to your email.",
      });
      setResendCooldown(60);
    } catch {
      // Silent fail to prevent enumeration
      setResendCooldown(60);
    } finally {
      setIsResending(false);
    }
  };

  // Step 2: Verify code and get reset token
  const handleVerifyCode = async () => {
    if (code.length !== 6) return;
    setIsLoading(true);

    try {
      const response = await authApi.verifyResetCode({ email, code });
      setResetToken(response.resetToken);
      setStep("password");
    } catch (error) {
      let errorMessage = "Invalid or expired code. Please try again.";
      
      if (error instanceof ApiRequestError) {
        if (error.status === 400 || error.status === 404) {
          errorMessage = "Invalid code. Please check and try again.";
        } else if (error.status === 410) {
          errorMessage = "This code has expired. Please request a new one.";
        }
      }

      toast({
        variant: "destructive",
        title: "Verification failed",
        description: errorMessage,
      });
      setCode("");
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Update password
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!passwordsMatch) {
      toast({
        variant: "destructive",
        title: "Passwords don't match",
        description: "Please make sure both passwords are the same.",
      });
      return;
    }

    setIsLoading(true);

    try {
      await authApi.updatePassword({ email, resetToken, password });
      setStep("success");
    } catch (error) {
      let errorMessage = "Failed to reset password. Please try again.";
      
      if (error instanceof ApiRequestError) {
        if (error.status === 400 || error.status === 401) {
          errorMessage = "Session expired. Please start over.";
          setStep("email");
          setCode("");
          setResetToken("");
        }
      }

      toast({
        variant: "destructive",
        title: "Reset failed",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Success state
  if (step === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 dark">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.2 }}
            className="mx-auto flex h-20 w-20 items-center justify-center rounded-full gradient-call shadow-glow"
          >
            <CheckCircle className="h-10 w-10 text-white" />
          </motion.div>

          <div>
            <h1 className="text-3xl font-bold text-foreground">Password reset!</h1>
            <p className="mt-2 text-muted-foreground">
              Your password has been successfully reset. You can now log in with your new password.
            </p>
          </div>

          <Button
            variant="gradient"
            size="xl"
            className="w-full"
            onClick={() => navigate("/login")}
          >
            Continue to login
          </Button>
        </motion.div>
      </div>
    );
  }

  // Password step
  if (step === "password") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 dark">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-glow">
              <PhoneCall className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-foreground">Connect</span>
          </div>

          <div>
            <h2 className="text-3xl font-bold text-foreground">Create new password</h2>
            <p className="mt-2 text-muted-foreground">
              Enter a new password for your account
            </p>
          </div>

          <form onSubmit={handleUpdatePassword} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
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
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {password && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="mt-3 space-y-2"
                >
                  {passwordRequirements.map((req) => (
                    <div key={req.label} className="flex items-center gap-2 text-sm">
                      <div
                        className={`flex h-4 w-4 items-center justify-center rounded-full transition-colors ${
                          req.test(password) ? "bg-success text-white" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </div>
                      <span className={req.test(password) ? "text-success" : "text-muted-foreground"}>
                        {req.label}
                      </span>
                    </div>
                  ))}
                </motion.div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-12 pl-10 pr-10"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {confirmPassword && (
                <p className={`text-sm ${passwordsMatch ? "text-success" : "text-destructive"}`}>
                  {passwordsMatch ? "Passwords match" : "Passwords don't match"}
                </p>
              )}
            </div>

            <Button
              type="submit"
              variant="gradient"
              size="xl"
              className="w-full"
              disabled={isLoading || !isPasswordValid || !passwordsMatch}
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Reset password"
              )}
            </Button>
          </form>

          <button
            onClick={() => {
              setStep("code");
              setPassword("");
              setConfirmPassword("");
            }}
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to code entry
          </button>
        </motion.div>
      </div>
    );
  }

  // Code entry step
  if (step === "code") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 dark">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8 text-center"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-8 w-8 text-primary" />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-foreground">Enter verification code</h1>
            <p className="mt-2 text-muted-foreground">
              We sent a code to
            </p>
            <p className="font-medium text-foreground">{email}</p>
          </div>

          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button
            variant="gradient"
            size="xl"
            className="w-full"
            onClick={handleVerifyCode}
            disabled={code.length !== 6 || isLoading}
          >
            {isLoading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              "Verify code"
            )}
          </Button>

          <div className="text-muted-foreground">
            Didn't receive the code?{" "}
            {resendCooldown > 0 ? (
              <span className="text-primary">Resend in {resendCooldown}s</span>
            ) : (
              <button
                onClick={handleResendCode}
                disabled={isResending}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50"
              >
                {isResending && <RefreshCw className="h-4 w-4 animate-spin" />}
                Resend code
              </button>
            )}
          </div>

          <button
            onClick={() => {
              setStep("email");
              setCode("");
            }}
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Use different email
          </button>
        </motion.div>
      </div>
    );
  }

  // Email entry step (default)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8 dark">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md space-y-8"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-glow">
            <PhoneCall className="h-6 w-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-foreground">Connect</span>
        </div>

        <div>
          <h2 className="text-3xl font-bold text-foreground">Forgot password?</h2>
          <p className="mt-2 text-muted-foreground">
            No worries! Enter your email and we'll send you a verification code.
          </p>
        </div>

        <form onSubmit={handleSendCode} className="space-y-6">
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

          <Button
            type="submit"
            variant="gradient"
            size="xl"
            className="w-full"
            disabled={isLoading || !email}
          >
            {isLoading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              "Send code"
            )}
          </Button>
        </form>

        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>
      </motion.div>
    </div>
  );
}
