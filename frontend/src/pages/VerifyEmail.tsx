import { useState, useEffect } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, RefreshCw, CheckCircle, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { authApi } from "@/lib/api/auth";
import { useToast } from "@/hooks/use-toast";
import { ApiRequestError } from "@/lib/api/client";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  // Get email from state or URL params
  const email = location.state?.email || searchParams.get("email") || "";
  const uniqueNumber = location.state?.uniqueNumber;
  
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Redirect if no email
  useEffect(() => {
    if (!email) {
      navigate("/register");
    }
  }, [email, navigate]);

  const handleVerify = async () => {
    if (code.length !== 6 || !email) return;
    
    setIsVerifying(true);
    setVerificationError(null);

    try {
      await authApi.verifyEmail({ email, code });
      setIsVerified(true);
    } catch (error) {
      let errorMessage = "Verification failed. Please try again.";
      
      if (error instanceof ApiRequestError) {
        if (error.status === 400) {
          errorMessage = "Invalid code. Please check and try again.";
        } else if (error.status === 404) {
          errorMessage = "This verification code is invalid or has expired.";
        } else if (error.status === 410) {
          errorMessage = "This code has expired. Please request a new one.";
        }
      }
      
      setVerificationError(errorMessage);
      setCode("");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    
    setIsResending(true);
    
    try {
      await authApi.resendVerification(email);
      toast({
        title: "Code sent!",
        description: "A new verification code has been sent to your email.",
      });
      setResendCooldown(60);
      setVerificationError(null);
      setCode("");
    } catch (error) {
      let errorMessage = "Could not send verification email. Please try again.";
      
      if (error instanceof ApiRequestError) {
        if (error.status === 429) {
          errorMessage = "Too many requests. Please wait before trying again.";
        }
      }
      
      toast({
        variant: "destructive",
        title: "Failed to resend",
        description: errorMessage,
      });
    } finally {
      setIsResending(false);
    }
  };

  const handleContinue = () => {
    navigate("/login", { state: { registrationSuccess: true } });
  };

  // No email provided
  if (!email) {
    return null;
  }

  // Error state
  if (verificationError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 dark">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.2 }}
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-destructive/10"
          >
            <XCircle className="h-12 w-12 text-destructive" />
          </motion.div>

          <div>
            <h1 className="text-3xl font-bold text-foreground">Verification failed</h1>
            <p className="mt-2 text-muted-foreground">{verificationError}</p>
          </div>

          <div className="space-y-3">
            <Button
              variant="gradient"
              size="xl"
              className="w-full"
              onClick={() => {
                setVerificationError(null);
                setCode("");
              }}
            >
              Try again
            </Button>
            <Button
              variant="outline"
              size="xl"
              className="w-full"
              onClick={handleResend}
              disabled={isResending || resendCooldown > 0}
            >
              {isResending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend verification code"}
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Success state
  if (isVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 dark">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-8 text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", delay: 0.2 }}
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-full gradient-call shadow-glow"
          >
            <CheckCircle className="h-12 w-12 text-white" />
          </motion.div>

          <div>
            <h1 className="text-3xl font-bold text-foreground">You're all set!</h1>
            <p className="mt-2 text-muted-foreground">
              Your account has been verified successfully
            </p>
          </div>

          {uniqueNumber && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="rounded-2xl bg-card p-6 border border-border"
            >
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                Your personal number
              </div>
              <p className="mt-3 text-4xl font-bold tracking-wider text-gradient">
                {formatNumber(uniqueNumber)}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Share this number with friends to connect
              </p>
            </motion.div>
          )}

          <Button
            variant="gradient"
            size="xl"
            className="w-full"
            onClick={handleContinue}
          >
            Continue to login
          </Button>
        </motion.div>
      </div>
    );
  }

  // Default: Enter code state
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
          <h1 className="text-3xl font-bold text-foreground">Check your email</h1>
          <p className="mt-2 text-muted-foreground">
            We sent a verification code to
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
          onClick={handleVerify}
          disabled={code.length !== 6 || isVerifying}
        >
          {isVerifying ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            "Verify email"
          )}
        </Button>

        <div className="text-muted-foreground">
          Didn't receive the code?{" "}
          {resendCooldown > 0 ? (
            <span className="text-primary">
              Resend in {resendCooldown}s
            </span>
          ) : (
            <button
              onClick={handleResend}
              disabled={isResending}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50"
            >
              {isResending && <RefreshCw className="h-4 w-4 animate-spin" />}
              Resend code
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function formatNumber(num: string): string {
  if (num.length !== 10) return num;
  return `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`;
}
