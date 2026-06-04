import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { IncomingCallModal } from "@/components/IncomingCallModal";
import { useAuth } from "@/contexts/AuthContext";
import { useChatWebSocket } from "@/hooks/useChatWebSocket";
import { useIncomingCall } from "@/hooks/useIncomingCall";

export default function MainLayout() {
  const { user, logout } = useAuth();

  // Initialize chat WebSocket connection
  useChatWebSocket();

  // Initialize incoming call handler with notification WebSocket
  const {
    incomingCall,
    acceptCall,
    declineCall,
    dismissCall,
    wsConnected,
  } = useIncomingCall();

  const currentUser = {
    name: user?.displayName || "User",
    number: user?.uniqueNumber || "",
    status: (user?.status === 'do_not_disturb' ? 'busy' : user?.status) as "online" | "busy" | "away" | "offline" || "online",
    avatar: user?.profilePictureUrl,
  };

  return (
    <div className="flex h-screen dark">
      <Sidebar user={currentUser} onLogout={logout} />
      <main className="flex-1 overflow-hidden bg-background">
        <Outlet />
      </main>

      {/* Incoming Call Modal - shown globally for all protected routes */}
      <IncomingCallModal
        incomingCall={incomingCall}
        onAccept={acceptCall}
        onDecline={declineCall}
        onDismiss={dismissCall}
      />
    </div>
  );
}
