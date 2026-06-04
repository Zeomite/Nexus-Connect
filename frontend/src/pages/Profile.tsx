import { useState } from "react";
import { motion } from "framer-motion";
import { Camera, Edit2, Check, X, Copy, QrCode, Share2, Loader2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { UserStatus } from "@/lib/api/types";

type DisplayStatus = "online" | "busy" | "away" | "offline";

const statusOptions: { value: UserStatus; label: string; description: string }[] = [
  { value: "online", label: "Available", description: "Ready to chat and call" },
  { value: "busy", label: "Busy", description: "In a meeting or focused work" },
  { value: "away", label: "Away", description: "Temporarily unavailable" },
  { value: "do_not_disturb", label: "Do Not Disturb", description: "No notifications" },
  { value: "offline", label: "Appear Offline", description: "Hidden from others" },
];

export default function Profile() {
  const { toast } = useToast();
  const { user, updateProfile, updateStatus } = useAuth();
  
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedProfile, setEditedProfile] = useState({
    displayName: user?.displayName || "",
    status: user?.status || "online" as UserStatus,
    statusMessage: "Hey there! I'm using Connect", // This could be a custom field
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update display name
      if (editedProfile.displayName !== user?.displayName) {
        await updateProfile({ displayName: editedProfile.displayName });
      }
      
      // Update status
      if (editedProfile.status !== user?.status) {
        await updateStatus(editedProfile.status);
      }
      
      setIsEditing(false);
      toast({
        title: "Profile updated",
        description: "Your changes have been saved successfully.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: "Could not save your changes. Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedProfile({
      displayName: user?.displayName || "",
      status: user?.status || "online",
      statusMessage: "Hey there! I'm using Connect",
    });
    setIsEditing(false);
  };

  const copyNumber = () => {
    if (user?.uniqueNumber) {
      navigator.clipboard.writeText(formatNumber(user.uniqueNumber));
      toast({
        title: "Copied!",
        description: "Your number has been copied to clipboard.",
      });
    }
  };

  const getDisplayStatus = (status: UserStatus): DisplayStatus => {
    if (status === 'do_not_disturb') return 'busy';
    return status;
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto custom-scrollbar p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto w-full max-w-2xl space-y-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
          {!isEditing ? (
            <Button variant="outline" onClick={() => setIsEditing(true)}>
              <Edit2 className="mr-2 h-4 w-4" />
              Edit Profile
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleCancel} disabled={isSaving}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>

        {/* Avatar Section */}
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-card p-8 border border-border">
          <div className="relative">
            <Avatar 
              name={user?.displayName || "User"} 
              src={user?.profilePictureUrl}
              status={getDisplayStatus(user?.status || "online")} 
              size="xl" 
            />
            {isEditing && (
              <button className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full gradient-primary text-white shadow-lg hover:shadow-glow transition-shadow">
                <Camera className="h-5 w-5" />
              </button>
            )}
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-foreground">{user?.displayName}</h2>
            <p className="mt-1 text-muted-foreground">{editedProfile.statusMessage}</p>
          </div>

          {/* Number Display */}
          <div className="flex items-center gap-4 rounded-xl bg-secondary/50 px-6 py-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Your Number</p>
              <p className="text-2xl font-bold tracking-wider text-gradient">
                {formatNumber(user?.uniqueNumber || "")}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={copyNumber}>
                <Copy className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon">
                <QrCode className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon">
                <Share2 className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Profile Details */}
        <div className="space-y-6 rounded-2xl bg-card p-6 border border-border">
          <h3 className="text-lg font-medium text-foreground">Account Details</h3>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              {isEditing ? (
                <Input
                  id="name"
                  value={editedProfile.displayName}
                  onChange={(e) =>
                    setEditedProfile({ ...editedProfile, displayName: e.target.value })
                  }
                />
              ) : (
                <p className="rounded-lg bg-secondary/50 px-4 py-2.5 text-foreground">
                  {user?.displayName}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <p className="rounded-lg bg-secondary/50 px-4 py-2.5 text-foreground">
                {user?.email}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              {isEditing ? (
                <Select
                  value={editedProfile.status}
                  onValueChange={(value: UserStatus) =>
                    setEditedProfile({ ...editedProfile, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              option.value === "online"
                                ? "status-online"
                                : option.value === "busy" || option.value === "do_not_disturb"
                                ? "status-busy"
                                : option.value === "away"
                                ? "status-away"
                                : "bg-muted-foreground"
                            }`}
                          />
                          {option.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-2.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      user?.status === "online"
                        ? "status-online"
                        : user?.status === "busy" || user?.status === "do_not_disturb"
                        ? "status-busy"
                        : user?.status === "away"
                        ? "status-away"
                        : "bg-muted-foreground"
                    }`}
                  />
                  <span className="text-foreground capitalize">
                    {user?.status === 'do_not_disturb' ? 'Do Not Disturb' : user?.status}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="statusMessage">Status Message</Label>
              {isEditing ? (
                <Textarea
                  id="statusMessage"
                  value={editedProfile.statusMessage}
                  onChange={(e) =>
                    setEditedProfile({
                      ...editedProfile,
                      statusMessage: e.target.value,
                    })
                  }
                  placeholder="What's on your mind?"
                  className="resize-none"
                  rows={2}
                />
              ) : (
                <p className="rounded-lg bg-secondary/50 px-4 py-2.5 text-foreground">
                  {editedProfile.statusMessage || "No status message set"}
                </p>
              )}
            </div>

            {user?.createdAt && (
              <div className="space-y-2">
                <Label>Member Since</Label>
                <p className="rounded-lg bg-secondary/50 px-4 py-2.5 text-foreground">
                  {new Date(user.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function formatNumber(num: string): string {
  if (num.length !== 10) return num;
  return `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`;
}
