import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Phone,
  Users,
  Clock,
  Settings,
  LogOut,
  PhoneCall,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: MessageSquare, label: "Chats", path: "/chats" },
  { icon: Phone, label: "Dial", path: "/dial" },
  { icon: Users, label: "Contacts", path: "/contacts" },
  { icon: Clock, label: "History", path: "/history" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

interface SidebarProps {
  user: {
    name: string;
    avatar?: string;
    number: string;
    status: "online" | "busy" | "away" | "offline";
  };
  onLogout: () => void;
}

export function Sidebar({ user, onLogout }: SidebarProps) {
  const location = useLocation();

  return (
    <aside className="flex h-full w-20 flex-col items-center border-r border-border bg-card py-6 lg:w-64">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-2 px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-glow">
          <PhoneCall className="h-5 w-5 text-white" />
        </div>
        <span className="hidden text-xl font-bold text-foreground lg:block">
          Connect
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-2 px-2 lg:px-4 w-full">
        {navItems.map(({ icon: Icon, label, path }) => {
          const isActive = location.pathname === path;
          return (
            <NavLink
              key={path}
              to={path}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-3 transition-all",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-indicator"
                  className="absolute left-0 h-full w-1 rounded-r-full bg-primary"
                />
              )}
              <Icon className="h-5 w-5 flex-shrink-0" />
              <span className="hidden font-medium lg:block">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="mt-auto flex w-full flex-col items-center gap-4 border-t border-border px-4 pt-4">
        <NavLink
          to="/profile"
          className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary w-full"
        >
          <Avatar
            name={user.name}
            src={user.avatar}
            status={user.status}
            size="md"
          />
          <div className="hidden lg:block min-w-0">
            <p className="font-medium text-foreground truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(user.number)}
            </p>
          </div>
        </NavLink>

        <button
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive lg:justify-start"
        >
          <LogOut className="h-5 w-5" />
          <span className="hidden lg:block">Log out</span>
        </button>
      </div>
    </aside>
  );
}

function formatNumber(num: string): string {
  if (num.length !== 10) return num;
  return `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`;
}
