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
     * With noise gate and volume control using Web Audio API
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
            
            console.log('[AUDIO] Settings - inputVolume:', inputVolume, 'noiseSuppression:', noiseSuppression, 'echoCancellation:', echoCancellation);
            
            // Get microphone with STRONG noise suppression settings
            const constraints = {
                audio: {
                    echoCancellation: echoCancellation,
                    noiseSuppression: true, // Always enable - this is the browser's NS
                    autoGainControl: true,
                    sampleRate: 48000,
                    // Additional constraints for better noise handling
                    latency: 0,
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
            
            // Create Web Audio API pipeline
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(stream);
            
            // Create main gain node for volume control - default to 70% to reduce sensitivity
            this.inputGainNode = this.audioContext.createGain();
            this.inputGainNode.gain.value = (inputVolume || 70) / 100;
            
            // === NOISE GATE - This is the key! ===
            // A noise gate cuts audio when it's below a threshold (silences background noise)
            const noiseGate = this.audioContext.createGain();
            noiseGate.gain.value = 1;
            
            // Create analyzer to detect speech vs noise
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
            
            // Create compressor to reduce sudden loud sounds
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -40;
            compressor.knee.value = 10;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.1;
            
            // High-pass to remove low rumble
            const highPass = this.audioContext.createBiquadFilter();
            highPass.type = 'highpass';
            highPass.frequency.value = 100;
            highPass.Q.value = 0.5;
            
            // Low-pass to smooth
            const lowPass = this.audioContext.createBiquadFilter();
            lowPass.type = 'lowpass';
            lowPass.frequency.value = 5000;
            lowPass.Q.value = 0.5;
            
            // Create destination
            const dest = this.audioContext.createMediaStreamDestination();
            
            // Connect: source -> analyser -> noiseGate -> highPass -> lowPass -> compressor -> gain -> dest
            source.connect(analyser);
            analyser.connect(noiseGate);
            noiseGate.connect(highPass);
            highPass.connect(lowPass);
            lowPass.connect(compressor);
            compressor.connect(this.inputGainNode);
            this.inputGainNode.connect(dest);
            
            // Store nodes
            this.analyser = analyser;
            this.noiseGate = noiseGate;
            
            // === NOISE GATE LOGIC ===
            // Continuously monitor audio levels and gate accordingly
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const noiseGateThreshold = 3; // LOWER - only let LOUD sounds through
            
            const updateNoiseGate = () => {
                if (!this.audioContext || this.audioContext.state !== 'running') return;
                
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                
                // DEBUG: Log audio level
                if (Math.random() < 0.02) {
                    console.log('[GATE] Audio level:', average.toFixed(1), 'threshold:', noiseGateThreshold, 'gain:', this.noiseGate.gain.value.toFixed(2));
                }
                
                if (average < noiseGateThreshold) {
                    // Background noise - gate it COMPLETELY
                    this.noiseGate.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
                } else {
                    // Speech - let it through (require MUCH louder than threshold to activate)
                    this.noiseGate.gain.setTargetAtTime(1, this.audioContext.currentTime, 0.003);
                }
                
                requestAnimationFrame(updateNoiseGate);
            };
            updateNoiseGate();
            console.log('[AUDIO] Noise gate started with threshold:', noiseGateThreshold);
            
            // Create new track from the processed stream
            const processedTrack = dest.stream.getAudioTracks()[0];
            
            // Publish processed track to LiveKit
            await this.localParticipant.publishTrack(processedTrack);
            
            console.log('[AUDIO] Microphone published with noise gate!');
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
        
        if (this.audioContext) {
            console.log('[AUDIO] audioContext state:', this.audioContext.state);
            
            if (this.audioContext.state === 'suspended') {
                console.log('[AUDIO] Resuming audio context...');
                this.audioContext.resume();
            }
        }
        
        if (this.inputGainNode) {
            const gainValue = volume / 100;
            this.inputGainNode.gain.value = gainValue;
            console.log('[AUDIO] Volume set to:', volume, 'gain:', this.inputGainNode.gain.value);
        } else {
            console.log('[AUDIO] inputGainNode not available yet');
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
     * We use the gain node to actually mute
     */
    async setMuted(muted) {
        console.log('[MUTE] Setting mute to:', muted);
        
        if (this.inputGainNode) {
            if (muted) {
                this.previousVolume = this.inputGainNode.gain.value;
                this.inputGainNode.gain.value = 0;
                console.log('[MUTE] Muted - previous:', this.previousVolume);
            } else {
                const restoreVolume = this.previousVolume !== undefined ? this.previousVolume : 0.7;
                this.inputGainNode.gain.value = restoreVolume;
                console.log('[MUTE] Unmuted - restored to:', restoreVolume);
            }
        } else {
            console.log('[MUTE] No gain node');
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