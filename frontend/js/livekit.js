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
        // State flags to prevent race conditions between connect/disconnect
        this._connecting = false;
        this._disconnecting = false;
    }
    
    /**
     * Connect to a LiveKit room (voice channel)
     */
    async connect(url, token) {
        // Prevent concurrent connect attempts
        if (this._connecting) {
            console.log('[LIVEKIT] Connect already in progress - waiting up to 3s for it to finish');
            const waitForConnect = new Promise(resolve => {
                const start = Date.now();
                const iv = setInterval(() => {
                    if (!this._connecting) {
                        clearInterval(iv);
                        resolve(true);
                    } else if (Date.now() - start > 3000) {
                        clearInterval(iv);
                        resolve(false);
                    }
                }, 50);
            });
            const ok = await waitForConnect;
            if (!ok) {
                console.warn('[LIVEKIT] Previous connect did not finish in time - aborting new connect');
                throw new Error('Connect already in progress');
            }
        }

        this._connecting = true;
        try {
            // FIRST: Always ensure clean disconnect from ANY previous room
            // This prevents the "Client initiated disconnect" error on reconnect
            console.log('[LIVEKIT] PRE-CONNECT CLEANUP: room exists?', !!this.room);
            if (this.room) {
                console.log('[LIVEKIT] PRE-CONNECT: Previous room state:', this.room.state);
                // If the previous room is still connecting/connected, wait for a graceful disconnect
                if (this.room.state && this.room.state !== 'disconnected') {
                    console.log('[LIVEKIT] PRE-CONNECT: waiting for previous room to disconnect gracefully');
                    try {
                        this._disconnecting = true;
                        await Promise.race([
                            this.room.disconnect(),
                            new Promise(resolve => setTimeout(resolve, 1500))
                        ]);
                        console.log('[LIVEKIT] PRE-CONNECT: Graceful disconnect completed');
                    } catch (e) {
                        console.log('[LIVEKIT] PRE-CONNECT: Graceful disconnect failed, force cleaning:', e?.message || e);
                    } finally {
                        this._disconnecting = false;
                    }
                }

                // Clear references to ensure a clean start
                this.room = null;
                this.localParticipant = null;
                this.knownParticipants = [];
                this.audioElements = [];
            }
            
            // Small delay to let resources clear
            await new Promise(resolve => setTimeout(resolve, 100));
            
            console.log('[LIVEKIT] PRE-CONNECT CLEANUP COMPLETE - room is:', this.room);
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
            // CRITICAL: Clean the URL from any whitespace/tabs
            const cleanUrl = url.trim();
            console.log('[LIVEKIT] Raw URL:', url);
            console.log('[LIVEKIT] Cleaned URL:', cleanUrl);
            console.log('[LIVEKIT] URL protocol:', cleanUrl.startsWith('wss://') ? 'WSS (correct)' : cleanUrl.startsWith('https://') ? 'HTTPS (wrong!)' : 'OTHER');
            console.log('[LIVEKIT] Token (first 50 chars):', token.substring(0, 50) + '...');
            console.log('[LIVEKIT] Token length:', token.length);
            console.log('[LIVEKIT] Token is string:', typeof token === 'string');
            
            // Validate URL protocol
            if (!cleanUrl.startsWith('wss://') && !cleanUrl.startsWith('ws://')) {
                console.error('[LIVEKIT] FATAL: URL is not WSS or WS! Got:', cleanUrl);
                throw new Error(`Invalid LiveKit URL protocol. Must be wss:// or ws://, got: ${cleanUrl}`);
            }

            console.log('[LIVEKIT] URL validation passed, connecting...');
            try {
                await this.room.connect(cleanUrl, token);
            } catch (connErr) {
                console.error('[LIVEKIT] room.connect failed:', connErr);
                // Do not auto-disconnect here; just rethrow so caller can decide
                throw connErr;
            }
            
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
        } finally {
            this._connecting = false;
        }
    }
    
    /**
     * Publish local microphone to the room
     * Using browser's native echo cancellation + Chrome's experimental noise suppression
     */
    async publishMicrophone() {
        console.log('=== PUBLISH MICROPHONE ===');
        console.log('[AUDIO] Step 1: Check room and localParticipant');
        
        if (!this.room || !this.localParticipant) {
            console.warn('No room connected, cannot publish microphone');
            console.warn('[AUDIO] this.room:', !!this.room, 'this.localParticipant:', !!this.localParticipant);
            return;
        }
        
        try {
            // CRITICAL: Wait for room to be FULLY ready before publishing
            // LiveKit needs time for the engine to initialize after connection
            console.log('[AUDIO] Step 2: Waiting for room engine to be ready...');
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log('[AUDIO] Step 3: Room engine ready, room.state:', this.room.state);
            
            // Get settings from localStorage
            const inputDevice = localStorage.getItem('voice_chat_input_device');
            const inputVolume = parseInt(localStorage.getItem('voice_chat_input_volume') || '30');
            const noiseSuppression = localStorage.getItem('voice_chat_noise_suppression') === 'true';
            const echoCancellation = localStorage.getItem('voice_chat_echo_cancellation') !== 'false';
            
            console.log('[AUDIO] Step 4: Settings loaded - Volume:', inputVolume, 'NS:', noiseSuppression, 'EC:', echoCancellation);
            
            // Use Chrome's EXPERIMENTAL noise suppression settings
            const constraints = {
                audio: {
                    echoCancellation: echoCancellation,
                    noiseSuppression: noiseSuppression,
                    autoGainControl: true,
                    sampleRate: 48000,
                    // Chrome experimental - more aggressive
                    googEchoCancellation: true,
                    googNoiseSuppression: true,
                    googAutoGainControl: true,
                    googHighpassFilter: true,
                    googTypingNoiseDetectionThreshold: 0.5,
                }
            };
            
            if (inputDevice) {
                constraints.audio.deviceId = { exact: inputDevice };
            }
            
            console.log('[AUDIO] Step 5: About to call getUserMedia with constraints:', JSON.stringify(constraints));
            console.log('[AUDIO] navigator.mediaDevices:', !!navigator.mediaDevices);
            console.log('[AUDIO] navigator.mediaDevices.getUserMedia:', !!navigator.mediaDevices?.getUserMedia);
            
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log('[AUDIO] Step 6: SUCCESS! Got microphone stream:', stream);
            } catch (gumError) {
                console.error('[AUDIO] Step 6: ERROR - getUserMedia failed:', gumError.name, gumError.message);
                throw gumError;
            }
            
            console.log('[AUDIO] Step 7: Creating AudioContext');
            // Apply volume reduction
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(stream);
            
            this.inputGainNode = this.audioContext.createGain();
            this.inputGainNode.gain.value = (inputVolume / 100) * 0.15;
            
            const dest = this.audioContext.createMediaStreamDestination();
            
            source.connect(this.inputGainNode);
            this.inputGainNode.connect(dest);
            
            const processedTrack = dest.stream.getAudioTracks()[0];
            console.log('[AUDIO] Step 8: Processed track ready:', !!processedTrack);
            console.log('[AUDIO] Step 9: About to publish track, localParticipant:', !!this.localParticipant);
            
            // Try to publish with timeout handling
            try {
                console.log('[AUDIO] Step 10: First publish attempt...');
                await this.localParticipant.publishTrack(processedTrack, {
                    simulcast: false,
                });
                console.log('[AUDIO] Step 11: SUCCESS - Track published!');
            } catch (publishError) {
                // If first attempt fails, wait a bit and retry
                console.warn('[AUDIO] Step 11: First publish attempt failed, retrying...', publishError.message);
                console.warn('[AUDIO] Error details:', publishError);
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('[AUDIO] Step 12: Retry publish attempt...');
                await this.localParticipant.publishTrack(processedTrack, {
                    simulcast: false,
                });
                console.log('[AUDIO] Step 13: SUCCESS - Track published on retry!');
            }
            
            console.log('[AUDIO] Mic published with Chrome experimental NS!');
            console.log('=== MICROPHONE READY ===');
        } catch (error) {
            console.error('ERROR publishing microphone:', error);
            console.error('[AUDIO] Error name:', error.name);
            console.error('[AUDIO] Error message:', error.message);
            console.error('[AUDIO] Error stack:', error.stack);
            alert('Error al acceder al micrófono: ' + error.message);
        }
    }
    
    /**
     * Update input volume dynamically
     */
    setInputVolume(volume) {
        console.log('[AUDIO] setInputVolume called with:', volume);
        
        if (this.inputGainNode && this.audioContext) {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            this.inputGainNode.gain.value = volume / 100;
            console.log('[AUDIO] Volume set to:', volume + '%');
        } else {
            console.log('[AUDIO] Volume will apply on next join');
        }
    }
    
    /**
     * Set muted state (mute/unmute microphone)
     * Using the gain node for instant mute
     */
    async setMuted(muted) {
        console.log('[MUTE] Setting mute to:', muted);
        
        if (this.inputGainNode) {
            this.inputGainNode.gain.value = muted ? 0 : 0.5;
            console.log('[MUTE] Muted:', muted);
        } else {
            // Fallback to setMicrophoneEnabled
            if (this.localParticipant) {
                await this.localParticipant.setMicrophoneEnabled(!muted);
            }
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
    async disconnect() {
        if (this._disconnecting) {
            console.log('[LIVEKIT] Disconnect already in progress, skipping duplicate call');
            return;
        }

        if (!this.room) {
            console.log('[LIVEKIT] No room to disconnect');
            return;
        }

        this._disconnecting = true;
        try {
            console.log('[LIVEKIT] Disconnecting... (caller stack)');
            console.log(new Error().stack.split('\n').slice(1,4).join('\n'));
            await this.room.disconnect();
            console.log('Disconnected from LiveKit room');
        } catch (e) {
            console.warn('[LIVEKIT] Error during disconnect:', e);
        } finally {
            // Clear local references only after attempt
            this.room = null;
            this.localParticipant = null;
            this.knownParticipants = []; // Clear known participants
            this.audioElements = []; // Clear audio elements
            this._disconnecting = false;
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
     * Using LiveKit's setMicrophoneEnabled
     */
    async setMuted(muted) {
        console.log('[MUTE] Setting mute to:', muted);
        
        if (this.localParticipant) {
            try {
                await this.localParticipant.setMicrophoneEnabled(!muted);
                console.log('[MUTE] Microphone', muted ? 'muted' : 'unmuted');
            } catch (e) {
                console.error('[MUTE] Error:', e);
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
