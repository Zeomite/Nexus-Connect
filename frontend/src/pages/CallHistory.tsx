import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Phone, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CallHistoryItem } from "@/components/CallHistoryItem";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCallHistory } from "@/lib/api/hooks";
import type { CallHistoryRecord } from "@/lib/api/types";

export default function CallHistory() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useCallHistory(page, 50);

  const callHistory = data?.history || [];

  // Filter calls based on search and filter type
  const filteredCalls = callHistory.filter((call) => {
    const matchesFilter = filter === "all" || call.status === "missed";
    // Note: In a real app, you'd need participant info to search by name
    // For now, we'll just filter by status
    return matchesFilter;
  });

  // Group calls by date
  const groupedCalls = filteredCalls.reduce((groups, call) => {
    const date = getDateGroup(new Date(call.createdAt));
    if (!groups[date]) groups[date] = [];
    groups[date].push(call);
    return groups;
  }, {} as Record<string, CallHistoryRecord[]>);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-2xl font-semibold text-foreground mb-4">Call History</h1>
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search call history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="missed">Missed</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </motion.div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
        {Object.entries(groupedCalls).map(([date, calls], groupIndex) => (
          <motion.div
            key={date}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * 0.1 }}
          >
            <h2 className="mb-2 text-sm font-medium text-muted-foreground sticky top-0 bg-background py-2">
              {date}
            </h2>
            <div className="space-y-1">
              {calls.map((call, index) => (
                <motion.div
                  key={call.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: groupIndex * 0.1 + index * 0.05 }}
                >
                  <CallHistoryItem
                    id={call.id}
                    name={`Call ${call.participantCount > 2 ? `(${call.participantCount} participants)` : ''}`}
                    number={call.callId}
                    type={mapCallDirection(call.direction, call.status)}
                    mode={call.type}
                    timestamp={new Date(call.createdAt)}
                    duration={call.duration}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        ))}

        {Object.keys(groupedCalls).length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Phone className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium text-foreground">No calls found</h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "Try a different search term" : "Your call history will appear here"}
            </p>
          </div>
        )}

        {/* Load more */}
        {data && data.total > page * 50 && (
          <div className="flex justify-center py-4">
            <button
              onClick={() => setPage(p => p + 1)}
              className="text-primary hover:underline text-sm"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getDateGroup(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This Week";
  if (diffDays < 30) return "This Month";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function mapCallDirection(direction: string, status: string): "incoming" | "outgoing" | "missed" {
  if (status === "missed") return "missed";
  if (status === "declined") return "missed";
  return direction as "incoming" | "outgoing";
}
