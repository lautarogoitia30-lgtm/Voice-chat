/**
 * LiveKit client for voice chat.
 * Handles room connections, microphone publishing, and participant tracking.
 * VERSION 3 - NO createLocalMicrophoneTrackAndShow
 */

// DEBUG: Make sure this is the latest version
console.log('=== LIVEKIT CLIENT v4 LOADED ===');

class LiveKitClient {
    constructor() {
        this.room = null;
        this.localParticipant = null;
        this.knownParticipants = []; // Track known participants manually
        this.audioElements = []; // Store all audio elements for control
        this.localAudioTrack = null; // Store local audio track for mute/unmute
    }
    
    /**
     * Connect to a LiveKit room (voice channel)
     */
    async connect(url, token) {
        try {
            // Disconnect from previous room if any
            this.disconnect();
            
            console.log('Connecting to LiveKit room at:', url);
            
            // Import LiveKit client library
            console.log('Importing LiveKit...');
            const livekit = await import('https://cdn.jsdelivr.net/npm/livekit-client@2/+esm');
            console.log('LiveKit imported:', livekit);
            
            const { Room, RoomEvent } = livekit;
            console.log('Room class:', Room);
            
            this.room = new Room({
                adaptiveStream: true,
                dynacast: true,
                autoSubscribe: true,
            });
            
            console.log('Room created:', this.room);
            
            // Set up event listeners
            this.room
                // Listen for connection state changes
                .on(RoomEvent.ConnectionStateChanged, (state) => {
                    console.log('[LIVEKIT] 🔌 Connection state changed:', state);
                })
                .on(RoomEvent.ParticipantConnected, (participant) => {
                    console.log('[LIVEKIT] 🔗 Participant connected:', participant.identity, participant.name);
                    console.log('[LIVEKIT] 🔗 Full participant:', participant);
                    // Add to known participants
                    this.knownParticipants.push(participant);
                    // Call the global callback
                    if (window.livekitCallbacks && window.livekitCallbacks.onParticipantConnected) {
                        window.livekitCallbacks.onParticipantConnected(participant);
                    }
                    if (this.onParticipantConnected) {
                        this.onParticipantConnected(participant);
                    }
                })
                .on(RoomEvent.ParticipantDisconnected, (participant) => {
                    console.log('Participant disconnected:', participant.identity);
                    // Remove from known participants
                    this.knownParticipants = this.knownParticipants.filter(p => p.identity !== participant.identity);
                    // Call the global callback
                    if (window.livekitCallbacks && window.livekitCallbacks.onParticipantDisconnected) {
                        window.livekitCallbacks.onParticipantDisconnected(participant);
                    }
                    if (this.onParticipantDisconnected) {
                        this.onParticipantDisconnected(participant);
                    }
                })
                // Also listen for existing participants when we join
                .on(RoomEvent.ParticipantActive, (participant) => {
                    console.log('[LIVEKIT] ✅ Participant active:', participant.identity, participant.name);
                    // Add to known participants
                    if (!this.knownParticipants.find(p => p.identity === participant.identity)) {
                        this.knownParticipants.push(participant);
                    }
                    if (window.livekitCallbacks && window.livekitCallbacks.onParticipantConnected) {
                        window.livekitCallbacks.onParticipantConnected(participant);
                    }
                    if (this.onParticipantConnected) {
                        this.onParticipantConnected(participant);
                    }
                })
                // Listen for track subscriptions (when someone starts speaking)
                .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
                    console.log('[LIVEKIT] 🎵 Track subscribed from:', participant.identity, participant.name, 'kind:', track.kind);
                    
                    // If it's an audio track, attach and play it
                    if (track.kind === 'audio') {
                        // Check if we're in observer mode (don't play audio if leftVoice is true)
                        if (window.appState && window.appState.leftVoice) {
                            console.log('[LIVEKIT] Observer mode - NOT attaching audio');
                            return; // Don't attach audio in observer mode
                        }
                        
                        console.log('[LIVEKIT] Attaching audio track from:', participant.name || participant.identity);
                        try {
                            const audioElement = track.attach();
                            audioElement.autoplay = true;
                            audioElement.volume = 1.0;
                            document.body.appendChild(audioElement);
                            
                            // Store reference to control later
                            this.audioElements.push({
                                element: audioElement,
                                participantId: participant.identity,
                                track: track
                            });
                            
                            console.log('[LIVEKIT] Audio attached and playing, total:', this.audioElements.length);
                        } catch(e) {
                            console.log('[LIVEKIT] Error attaching audio:', e);
                        }
                    }
                    
                    if (window.livekitCallbacks && window.livekitCallbacks.onTrackSubscribed) {
                        window.livekitCallbacks.onTrackSubscribed(track, publication, participant);
                    }
                })
                // Listen for track unsubscriptions
                .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
                    console.log('[LIVEKIT] Track unsubscribed from:', participant.identity, participant.name);
                    
