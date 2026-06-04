import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, PhoneOff, Video, User } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/Avatar';
import { useDeclineCall } from '@/lib/api/hooks';
import { api } from '@/lib/api/client';
import { API_CONFIG } from '@/lib/api/config';
import type { SearchUserResult } from '@/lib/api/types';
import type { IncomingCall } from '@/hooks/useNotificationWebSocket';

interface IncomingCallModalProps {
    incomingCall: IncomingCall | null;
    onAccept: () => void;
    onDecline: () => void;
    onDismiss: () => void;
}

export function IncomingCallModal({
    incomingCall,
    onAccept,
    onDecline,
    onDismiss,
}: IncomingCallModalProps) {
    const navigate = useNavigate();
    const declineCallMutation = useDeclineCall();
    const [callerInfo, setCallerInfo] = useState<SearchUserResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const ringtoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fetch caller information when we have an incoming call
    useEffect(() => {
        if (!incomingCall) {
            setCallerInfo(null);
            return;
        }

        // If caller info is already provided
        if (incomingCall.callerName) {
            setCallerInfo({
                id: incomingCall.initiatorId,
                displayName: incomingCall.callerName,
                profilePictureUrl: incomingCall.callerAvatar,
                uniqueNumber: '',
                status: 'online',
            });
            return;
        }

        // Fetch caller info from API
        const fetchCallerInfo = async () => {
            try {
                // We'll need to add an endpoint to get user by ID or use existing search
                // For now, we'll show a placeholder
                setCallerInfo({
                    id: incomingCall.initiatorId,
                    displayName: 'Unknown Caller',
                    uniqueNumber: '',
                    status: 'online',
                });
            } catch (error) {
                console.error('Failed to fetch caller info:', error);
            }
        };

        fetchCallerInfo();
    }, [incomingCall]);

    // Play ringtone when call comes in
    useEffect(() => {
        if (!incomingCall) {
            // Stop ringtone
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            if (ringtoneTimeoutRef.current) {
                clearTimeout(ringtoneTimeoutRef.current);
            }
            return;
        }

        // Create and play ringtone
        // Using Web Audio API for a simple ringtone
        const playRingtone = () => {
            try {
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

                const playTone = () => {
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();

                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);

                    oscillator.frequency.value = 440; // A4 note
                    oscillator.type = 'sine';

                    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

                    oscillator.start(audioContext.currentTime);
                    oscillator.stop(audioContext.currentTime + 0.5);
                };

                // Play a ring pattern
                const ringPattern = () => {
                    playTone();
                    setTimeout(playTone, 200);
                };

                // Play immediately
                ringPattern();

                // Repeat every 3 seconds
                const ringInterval = setInterval(() => {
                    if (incomingCall) {
                        ringPattern();
                    } else {
                        clearInterval(ringInterval);
                    }
                }, 3000);

                // Auto-dismiss after 45 seconds (missed call)
                ringtoneTimeoutRef.current = setTimeout(() => {
                    clearInterval(ringInterval);
                    onDismiss();
                }, 45000);

                return () => {
                    clearInterval(ringInterval);
                    audioContext.close();
                };
            } catch (error) {
                console.error('Failed to play ringtone:', error);
            }
        };

        playRingtone();

        return () => {
            if (ringtoneTimeoutRef.current) {
                clearTimeout(ringtoneTimeoutRef.current);
            }
        };
    }, [incomingCall, onDismiss]);

    // Handle accept call
    const handleAccept = async () => {
        if (!incomingCall) return;

        setIsLoading(true);
        try {
            // Navigate to call screen
            navigate(`/call/${incomingCall.callId}`, {
                state: {
                    callId: incomingCall.callId,
                    roomId: incomingCall.roomId,
                    isIncoming: true,
                    isVideo: incomingCall.type === 'video',
                    chatName: callerInfo?.displayName || 'Unknown Caller',
                    participantIds: [incomingCall.initiatorId],
                    isGroupCall: incomingCall.isGroupCall,
                },
            });
            onAccept();
        } catch (error) {
            console.error('Failed to accept call:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Handle decline call
    const handleDecline = async () => {
        if (!incomingCall) return;

        setIsLoading(true);
        try {
            await declineCallMutation.mutateAsync(incomingCall.callId);
            onDecline();
        } catch (error) {
            console.error('Failed to decline call:', error);
            // Still dismiss the modal even if API fails
            onDecline();
        } finally {
            setIsLoading(false);
        }
    };

    if (!incomingCall) {
        return null;
    }

    const isVideoCall = incomingCall.type === 'video';
    const callerName = callerInfo?.displayName || 'Unknown Caller';

    return (
        <Dialog open={!!incomingCall} onOpenChange={() => { }}>
            <DialogContent
                className="sm:max-w-md border-none bg-gradient-to-b from-gray-900 to-gray-950 text-white overflow-hidden"
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                {/* Hidden title for accessibility */}
                <DialogTitle className="sr-only">Incoming Call</DialogTitle>
                <DialogDescription className="sr-only">
                    {callerName} is calling you. Accept or decline the call.
                </DialogDescription>

                <div className="flex flex-col items-center py-8">
                    {/* Pulsing ring effect */}
                    <div className="relative mb-6">
                        <div className="absolute inset-0 animate-ping rounded-full bg-green-500/20" style={{ animationDuration: '1.5s' }} />
                        <div className="absolute inset-0 animate-ping rounded-full bg-green-500/10" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
                        <Avatar
                            name={callerName}
                            size="xl"
                            src={callerInfo?.profilePictureUrl}
                            className="relative z-10 h-24 w-24 ring-4 ring-green-500/50"
                        />
                    </div>

                    {/* Caller info */}
                    <h2 className="text-2xl font-semibold mb-1">{callerName}</h2>
                    <div className="flex items-center gap-2 text-gray-400 mb-2">
                        {isVideoCall ? (
                            <>
                                <Video className="h-4 w-4" />
                                <span>Video Call</span>
                            </>
                        ) : (
                            <>
                                <Phone className="h-4 w-4" />
                                <span>Audio Call</span>
                            </>
                        )}
                        {incomingCall.isGroupCall && (
                            <span className="ml-1 text-xs bg-gray-700 px-2 py-0.5 rounded-full">
                                Group
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-gray-500 animate-pulse">Incoming call...</p>

                    {/* Action buttons */}
                    <div className="flex items-center justify-center gap-8 mt-10">
                        {/* Decline button */}
                        <button
                            onClick={handleDecline}
                            disabled={isLoading}
                            className="group flex flex-col items-center gap-2 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
                        >
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30 transition-shadow group-hover:shadow-red-500/50">
                                <PhoneOff className="h-7 w-7 text-white" />
                            </div>
                            <span className="text-sm text-gray-400">Decline</span>
                        </button>

                        {/* Accept button */}
                        <button
                            onClick={handleAccept}
                            disabled={isLoading}
                            className="group flex flex-col items-center gap-2 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
                        >
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/30 transition-shadow group-hover:shadow-green-500/50 animate-pulse">
                                {isVideoCall ? (
                                    <Video className="h-7 w-7 text-white" />
                                ) : (
                                    <Phone className="h-7 w-7 text-white" />
                                )}
                            </div>
                            <span className="text-sm text-gray-400">Accept</span>
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
