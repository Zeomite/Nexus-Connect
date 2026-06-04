import { cn } from "@/lib/utils";

type Status = "online" | "busy" | "away" | "offline";

interface StatusIndicatorProps {
  status: Status;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const statusColors: Record<Status, string> = {
  online: "status-online",
  busy: "status-busy",
  away: "status-away",
  offline: "bg-muted-foreground",
};

const sizeClasses = {
  sm: "h-2 w-2",
  md: "h-3 w-3",
  lg: "h-4 w-4",
};

export function StatusIndicator({ status, size = "md", className }: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        "rounded-full ring-2 ring-background",
        statusColors[status],
        sizeClasses[size],
        className
      )}
    />
  );
}
