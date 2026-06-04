import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// This page now redirects to the forgot-password flow which handles everything
// Kept for backwards compatibility with any existing links
export default function ResetPassword() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to the forgot password page which now handles the full flow
    navigate("/forgot-password", { replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background dark">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
