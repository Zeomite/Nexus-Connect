import { cn } from "@/lib/utils";
import { StatusIndicator } from "./StatusIndicator";

type Status = "online" | "busy" | "away" | "offline";

interface AvatarProps {
  src?: string;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  status?: Status;
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
};

const statusPositions = {
  sm: "-bottom-0 -right-0",
  md: "-bottom-0.5 -right-0.5",
  lg: "-bottom-0.5 -right-0.5",
  xl: "-bottom-1 -right-1",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getAvatarColor(name: string): string {
  const colors = [
    "from-primary to-accent",
    "from-success to-primary",
    "from-warning to-destructive",
    "from-primary to-success",
    "from-accent to-warning",
  ];
  const index = name.charCodeAt(0) % colors.length;
  return colors[index];
}

export function Avatar({ src, name, size = "md", status, className }: AvatarProps) {
  return (
    <div className={cn("relative inline-flex", className)}>
      {src ? (
        <img
          src={src}
          alt={name}
          className={cn(
            "rounded-full object-cover ring-2 ring-background",
            sizeClasses[size]
          )}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white",
            sizeClasses[size],
            getAvatarColor(name)
          )}
        >
          {getInitials(name)}
        </div>
      )}
      {status && (
        <StatusIndicator
          status={status}
          size={size === "xl" ? "lg" : size === "lg" ? "md" : "sm"}
          className={cn("absolute", statusPositions[size])}
        />
      )}
    </div>
  );
}
