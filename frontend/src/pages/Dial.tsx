import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { DialPad } from "@/components/DialPad";
import { useSearchByNumber, useCreateDirectChat, useInitiateCall } from "@/lib/api/hooks";
import { useToast } from "@/hooks/use-toast";

export default function Dial() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [dialedNumber, setDialedNumber] = useState("");
  const [isInitiating, setIsInitiating] = useState(false);

  // Search for user as they dial
  const { data: foundUser } = useSearchByNumber(dialedNumber);
  const createChatMutation = useCreateDirectChat();
  const initiateCallMutation = useInitiateCall();

  const handleCall = async (number: string, isVideo: boolean) => {
    if (!number || number.length !== 10) {
      toast({
        variant: "destructive",
        title: "Invalid number",
        description: "Please enter a valid 10-digit number.",
      });
      return;
    }

    setIsInitiating(true);

    try {
      if (foundUser) {
        // Found user, initiate call
        const response = await initiateCallMutation.mutateAsync({
          participantIds: [foundUser.id],
          type: isVideo ? 'video' : 'audio',
        });

        navigate(`/call/${response.callId}`, {
          state: {
            participantIds: [foundUser.id],
            isVideo,
            chatName: foundUser.displayName,
            callId: response.callId,
          },
        });
      } else {
        toast({
          variant: "destructive",
          title: "User not found",
          description: "No user found with this number. Please check and try again.",
        });
      }
    } catch (error) {
      console.error('Failed to initiate call:', error);
      toast({
        variant: "destructive",
        title: "Call failed",
        description: "Could not initiate the call. Please try again.",
      });
    } finally {
      setIsInitiating(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Dial a number</h1>
          <p className="mt-1 text-muted-foreground">
            Enter a 10-digit number to call or video chat
          </p>
        </div>
        
        {/* Show found user */}
        {foundUser && dialedNumber.length === 10 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-lg bg-secondary/50 p-4 text-center"
          >
            <p className="text-sm text-muted-foreground">Calling</p>
            <p className="font-semibold text-foreground">{foundUser.displayName}</p>
          </motion.div>
        )}
        
        {isInitiating && (
          <div className="mb-4 flex items-center justify-center gap-2 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Initiating call...</span>
          </div>
        )}
        
        <DialPad 
          onCall={handleCall} 
          onNumberChange={setDialedNumber}
          disabled={isInitiating}
        />
      </motion.div>
    </div>
  );
}
