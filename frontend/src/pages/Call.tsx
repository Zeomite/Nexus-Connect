import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Users,
  MoreVertical,
  Maximize2,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useInitiateCall, useAcceptCall, useEndCall } from "@/lib/api/hooks";
import { SignalingWebSocket, type CallJoinedData } from "@/lib/websocket/SignalingWebSocket";
import { useToast } from "@/hooks/use-toast";

type CallState = "initializing" | "connecting" | "ringing" | "connected" | "ended" | "error";

interface CallLocationState {
  participantIds?: string[];
  isVideo?: boolean;
  chatName?: string;
  callId?: string;
  isIncoming?: boolean;
}

export default function Call() {
  const navigate = useNavigate();
  const location = useLocation();
  const { callId: callIdFromParams } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const locationState = location.state as CallLocationState | undefined;
  const participantIds = locationState?.participantIds || [];
  const initialIsVideo = locationState?.isVideo ?? false;
  const chatName = locationState?.chatName || "Unknown";
  const isIncoming = locationState?.isIncoming ?? false;
  const existingCallId = callIdFromParams || locationState?.callId;

  const [callState, setCallState] = useState<CallState>("initializing");
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(initialIsVideo);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callId, setCallId] = useState<string | null>(existingCallId || null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // WebRTC refs
  const signalingRef = useRef<SignalingWebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // API hooks
  const initiateCallMutation = useInitiateCall();
  const acceptCallMutation = useAcceptCall();
  const endCallMutation = useEndCall();

  // Initialize call
  useEffect(() => {
    const initializeCall = async () => {
      try {
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: isVideoOn,
        });
        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        if (isIncoming && existingCallId) {
          // Accept incoming call
          const response = await acceptCallMutation.mutateAsync(existingCallId);
          setCallId(response.callId);
          await connectToSignaling(response.callId);
        } else if (participantIds.length > 0) {
          // Initiate new call
          setCallState("connecting");
          const response = await initiateCallMutation.mutateAsync({
            participantIds,
            type: isVideoOn ? 'video' : 'audio',
          });
          setCallId(response.callId);
          await connectToSignaling(response.callId);
        }
      } catch (error) {
        console.error('Failed to initialize call:', error);
        setCallState("error");
        setErrorMessage("Failed to access camera/microphone. Please check permissions.");
      }
    };

    initializeCall();

    return () => {
      cleanup();
    };
  }, []);

  // Connect to signaling server
  const connectToSignaling = async (id: string) => {
    try {
      const signaling = new SignalingWebSocket(id);
      signalingRef.current = signaling;

      const joinData = await signaling.connect();
      
      // Create peer connection
      const pc = createPeerConnection(joinData.iceServers);
      peerConnectionRef.current = pc;

      // Add local tracks
      localStreamRef.current?.getTracks().forEach(track => {
        if (localStreamRef.current) {
          pc.addTrack(track, localStreamRef.current);
        }
      });

      // Set up signaling event handlers
      setupSignalingHandlers(signaling, pc);

      setCallState("ringing");

      // If we're the caller, create and send offer
      if (!isIncoming) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        // Send offer to all participants
        participantIds.forEach(participantId => {
          signaling.sendOffer(participantId, offer);
        });
      }
    } catch (error) {
      console.error('Failed to connect to signaling:', error);
      setCallState("error");
      setErrorMessage("Failed to connect to call server.");
    }
  };

  // Create WebRTC peer connection
  const createPeerConnection = (iceServers: RTCIceServer[]): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: iceServers.length > 0 ? iceServers : [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && signalingRef.current) {
        participantIds.forEach(participantId => {
          signalingRef.current?.sendIceCandidate(participantId, event.candidate!.toJSON());
        });
      }
    };

    // Handle remote stream
    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
      setCallState("connected");
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          setCallState("connected");
          break;
        case 'disconnected':
        case 'failed':
          setCallState("ended");
          break;
      }
    };

    return pc;
  };

  // Set up signaling event handlers
  const setupSignalingHandlers = (signaling: SignalingWebSocket, pc: RTCPeerConnection) => {
    signaling.on('call:participant_joined', () => {
      // A participant joined, we might need to renegotiate
    });

    signaling.on<{ fromUserId: string; offer: RTCSessionDescriptionInit }>('call:offer', async (data) => {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signaling.sendAnswer(data.fromUserId, answer);
    });

    signaling.on<{ fromUserId: string; answer: RTCSessionDescriptionInit }>('call:answer', async (data) => {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      setCallState("connected");
    });

    signaling.on<{ fromUserId: string; candidate: RTCIceCandidateInit }>('call:ice_candidate', async (data) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error('Failed to add ICE candidate:', error);
      }
    });

    signaling.on('call:declined', () => {
      toast({
        title: "Call declined",
        description: "The other person declined the call.",
      });
      handleEndCall();
    });

    signaling.on<{ endReason: string }>('call:ended', (data) => {
      setCallState("ended");
      setTimeout(() => navigate(-1), 1500);
    });

    signaling.on<{ userId: string; isMuted: boolean; isVideoEnabled: boolean }>('call:media_state_changed', (data) => {
      // Handle remote user's media state change
    });
  };

  // Cleanup function
  const cleanup = () => {
    // Stop local stream
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    
    // Close peer connection
    peerConnectionRef.current?.close();
    
    // Disconnect signaling
    signalingRef.current?.disconnect();
  };

  // Duration timer
  useEffect(() => {
    if (callState === "connected") {
      const interval = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [callState]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isMuted;
      setIsMuted(!isMuted);
      signalingRef.current?.toggleMute(!isMuted);
    }
  }, [isMuted]);

  // Toggle video
  const toggleVideo = useCallback(async () => {
    if (isVideoOn) {
      // Turn off video
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        localStreamRef.current?.removeTrack(videoTrack);
      }
      setIsVideoOn(false);
      signalingRef.current?.toggleVideo(false);
    } else {
      // Turn on video
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];
        localStreamRef.current?.addTrack(videoTrack);
        
        // Update peer connection
        const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        } else {
          peerConnectionRef.current?.addTrack(videoTrack, localStreamRef.current!);
        }
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }
        
        setIsVideoOn(true);
        signalingRef.current?.toggleVideo(true);
      } catch (error) {
        console.error('Failed to enable video:', error);
        toast({
          variant: "destructive",
          title: "Camera error",
          description: "Could not access camera.",
        });
      }
    }
  }, [isVideoOn, toast]);

  // Toggle screen share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen share
      const screenTrack = localStreamRef.current?.getVideoTracks().find(t => t.label.includes('screen'));
      if (screenTrack) {
        screenTrack.stop();
      }
      setIsScreenSharing(false);
      signalingRef.current?.toggleScreenShare(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        // Replace video track with screen track
        const sender = peerConnectionRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack);
        }
        
        screenTrack.onended = () => {
          setIsScreenSharing(false);
          signalingRef.current?.toggleScreenShare(false);
        };
        
        setIsScreenSharing(true);
        signalingRef.current?.toggleScreenShare(true);
      } catch (error) {
        console.error('Failed to share screen:', error);
      }
    }
  }, [isScreenSharing]);

  // End call
  const handleEndCall = useCallback(async () => {
    setCallState("ended");
    
    if (callId) {
      try {
        await endCallMutation.mutateAsync(callId);
      } catch (error) {
        console.error('Failed to end call:', error);
      }
    }
    
    signalingRef.current?.endCall();
    cleanup();
    
    setTimeout(() => navigate(-1), 1000);
  }, [callId, navigate]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Error state
  if (callState === "error") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gradient-dark">
        <div className="text-center space-y-6">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-destructive/20">
            <PhoneOff className="h-12 w-12 text-destructive" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-white">Call Failed</h2>
            <p className="mt-2 text-white/60">{errorMessage}</p>
          </div>
          <Button
            variant="glass"
            size="xl"
            onClick={() => navigate(-1)}
          >
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col gradient-dark">
      {/* Video Background */}
      <div className="absolute inset-0 overflow-hidden">
        {isVideoOn && callState === "connected" && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>

      {/* Top Bar */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <Button variant="glass" size="icon" className="rounded-full">
            <Users className="h-5 w-5" />
          </Button>
          {callState === "connected" && (
            <span className="text-sm text-white/80">
              {formatDuration(duration)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="icon" className="rounded-full">
            <MessageSquare className="h-5 w-5" />
          </Button>
          <Button variant="glass" size="icon" className="rounded-full">
            <Maximize2 className="h-5 w-5" />
          </Button>
          <Button variant="glass" size="icon" className="rounded-full">
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {callState === "initializing" && (
            <motion.div
              key="initializing"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-6" />
              <h2 className="text-2xl font-semibold text-white">Setting up...</h2>
              <p className="mt-2 text-white/60">Accessing your camera and microphone</p>
            </motion.div>
          )}

          {callState === "connecting" && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              <div className="relative mb-6">
                <Avatar name={chatName} size="xl" />
                <div className="absolute -inset-4 rounded-full border-4 border-primary/30 animate-pulse-ring" />
              </div>
              <h2 className="text-2xl font-semibold text-white">{chatName}</h2>
              <p className="mt-2 text-white/60">Connecting...</p>
            </motion.div>
          )}

          {callState === "ringing" && (
            <motion.div
              key="ringing"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              <div className="relative mb-6">
                <Avatar name={chatName} size="xl" />
                <div className="absolute -inset-4 rounded-full border-4 border-primary animate-pulse-ring" />
                <div className="absolute -inset-8 rounded-full border-4 border-primary/50 animate-pulse-ring" style={{ animationDelay: "0.5s" }} />
              </div>
              <h2 className="text-2xl font-semibold text-white">{chatName}</h2>
              <p className="mt-2 text-white/60">Ringing...</p>
            </motion.div>
          )}

          {callState === "connected" && !isVideoOn && (
            <motion.div
              key="connected-audio"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              <Avatar name={chatName} size="xl" />
              <h2 className="mt-6 text-2xl font-semibold text-white">{chatName}</h2>
              <p className="mt-2 text-white/60">{formatDuration(duration)}</p>
            </motion.div>
          )}

          {callState === "ended" && (
            <motion.div
              key="ended"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              <Avatar name={chatName} size="xl" />
              <h2 className="mt-6 text-2xl font-semibold text-white">Call Ended</h2>
              <p className="mt-2 text-white/60">{formatDuration(duration)}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Self Video Preview */}
        {isVideoOn && callState === "connected" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute bottom-32 right-6 h-40 w-28 overflow-hidden rounded-2xl bg-slate-800 shadow-lg ring-2 ring-white/20"
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover mirror"
            />
          </motion.div>
        )}
      </div>

      {/* Bottom Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 p-6"
      >
        <div className="mx-auto flex max-w-md items-center justify-center gap-4">
          <Button
            variant={isMuted ? "callMuted" : "glass"}
            size="iconLg"
            onClick={toggleMute}
            className="rounded-full"
          >
            {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </Button>

          <Button
            variant={isVideoOn ? "glass" : "callMuted"}
            size="iconLg"
            onClick={toggleVideo}
            className="rounded-full"
          >
            {isVideoOn ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
          </Button>

          <Button
            variant="callEnd"
            size="iconXl"
            onClick={handleEndCall}
            className="rounded-full"
          >
            <PhoneOff className="h-8 w-8" />
          </Button>

          <Button
            variant={isScreenSharing ? "glass" : "callMuted"}
            size="iconLg"
            onClick={toggleScreenShare}
            className="rounded-full"
          >
            {isScreenSharing ? <Monitor className="h-6 w-6" /> : <MonitorOff className="h-6 w-6" />}
          </Button>

          <Button
            variant="glass"
            size="iconLg"
            className="rounded-full"
          >
            <MoreVertical className="h-6 w-6" />
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
