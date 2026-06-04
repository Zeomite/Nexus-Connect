import { motion } from "framer-motion";
import { Phone, Video, MessageSquare } from "lucide-react";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Status = "online" | "busy" | "away" | "offline";

interface ContactItemProps {
  id: string;
  name: string;
  number: string;
  avatar?: string;
  status: Status;
  statusText?: string;
  onCall?: (isVideo: boolean) => void;
  onMessage?: () => void;
  className?: string;
}

export function ContactItem({
  name,
  number,
  avatar,
  status,
  statusText,
  onCall,
  onMessage,
  className,
}: ContactItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-secondary/50",
        className
      )}
    >
      <Avatar name={name} src={avatar} status={status} size="lg" />
      
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-foreground truncate">{name}</h3>
        <p className="text-sm text-muted-foreground truncate">
          {statusText || formatNumber(number)}
        </p>
      </div>

      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          onClick={onMessage}
          className="text-muted-foreground hover:text-primary"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCall?.(false)}
          className="text-muted-foreground hover:text-success"
        >
          <Phone className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCall?.(true)}
          className="text-muted-foreground hover:text-primary"
        >
          <Video className="h-5 w-5" />
        </Button>
      </div>
    </motion.div>
  );
}

function formatNumber(num: string): string {
  if (num.length !== 10) return num;
  return `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`;
}
