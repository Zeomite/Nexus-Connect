import { motion } from "framer-motion";
import { Check, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  id: string;
  content: string;
  timestamp: Date;
  isSent: boolean;
  status?: "sent" | "delivered" | "read";
  showTimestamp?: boolean;
}

export function ChatMessage({
  content,
  timestamp,
  isSent,
  status = "sent",
  showTimestamp = true,
}: ChatMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={cn("flex w-full", isSent ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2.5",
          isSent
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-secondary text-secondary-foreground"
        )}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        {showTimestamp && (
          <div
            className={cn(
              "mt-1 flex items-center justify-end gap-1 text-[10px]",
              isSent ? "text-primary-foreground/70" : "text-muted-foreground"
            )}
          >
            <span>{formatTime(timestamp)}</span>
            {isSent && (
              <span className="ml-0.5">
                {status === "read" ? (
                  <CheckCheck className="h-3.5 w-3.5 text-primary-foreground" />
                ) : status === "delivered" ? (
                  <CheckCheck className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