                    // Remove from known participants
                    const idx = this.knownParticipants.findIndex(p => p.identity === participant.identity);
                    if (idx >= 0) {
                        this.knownParticipants.splice(idx, 1);
                        console.log('[LIVEKIT] Removed', participant.identity, 'from known participants');
                    }
                    
                    // Notify about participant leaving
                    if (window.livekitCallbacks && window.livekitCallbacks.onParticipantDisconnected) {
                        window.livekitCallbacks.onParticipantDisconnected(participant);
                    }
                    
                    // Detach the track
                    track.detach();
                })
                // Listen for active speakers change (quien esta hablando ahora)
                .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
                    console.log('Active speakers changed:', speakers.map(s => s.identity));
                    if (window.livekitCallbacks && window.livekitCallbacks.onActiveSpeakersChanged) {
                        window.livekitCallbacks.onActiveSpeakersChanged(speakers);
                    }
                });
            
            // Connect to the room
            console.log('[LIVEKIT] About to connect to:', url);
            console.log('[LIVEKIT] Token (first 50 chars):', token.substring(0, 50) + '...');
            
            await this.room.connect(url, token);
            
            this.localParticipant = this.room.localParticipant;
            
            console.log('[LIVEKIT] Connected to LiveKit room successfully!');
            console.log('[LIVEKIT] Room name:', this.room.name);
            console.log('[LIVEKIT] Local participant identity:', this.localParticipant.identity);
            console.log('[LIVEKIT] Local participant name:', this.localParticipant.name);
            
            // Check for existing participants in the room
            const existingParticipants = this.getParticipants();
            console.log('[LIVEKIT] Existing participants in room:', existingParticipants.length);
            
            // Notify about existing participants
            existingParticipants.forEach(participant => {
                console.log('Found existing participant:', participant.identity);
                if (window.livekitCallbacks && window.livekitCallbacks.onParticipantConnected) {
                    window.livekitCallbacks.onParticipantConnected(participant);
                }
            });
            
            return true;
        } catch (error) {
            console.error('Failed to connect to LiveKit:', error);
            throw error;
        }
    }
    
    /**
     * Publish local microphone to the room
     * With proper audio settings and volume control using Web Audio API
     */
    async publishMicrophone() {
        console.log('=== PUBLISH MICROPHONE ===');
        
        if (!this.room || !this.localParticipant) {
            console.warn('No room connected, cannot publish microphone');
            return;
        }
        
        try {
            // Get saved settings from localStorage
            const inputDevice = localStorage.getItem('voice_chat_input_device');
            const inputVolume = parseInt(localStorage.getItem('voice_chat_input_volume') || '100');
            const noiseSuppression = localStorage.getItem('voice_chat_noise_suppression') === 'true';
            const echoCancellation = localStorage.getItem('voice_chat_echo_cancellation') !== 'false';
            
            console.log('[AUDIO] === SETTINGS LOADED ===');
            console.log('[AUDIO] inputVolume:', inputVolume, 'type:', typeof inputVolume);
            console.log('[AUDIO] noiseSuppression:', noiseSuppression);
            console.log('[AUDIO] echoCancellation:', echoCancellation);
            console.log('[AUDIO] ========================');
            
            // Get microphone with specific device and audio processing
            const constraints = {
                audio: {
                    echoCancellation: echoCancellation,
                    noiseSuppression: noiseSuppression,
                    autoGainControl: true,
                    sampleRate: 48000,
                }
            };
            
            if (inputDevice) {
                constraints.audio.deviceId = { exact: inputDevice };
            }
            
            console.log('[AUDIO] Getting microphone with constraints');
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Store original track
            const originalTrack = stream.getAudioTracks()[0];
            this.localAudioTrack = originalTrack;
            
            // Create Web Audio API pipeline for volume control
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(stream);
            
            // Create gain node for volume
            this.inputGainNode = this.audioContext.createGain();
            this.inputGainNode.gain.value = inputVolume / 100;
            
            // Create destination to capture processed audio
            const dest = this.audioContext.createMediaStreamDestination();
            
            // Connect: source -> gain -> destination
            source.connect(this.inputGainNode);
            this.inputGainNode.connect(dest);
            
            // Create new track from the processed stream
            const processedTrack = dest.stream.getAudioTracks()[0];
            
            // Publish processed track to LiveKit
            await this.localParticipant.publishTrack(processedTrack);
            
            console.log('[AUDIO] Microphone published with volume control!');
            console.log('[AUDIO] inputGainNode:', this.inputGainNode);
            console.log('[AUDIO] gain value:', this.inputGainNode.gain.value);
            console.log('=== MICROPHONE READY ===');
        } catch (error) {
            console.error('ERROR publishing microphone:', error);
            alert('Error al acceder al micrófono: ' + error.message);
        }
    }
    
    /**
     * Update input volume dynamically
     */
    setInputVolume(volume) {
        console.log('[AUDIO] setInputVolume called with:', volume);
        console.log('[AUDIO] inputGainNode exists:', !!this.inputGainNode);
        console.log('[AUDIO] audioContext exists:', !!this.audioContext);
        
        if (this.inputGainNode) {
            // Check if audio context is suspended (can happen with autoplay policy)
            if (this.audioContext && this.audioContext.state === 'suspended') {
                console.log('[AUDIO] AudioContext is suspended, resuming...');
                this.audioContext.resume();
            }
            
            const gainValue = volume / 100;
            this.inputGainNode.gain.setValueAtTime(gainValue, this.audioContext.currentTime);
            console.log('[AUDIO] Volume updated to:', volume, 'gain:', this.inputGainNode.gain.value);
        } else {
            console.log('[AUDIO] inputGainNode not available yet - volume will apply on next join');
        }
    }
    
    /**
     * Get microphone audio track
     */
    async getMicrophoneAudio() {
        try {
            // Use navigator.mediaDevices to get microphone
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Create audio track from stream
            const audioTrack = stream.getAudioTracks()[0];
            
            // We need to wrap it in a LiveKit track
            // For now, just log the success
            console.log('Got microphone access, track:', audioTrack.id);
            
            return audioTrack;
        } catch (error) {
            console.warn('Could not get microphone:', error);
            return null;
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
            this.knownParticipants = []; // Clear known participants
            this.audioElements = []; // Clear audio elements
            console.log('Disconnected from LiveKit room');
        }
    }
    
    /**
     * Silence all audio - for observer mode
     */
    silenceAllAudio() {
        console.log('[LIVEKIT] silenceAllAudio called, elements:', this.audioElements.length);
        
        this.audioElements.forEach(audio => {
            try {
                audio.element.pause();
                audio.element.muted = true;
                audio.element.volume = 0;
                audio.element.srcObject = null;
                
                // Remove from DOM
                if (audio.element.parentNode) {
                    audio.element.parentNode.removeChild(audio.element);
                }
                console.log('[LIVEKIT] Silenced audio from:', audio.participantId);
            } catch(e) {
                console.log('[LIVEKIT] Error silencing audio:', e);
            }
        });
        
        // Clear the array
        this.audioElements = [];
        console.log('[LIVEKIT] All audio silenced');
    }
    
    /**
     * Get all participants in the room
     */
    getParticipants() {
        console.log('[LIVEKIT] getParticipants called');
        
        // Always try to get from room first (more accurate)
        if (!this.room) {
            console.log('[LIVEKIT] No room, returning known participants:', this.knownParticipants.length);
            return this.knownParticipants;
        }
        
        console.log('[LIVEKIT] room.state:', this.room.state);
        console.log('[LIVEKIT] room.name:', this.room.name);
        
        // Get remote participants from room
        let participants = [];
        
        // Try room.remoteParticipants (Map)
        if (this.room.remoteParticipants) {
            if (this.room.remoteParticipants instanceof Map) {
                const size = this.room.remoteParticipants.size;
                console.log('[LIVEKIT] remoteParticipants Map size:', size);
                if (size > 0) {
                    participants = Array.from(this.room.remoteParticipants.values());
                }
            } else if (typeof this.room.remoteParticipants === 'object') {
                console.log('[LIVEKIT] remoteParticipants is object');
                participants = Object.values(this.room.remoteParticipants);
            }
        }
        
        // Try room.participants (Map with all participants)
        if (participants.length === 0 && this.room.participants) {
            if (this.room.participants instanceof Map) {
                const size = this.room.participants.size;
                console.log('[LIVEKIT] participants Map size:', size);
                if (size > 0) {
                    participants = Array.from(this.room.participants.values());
                    // Filter out local participant
                    participants = participants.filter(p => p.identity !== this.localParticipant?.identity);
                }
            }
        }
        
        // Update knownParticipants with current room state
        this.knownParticipants = participants;
        
        console.log('[LIVEKIT] Found remote participants:', participants.length);
        participants.forEach(p => {
            console.log('[LIVEKIT]   - identity:', p.identity, 'name:', p.name, 'isSpeaking:', p.isSpeaking);
        });
        
        return participants;
    }
    
    /**
     * Get local participant info
     */
    getLocalParticipant() {
        if (!this.localParticipant) return null;
        
        return {
            identity: this.localParticipant.identity,
            name: this.localParticipant.name || this.localParticipant.identity,
            isSpeaking: this.localParticipant.isSpeaking,
            audioTracks: this.localParticipant.audioPublications
        };
}
    
    /**
     * Set muted state (mute/unmute microphone)
     * We use the gain node to actually mute - simpler than trying to use setMicrophoneEnabled with our custom pipeline
     */
    async setMuted(muted) {
        console.log('=== SET MUTE:', muted, '===');
        
        if (this.inputGainNode) {
            if (muted) {
                // Save current volume before muting
                this.previousVolume = this.inputGainNode.gain.value;
                // Set gain to 0 (silence)
                this.inputGainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
                console.log('[MUTE] Muted - saved volume:', this.previousVolume, 'now 0');
            } else {
                // Restore previous volume
                const restoreVolume = this.previousVolume !== undefined ? this.previousVolume : 1;
                this.inputGainNode.gain.setValueAtTime(restoreVolume, this.audioContext.currentTime);
                console.log('[MUTE] Unmuted - restored volume:', restoreVolume);
            }
        } else {
            // Fallback to setMicrophoneEnabled if no gain node
            console.log('[MUTE] No gain node, using setMicrophoneEnabled');
            if (this.localParticipant) {
                await this.localParticipant.setMicrophoneEnabled(!muted);
            }
        }
    }
    
    /**
     * Set deafened state (mute/unmute speakers)
     * Note: In LiveKit, deafening is handled by muting all audio elements in the DOM
     */
    setDeafened(deafened) {
        console.log('Setting deafen state:', deafened);
        
        // Mute/unmute all audio elements in the page
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(audio => {
            audio.muted = deafened;
            console.log('Audio element muted:', deafened);
        });
        
        // Also handle via room if available
        if (!this.room) return;
        
        try {
            // Use remoteParticipants instead of participants
            if (this.room.remoteParticipants) {
                this.room.remoteParticipants.forEach(p => {
                    if (p.audioPublications) {
                        p.audioPublications.forEach(pub => {
                            if (pub.track) {
                                pub.setSubscribed(!deafened);
                            }
                        });
                    }
                });
            }
        } catch (e) {
            console.warn('Could not set deafen:', e);
        }
    }
    
    /**
     * Get participant info with display name
     */
    getParticipantInfo(participant) {
        if (!participant) return null;
        
        const identity = participant.identity || 'Unknown';
        const name = participant.name || identity;
        
        return {
            identity: identity,
            name: name,
            isSpeaking: participant.isSpeaking || false
        };
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

console.log('LiveKit client loaded successfully');