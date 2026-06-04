import { motion } from "framer-motion";
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from "lucide-react";
import { Avatar } from "./Avatar";
import { cn } from "@/lib/utils";

type CallType = "incoming" | "outgoing" | "missed";
type CallMode = "audio" | "video";

interface CallHistoryItemProps {
  id: string;
  name: string;
  number: string;
  avatar?: string;
  type: CallType;
  mode: CallMode;
  timestamp: Date;
  duration?: number; // in seconds
  onClick?: () => void;
}

const callTypeIcons: Record<CallType, typeof Phone> = {
  incoming: PhoneIncoming,
  outgoing: PhoneOutgoing,
  missed: PhoneMissed,
};

const callTypeColors: Record<CallType, string> = {
  incoming: "text-success",
  outgoing: "text-primary",
  missed: "text-destructive",
};

export function CallHistoryItem({
  name,
  number,
  avatar,
  type,
  mode,
  timestamp,
  duration,
  onClick,
}: CallHistoryItemProps) {
  const Icon = callTypeIcons[type];

  return (
    <motion.button
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-xl p-3 text-left transition-colors hover:bg-secondary/50"
    >
      <Avatar name={name} src={avatar} size="md" />

      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-foreground truncate">{name}</h3>
        <div className="flex items-center gap-2 text-sm">
          <Icon className={cn("h-3.5 w-3.5", callTypeColors[type])} />
          <span className="text-muted-foreground">
            {mode === "video" && <Video className="mr-1 inline h-3 w-3" />}
            {formatRelativeTime(timestamp)}
          </span>
        </div>
      </div>

      <div className="text-right">
        <p className="text-sm text-muted-foreground">
          {duration ? formatDuration(duration) : type === "missed" ? "Missed" : ""}
        </p>
        <p className="text-xs text-muted-foreground">{formatNumber(number)}</p>
      </div>
    </motion.button>
  );
}

function formatNumber(num: string): string {
  if (num.length !== 10) return num;
  return `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}
