import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, UserPlus, Users, Loader2, Phone as PhoneIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ContactItem } from "@/components/ContactItem";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSearchUsers, useSearchByNumber, useGroups, useCreateDirectChat, useCreateGroup } from "@/lib/api/hooks";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { SearchUserResult, Group } from "@/lib/api/types";

type Status = "online" | "busy" | "away" | "offline";

export default function Contacts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [searchNumber, setSearchNumber] = useState("");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  // API hooks
  const { data: searchResults, isLoading: isSearching } = useSearchUsers(searchQuery);
  const { data: numberSearchResult, isLoading: isSearchingNumber } = useSearchByNumber(searchNumber);
  const { data: groupsData, isLoading: isLoadingGroups } = useGroups();
  const createDirectChatMutation = useCreateDirectChat();
  const createGroupMutation = useCreateGroup();

  const contacts = searchResults?.users || [];
  const groups = groupsData?.groups || [];

  const handleCall = async (contactId: string, isVideo: boolean) => {
    // Create or get existing chat, then navigate to call
    try {
      const chat = await createDirectChatMutation.mutateAsync({ participantId: contactId });
      navigate("/call", { 
        state: { 
          participantIds: [contactId],
          isVideo,
          chatId: chat.id,
        } 
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to start call",
        description: "Could not initiate the call. Please try again.",
      });
    }
  };

  const handleMessage = async (contactId: string) => {
    try {
      const chat = await createDirectChatMutation.mutateAsync({ participantId: contactId });
      navigate("/chats", { state: { selectedChatId: chat.id } });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to open chat",
        description: "Could not create conversation. Please try again.",
      });
    }
  };

  const handleAddContact = async () => {
    if (!numberSearchResult) return;
    
    try {
      await createDirectChatMutation.mutateAsync({ participantId: numberSearchResult.id });
      toast({
        title: "Contact added!",
        description: `You can now chat with ${numberSearchResult.displayName}.`,
      });
      setAddContactOpen(false);
      setSearchNumber("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to add contact",
        description: "Could not add this contact. Please try again.",
      });
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) return;
    
    try {
      await createGroupMutation.mutateAsync({
        name: groupName,
        memberIds: selectedMembers,
      });
      toast({
        title: "Group created!",
        description: `${groupName} has been created successfully.`,
      });
      setCreateGroupOpen(false);
      setGroupName("");
      setSelectedMembers([]);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to create group",
        description: "Could not create the group. Please try again.",
      });
    }
  };

  const mapStatus = (status: string): Status => {
    if (status === 'do_not_disturb') return 'busy';
    return status as Status;
  };

  return (
    <div className="flex h-full flex-col p-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-foreground">Contacts</h1>
          <Dialog open={addContactOpen} onOpenChange={setAddContactOpen}>
            <DialogTrigger asChild>
              <Button variant="gradient" size="sm" className="gap-2">
                <UserPlus className="h-4 w-4" />
                Add Contact
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Contact</DialogTitle>
                <DialogDescription>
                  Enter a 10-digit number to find and add a contact.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="relative">
                  <PhoneIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Enter 10-digit number"
                    value={searchNumber}
                    onChange={(e) => setSearchNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="pl-10"
                  />
                </div>
                
                {isSearchingNumber && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
                
                {numberSearchResult && (
                  <div className="flex items-center gap-4 rounded-lg bg-secondary/50 p-4">
                    <div className="flex-1">
                      <p className="font-medium">{numberSearchResult.displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatNumber(numberSearchResult.uniqueNumber)}
                      </p>
                    </div>
                    <Button 
                      variant="gradient" 
                      size="sm"
                      onClick={handleAddContact}
                      disabled={createDirectChatMutation.isPending}
                    >
                      {createDirectChatMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Add"
                      )}
                    </Button>
                  </div>
                )}
                
                {searchNumber.length === 10 && !numberSearchResult && !isSearchingNumber && (
                  <p className="text-center text-sm text-muted-foreground">
                    No user found with this number.
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contacts or groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </motion.div>

      <Tabs defaultValue="contacts" className="flex-1">
        <TabsList className="mb-4">
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
          {isSearching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : contacts.length > 0 ? (
            contacts.map((contact, index) => (
              <motion.div
                key={contact.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <ContactItem
                  id={contact.id}
                  name={contact.displayName}
                  number={contact.uniqueNumber}
                  avatar={contact.profilePictureUrl}
                  status={mapStatus(contact.status)}
                  onCall={(isVideo) => handleCall(contact.id, isVideo)}
                  onMessage={() => handleMessage(contact.id)}
                />
              </motion.div>
            ))
          ) : searchQuery.length >= 2 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium text-foreground">No contacts found</h3>
              <p className="text-sm text-muted-foreground">
                Try a different search term
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <UserPlus className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium text-foreground">Search for contacts</h3>
              <p className="text-sm text-muted-foreground">
                Enter at least 2 characters to search
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="groups" className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
          {isLoadingGroups ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {groups.map((group, index) => (
                <motion.button
                  key={group.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => navigate("/chats", { state: { selectedGroupId: group.id } })}
                  className="flex w-full items-center gap-4 rounded-xl p-4 transition-colors hover:bg-secondary/50"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-white">
                    <Users className="h-6 w-6" />
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className="font-medium text-foreground">{group.name}</h3>
                    <p className="text-sm text-muted-foreground capitalize">
                      {group.role}
                    </p>
                  </div>
                </motion.button>
              ))}

              <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
                <DialogTrigger asChild>
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: groups.length * 0.05 }}
                    className="flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-border p-4 transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-current text-muted-foreground">
                      <UserPlus className="h-6 w-6" />
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className="font-medium text-foreground">Create new group</h3>
                      <p className="text-sm text-muted-foreground">
                        Start a group chat or call
                      </p>
                    </div>
                  </motion.button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Group</DialogTitle>
                    <DialogDescription>
                      Create a new group to chat with multiple people.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Group Name</label>
                      <Input
                        placeholder="Enter group name"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                      />
                    </div>
                    
                    <Button 
                      variant="gradient" 
                      className="w-full"
                      onClick={handleCreateGroup}
                      disabled={!groupName.trim() || createGroupMutation.isPending}
                    >
                      {createGroupMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      Create Group
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function formatNumber(num: string): string {
  if (num.length !== 10) return num;
  return `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}`;
}
