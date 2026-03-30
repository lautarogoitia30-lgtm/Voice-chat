/**
 * LiveKit client for voice chat.
 * Handles room connections, microphone publishing, and participant tracking.
 */

// Load LiveKit client from global
const getLiveKit = () => window.livekit;

// Store callbacks globally so they persist
window.livekitCallbacks = window.livekitCallbacks || {
    onParticipantConnected: null,
    onParticipantDisconnected: null,
    onParticipantSpeaking: null
};

class LiveKitClient {
    constructor() {
        this.room = null;
        this.localParticipant = null;
        this.LiveKitModule = null;
    }
    
    /**
     * Connect to a LiveKit room (voice channel)
     */
    async connect(url, token) {
        try {
            // Disconnect from previous room if any
            this.disconnect();
            
            console.log('Connecting to LiveKit room...');
            
            // Import LiveKit client library
            const livekit = await import('https://cdn.jsdelivr.net/npm/livekit-client@2/+esm');
            const { Room, RoomEvent, createMicrophoneTracks } = livekit;
            
            this.LiveKitModule = livekit;
            this.createMicrophoneTracks = createMicrophoneTracks;
            
            this.room = new Room();
            
            // Set up event listeners
            this.room
                .on(RoomEvent.ParticipantConnected, (participant) => {
                    console.log('Participant connected:', participant.identity);
                    if (this.onParticipantConnected) {
                        this.onParticipantConnected(participant);
                    }
                })
                .on(RoomEvent.ParticipantDisconnected, (participant) => {
                    console.log('Participant disconnected:', participant.identity);
                    if (this.onParticipantDisconnected) {
                        this.onParticipantDisconnected(participant);
                    }
                })
                .on(RoomEvent.ParticipantSpeakingChanged, (participant) => {
                    console.log('Participant speaking changed:', participant.identity, participant.isSpeaking);
                    if (this.onParticipantSpeaking) {
                        this.onParticipantSpeaking(participant);
                    }
                });
            
            // Connect to the room
            await this.room.connect(url, token);
            
            this.localParticipant = this.room.localParticipant;
            
            console.log('Connected to LiveKit room');
            
            // Try to publish microphone - but don't fail if it doesn't work
            try {
                await this.publishMicrophone();
            } catch (e) {
                console.warn('Could not publish microphone, but connected to room:', e);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to connect to LiveKit:', error);
            throw error;
        }
    }
    
    /**
     * Publish local microphone to the room
     */
    async publishMicrophone() {
        try {
            // Use createMicrophoneTracks stored in this
            const createMicrophoneTracks = this.createMicrophoneTracks;
            
            const microphoneTracks = await createMicrophoneTracks({
                audio: true,
                video: false
            });
            
            // Publish each track
            for (const track of microphoneTracks) {
                const publication = await this.localParticipant.publishTrack(track);
                console.log('Microphone published:', publication.sid);
            }
            
            return microphoneTracks[0];
        } catch (error) {
            console.error('Failed to publish microphone:', error);
            throw error;
        }
    }
    
    /**
     * Disconnect from the current room
     */
    disconnect() {
        if (this.room) {
            this.room.disconnect();
            this.room = null;
            this.localParticipant = null;
            console.log('Disconnected from LiveKit room');
        }
    }
    
    /**
     * Get all participants in the room
     */
    getParticipants() {
        if (!this.room) return [];
        
        return Array.from(this.room.participants.values());
    }
    
    /**
     * Get local participant info
     */
    getLocalParticipant() {
        return this.localParticipant;
    }
    
    /**
     * Check if connected to a room
     */
    isConnected() {
        return this.room !== null;
    }
}

// Create singleton instance
const livekitClient = new LiveKitClient();

// Export for use in other scripts
window.livekitClient = livekitClient;

// Log that the module loaded
console.log('LiveKit client module loaded');