/**
 * LiveKit client for voice chat.
 * Handles room connections, microphone publishing, participant tracking, and screen sharing.
 * VERSION 12.1 - SCREEN SHARE QUALITY: 3Mbps bitrate, manual track publishing, no simulcast
 */

// DEBUG: Make sure this is the latest version
console.log('=== LIVEKIT CLIENT v12 LOADED ===');

class LiveKitClient {
    constructor() {
        this.room = null;
        this.localParticipant = null;
        this.knownParticipants = []; // Track known participants manually
        this.audioElements = []; // Store all audio elements for control
        this._isMuted = false;
        this._pendingVolume = null;
        this._krispProcessor = null; // Krisp noise filter processor
        this._krispSupported = null; // null = unknown, true/false after check
        // State flags to prevent race conditions between connect/disconnect
        this._connecting = false;
        this._disconnecting = false;
        // Screen share state
        this._isScreenSharing = false;
        this._screenShareParticipant = null; // identity of who is sharing
        this._screenVideoElements = []; // Store screen share video elements
        // Mic volume
        this._micGainNode = null;
        this._micAudioContext = null;
        this._micVolume = 100;
        // Auto-gain (dynamic compressor for quiet mics)
        this._autoGainEnabled = false;
        this._autoGainProcessor = null;
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
            
            const { Room, RoomEvent, Track } = livekit;
            this._Track = Track; // Store Track class for later use (e.g. source tagging)
            this._RoomEvent = RoomEvent; // Store for Krisp setup
            console.log('Room class:', Room);
            
            this.room = new Room({
                adaptiveStream: false,     // DISABLED — always receive max quality for screen share
                dynacast: true,
                autoSubscribe: true,
                // Audio capture defaults — high quality with noise/echo suppression
                audioCaptureDefaults: {
                    noiseSuppression: true,
                    echoCancellation: true,
                    autoGainControl: true,
                    channelCount: 1,       // Mono for voice (saves bandwidth, better processing)
                    sampleRate: 48000,     // 48kHz — Opus native sample rate
                },
                // Publish defaults — high bitrate Opus for crystal clear voice
                publishDefaults: {
                    audioPreset: {
                        maxBitrate: 64_000, // 64kbps Opus (default is ~32kbps, Discord uses ~64kbps)
                    },
                    dtx: true,             // Discontinuous transmission — saves bandwidth when silent
                    red: true,             // Redundant encoding — better packet loss recovery
                    // Screen share encoding — 3 Mbps for crisp text/UI
                    screenShareEncoding: {
                        maxBitrate: 3_000_000,
                        maxFramerate: 30,
                    },
                    screenShareSimulcastLayers: [], // No simulcast — single high quality stream
                },
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
                    console.log('[LIVEKIT] 🎵 Track subscribed from:', participant.identity, participant.name, 'kind:', track.kind, 'source:', track.source);
                    
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
                            // Prefer placing audio elements inside a dedicated container so the DOM is tidy
                            let container = document.getElementById('voice-container');
                            if (!container) {
                                // Create a hidden, non-interactive container as a fallback
                                container = document.createElement('div');
                                container.id = 'voice-container';
                                // Keep it out of layout and user interaction; developers can style as needed
                                container.style.position = 'fixed';
                                container.style.width = '1px';
                                container.style.height = '1px';
                                container.style.overflow = 'hidden';
                                container.style.pointerEvents = 'none';
                                container.style.bottom = '0';
                                container.style.right = '0';
                                document.body.appendChild(container);
                                console.log('[LIVEKIT] Created fallback #voice-container');
                            }

                            // Ensure sensible playback attributes
                            audioElement.autoplay = true;
                            audioElement.playsInline = true;
                            audioElement.muted = false;
                            audioElement.volume = 1.0;
                            // Tag with user identity and track type for volume control
                            audioElement.dataset.userId = participant.identity;
                            // Tag as screen share audio if it's from screen share
                            if (track.source === 'screen_share_audio' || track.source === 'ScreenShareAudio') {
                                audioElement.dataset.isScreenShareAudio = 'true';
                            } else {
                                audioElement.dataset.isScreenShareAudio = 'false';
                            }

                            container.appendChild(audioElement);

                            // Apply saved per-user volume if exists
                            const savedVol = localStorage.getItem(`voice_chat_user_vol_${participant.identity}`);
                            if (savedVol) {
                                audioElement.volume = parseInt(savedVol) / 100;
                                console.log('[LIVEKIT] Applied saved volume for', participant.identity, ':', savedVol + '%');
                            }

                            // Store reference to control later
                            this.audioElements.push({
                                element: audioElement,
                                participantId: participant.identity,
                                track: track
                            });

                            console.log('[LIVEKIT] Audio attached into #voice-container, total:', this.audioElements.length);
                        } catch(e) {
                            console.log('[LIVEKIT] Error attaching audio:', e);
                        }
                    }
                    
                    // If it's a video track (screen share), notify the UI
                    if (track.kind === 'video') {
                        console.log('[LIVEKIT] 🖥️ Video track received from:', participant.name || participant.identity, 'source:', track.source);
                        
                        this._screenShareParticipant = participant.identity;
                        
                        // Notify UI about screen share started
                        if (window.livekitCallbacks && window.livekitCallbacks.onScreenShareStarted) {
                            window.livekitCallbacks.onScreenShareStarted(track, publication, participant);
                        }
                    }
                    
                    if (window.livekitCallbacks && window.livekitCallbacks.onTrackSubscribed) {
                        window.livekitCallbacks.onTrackSubscribed(track, publication, participant);
                    }
                })
                // Listen for track unsubscriptions
                .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
                    console.log('[LIVEKIT] Track unsubscribed from:', participant.identity, participant.name, 'kind:', track.kind);
                    
                    // If it's a video track (screen share ended), notify the UI
                    if (track.kind === 'video') {
                        console.log('[LIVEKIT] 🖥️ Screen share track ended from:', participant.name || participant.identity);
                        if (this._screenShareParticipant === participant.identity) {
                            this._screenShareParticipant = null;
                        }
                        
                        // Notify UI about screen share stopped
                        if (window.livekitCallbacks && window.livekitCallbacks.onScreenShareStopped) {
                            window.livekitCallbacks.onScreenShareStopped(track, participant);
                        }
                    }
                    
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
                })
                // DEBUG: Listen for TrackMuted/TrackUnmuted to verify SFU receives mute signal
                .on(RoomEvent.TrackMuted, (publication, participant) => {
                    console.log('[MUTE-EVENT] 🔇 TrackMuted event! participant:', participant.identity, 'source:', publication.source, 'trackSid:', publication.trackSid);
                })
                .on(RoomEvent.TrackUnmuted, (publication, participant) => {
                    console.log('[MUTE-EVENT] 🔊 TrackUnmuted event! participant:', participant.identity, 'source:', publication.source, 'trackSid:', publication.trackSid);
                })
                .on(RoomEvent.LocalTrackPublished, (publication, participant) => {
                    console.log('[TRACK-EVENT] 📤 LocalTrackPublished! source:', publication.source, 'trackSid:', publication.trackSid, 'kind:', publication.kind);
                    // Apply Krisp noise filter to microphone tracks
                    if (publication.source === Track.Source.Microphone) {
                        this._applyKrisp(publication);
                    }
                    // Detect local screen share published
                    if (publication.source === Track.Source.ScreenShare) {
                        console.log('[TRACK-EVENT] 🖥️ Local screen share published!');
                        this._isScreenSharing = true;
                        this._screenShareParticipant = this.localParticipant?.identity;
                        if (window.livekitCallbacks && window.livekitCallbacks.onLocalScreenShareStarted) {
                            window.livekitCallbacks.onLocalScreenShareStarted();
                        }
                    }
                })
                .on(RoomEvent.LocalTrackUnpublished, (publication, participant) => {
                    console.log('[TRACK-EVENT] 📥 LocalTrackUnpublished! source:', publication.source, 'trackSid:', publication.trackSid);
                    // Detect local screen share stopped
                    if (publication.source === Track.Source.ScreenShare || publication.source === Track.Source.ScreenShareAudio) {
                        console.log('[TRACK-EVENT] 🖥️ Local screen share unpublished!');
                        this._isScreenSharing = false;
                        if (this._screenShareParticipant === this.localParticipant?.identity) {
                            this._screenShareParticipant = null;
                        }
                        if (window.livekitCallbacks && window.livekitCallbacks.onLocalScreenShareStopped) {
                            window.livekitCallbacks.onLocalScreenShareStopped();
                        }
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
     * Uses LiveKit's NATIVE setMicrophoneEnabled — creates a proper LocalAudioTrack
     * that the SFU can control (mute/unmute/subscribe/unsubscribe)
     */
    async publishMicrophone() {
        console.log('=== PUBLISH MICROPHONE (NATIVE) ===');
        
        if (!this.room || this.room.state !== 'connected') {
            console.warn('[AUDIO] Room not connected, cannot publish');
            return;
        }
        
        if (!this.localParticipant) {
            this.localParticipant = this.room.localParticipant;
            if (!this.localParticipant) {
                console.error('[AUDIO] No localParticipant available');
                return;
            }
        }
        
        try {
            // Wait for room engine to be fully ready
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Get user settings — noise suppression and echo cancellation ON by default
            const inputDevice = localStorage.getItem('voice_chat_input_device');
            const noiseSuppression = localStorage.getItem('voice_chat_noise_suppression') !== 'false'; // ON by default
            const echoCancellation = localStorage.getItem('voice_chat_echo_cancellation') !== 'false'; // ON by default
            
            console.log('[AUDIO] Publishing mic natively. Device:', inputDevice, 'NS:', noiseSuppression, 'EC:', echoCancellation);
            
            // Build audio capture options — optimized for voice
            const opts = {
                echoCancellation: echoCancellation,
                noiseSuppression: noiseSuppression,
                autoGainControl: false,      // OFF by default — user controls volume manually via slider
                channelCount: 1,
                sampleRate: 48000,
            };
            
            if (inputDevice) {
                opts.deviceId = inputDevice;
            }
            
            // USE LIVEKIT'S NATIVE API — this creates a proper LocalAudioTrack
            // that the SFU knows how to mute/unmute correctly
            await this.localParticipant.setMicrophoneEnabled(true, opts);
            
            console.log('[AUDIO] Microphone published via native LiveKit API!');
            console.log('[AUDIO] audioTrackPublications:', this.localParticipant.audioTrackPublications?.size);
            
            console.log('=== MICROPHONE READY (NATIVE) ===');
        } catch (error) {
            console.error('[AUDIO] Error publishing microphone:', error);
            console.error('[AUDIO] Error name:', error.name);
            console.error('[AUDIO] Error message:', error.message);
            alert('Error al acceder al micrófono: ' + error.message);
        }
    }
    
    /**
     * Enable or disable auto-gain (dynamic compressor) for the microphone.
     * Uses Web Audio DynamicsCompressorNode to boost quiet voices and limit loud ones.
     */
    async setAutoGain(enabled) {
        this._autoGainEnabled = enabled;
        console.log('[AUTO-GAIN] Changed to:', enabled);
        
        if (!this.localParticipant) {
            console.warn('[AUTO-GAIN] No local participant yet');
            return;
        }
        
        const pub = this.localParticipant.getTrackPublication(this._Track?.Source?.Microphone);
        if (!pub || !pub.audioTrack) {
            console.warn('[AUTO-GAIN] No microphone track published yet');
            return;
        }
        
        try {
            if (enabled) {
                // Manual approach: create or update gain chain with higher boost
                console.log('[AUTO-GAIN] Creating gain chain with 3x boost...');
                
                // Get existing or create new audio context
                if (!this._micAudioContext) {
                    this._micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                
                // If gain node already exists, just increase the gain
                if (this._micGainNode) {
                    this._micGainNode.gain.value = 20.0; // 20x boost - very aggressive!
                    console.log('[AUTO-GAIN] ✅ Increased existing gain to 20x');
                } else {
                    // Create new gain chain
                    const originalTrack = pub.track.mediaStreamTrack;
                    
                    this._micGainNode = this._micAudioContext.createGain();
                    this._micGainNode.gain.value = 20.0; // 20x boost!
                    
                    const source = this._micAudioContext.createMediaStreamSource(new MediaStream([originalTrack]));
                    source.connect(this._micGainNode);
                    
                    const dest = this._micAudioContext.createMediaStreamDestination();
                    this._micGainNode.connect(dest);
                    
                    // Publish processed track
                    const livekit = await import('https://cdn.jsdelivr.net/npm/livekit-client@2/+esm');
                    const processedTrack = new livekit.LocalAudioTrack(dest.stream.getAudioTracks()[0], {
                        source: this._Track.Source.Microphone,
                    });
                    
                    await this.localParticipant.unpublishTrack(pub.track);
                    await this.localParticipant.publishTrack(processedTrack);
                    
                    console.log('[AUTO-GAIN] ✅ Created new gain chain with 3x boost');
                }
            } else {
                // Reset to normal (no boost)
                if (this._micGainNode) {
                    this._micGainNode.gain.value = 1.0;
                    console.log('[AUTO-GAIN] Reset gain to 1x');
                }
            }
        } catch (e) {
            console.error('[AUTO-GAIN] Failed:', e.message);
        }
    }
    
    /**
     * Set microphone volume using Web Audio API GainNode.
     * For volume=0: simply mutes the track (no gain chain needed).
     * For volume>0: creates a gain chain on first call, then adjusts gain.
     * @param {number} volume - 0 to 100
     */
    async setMicVolume(volume) {
        console.log('[VOLUME] setMicVolume called:', volume);
        
        // Special case: volume 0 = mute the track directly
        if (volume === 0) {
            if (this._micGainNode) {
                this._micGainNode.gain.value = 0;
            } else {
                // No gain chain yet — mute the track directly
                const pub = this.localParticipant?.getTrackPublication(this._Track?.Source?.Microphone);
                if (pub && pub.track && pub.track.mediaStreamTrack) {
                    pub.track.mediaStreamTrack.enabled = false;
                    console.log('[VOLUME] Track muted directly (no gain chain)');
                }
            }
            this._micVolume = 0;
            return;
        }
        
        const gain = volume / 100;
        
        // If gain chain already exists, just update the value
        if (this._micGainNode) {
            this._micGainNode.gain.value = gain;
            this._micVolume = volume;
            console.log('[VOLUME] Gain updated to:', gain);
            return;
        }
        
        // First time with volume > 0: set up the Web Audio gain chain
        try {
            const pub = this.localParticipant.getTrackPublication(this._Track?.Source?.Microphone);
            if (!pub || !pub.track) {
                console.warn('[VOLUME] No microphone track published yet');
                return;
            }
            
            const originalTrack = pub.track.mediaStreamTrack;
            
            // Create audio context and gain node
            this._micAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            this._micGainNode = this._micAudioContext.createGain();
            this._micGainNode.gain.value = gain;
            
            // Route original track through gain node
            const source = this._micAudioContext.createMediaStreamSource(new MediaStream([originalTrack]));
            source.connect(this._micGainNode);
            
            const dest = this._micAudioContext.createMediaStreamDestination();
            this._micGainNode.connect(dest);
            
            // Create new LiveKit track from processed stream
            const livekit = await import('https://cdn.jsdelivr.net/npm/livekit-client@2/+esm');
            const processedTrack = new livekit.LocalAudioTrack(dest.stream.getAudioTracks()[0], {
                source: this._Track.Source.Microphone,
            });
            
            // Replace: unpublish old, publish new
            console.log('[VOLUME] Unpublishing original track...');
            await this.localParticipant.unpublishTrack(pub.track);
            console.log('[VOLUME] Publishing processed track...');
            const newPub = await this.localParticipant.publishTrack(processedTrack, {
                source: this._Track.Source.Microphone,
            });
            console.log('[VOLUME] ✅ Gain chain created, volume:', volume + '%');
            
            // Re-apply Krisp to the new track (the gain node replaced the original track that had Krisp)
            if (this._krispSupported !== false && newPub && newPub.track && newPub.track.setProcessor) {
                console.log('[VOLUME] Re-applying Krisp to new track...');
                try {
                    const krispModule = await import('https://cdn.jsdelivr.net/npm/@livekit/krisp-noise-filter@0.2/+esm');
                    if (krispModule.isKrispNoiseFilterSupported && krispModule.isKrispNoiseFilterSupported()) {
                        this._krispProcessor = krispModule.KrispNoiseFilter();
                        await newPub.track.setProcessor(this._krispProcessor);
                        await this._krispProcessor.setEnabled(true);
                        this._krispSupported = true;
                        console.log('[VOLUME] ✅ Krisp re-applied to gain-processed track');
                    }
                } catch (e) {
                    console.warn('[VOLUME] Could not re-apply Krisp:', e.message);
                }
            }
            
            this._micVolume = volume;
        } catch (e) {
            console.error('[VOLUME] Failed to set up mic gain:', e);
            // Fallback: just mute if volume is very low
            if (volume < 10) {
                const pub = this.localParticipant?.getTrackPublication(this._Track?.Source?.Microphone);
                if (pub && pub.track && pub.track.mediaStreamTrack) {
                    pub.track.mediaStreamTrack.enabled = false;
                    console.log('[VOLUME] Fallback: track muted due to error');
                }
            }
        }
    }
    
    /**
     * Get current mic volume
     */
    getMicVolume() {
        return this._micVolume ?? 100;
    }
    
    /**
     * Update input volume dynamically (legacy — stores preference only)
     */
    setInputVolume(volume) {
        console.log('[AUDIO] setInputVolume called with:', volume);
        this._pendingVolume = volume;
        
        if (this._isMuted) {
            console.log('[AUDIO] Muted — saved volume for later:', volume + '%');
            return;
        }
        
        console.log('[AUDIO] Volume preference saved:', volume + '%');
    }
    
    /**
     * Set muted state (mute/unmute microphone)
     * VERSION 10 — Clean mute using setMicrophoneEnabled
     * The double-fire bug was caused by onclick + addEventListener on the same button
     */
    async setMuted(muted) {
        console.log('[MUTE] ===== SETMUTED v10 CALLED =====', muted);
        this._isMuted = muted;
        
        if (!this.localParticipant) {
            console.error('[MUTE] No localParticipant!');
            return;
        }
        
        // DIAGNOSTIC: Show state BEFORE
        console.log('[MUTE] audioTrackPublications size:', this.localParticipant.audioTrackPublications?.size);
        if (this.localParticipant.audioTrackPublications) {
            this.localParticipant.audioTrackPublications.forEach((pub, sid) => {
                console.log('[MUTE]   BEFORE pub:', sid, 'isMuted:', pub.isMuted, 'track.enabled:', pub.track?.mediaStreamTrack?.enabled, 'readyState:', pub.track?.mediaStreamTrack?.readyState);
            });
        }
        
        try {
            if (muted) {
                console.log('[MUTE] Calling setMicrophoneEnabled(false)...');
                await this.localParticipant.setMicrophoneEnabled(false);
                console.log('[MUTE] setMicrophoneEnabled(false) SUCCESS');
            } else {
                // Re-enable with user's preferred audio settings
                const inputDevice = localStorage.getItem('voice_chat_input_device');
                const noiseSuppression = localStorage.getItem('voice_chat_noise_suppression') !== 'false'; // ON by default
                const echoCancellation = localStorage.getItem('voice_chat_echo_cancellation') !== 'false'; // ON by default
                
                const opts = {
                    echoCancellation: echoCancellation,
                    noiseSuppression: noiseSuppression,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 48000,
                };
                if (inputDevice) opts.deviceId = inputDevice;
                
                console.log('[MUTE] Calling setMicrophoneEnabled(true)...');
                await this.localParticipant.setMicrophoneEnabled(true, opts);
                console.log('[MUTE] setMicrophoneEnabled(true) SUCCESS');
            }
        } catch (e) {
            console.error('[MUTE] setMicrophoneEnabled FAILED:', e);
        }
        
        // DIAGNOSTIC: Show state AFTER
        if (this.localParticipant.audioTrackPublications) {
            this.localParticipant.audioTrackPublications.forEach((pub, sid) => {
                console.log('[MUTE]   AFTER pub:', sid, 'isMuted:', pub.isMuted, 'track.enabled:', pub.track?.mediaStreamTrack?.enabled, 'readyState:', pub.track?.mediaStreamTrack?.readyState);
            });
        }
        
        console.log('[MUTE] COMPLETE, isMuted:', muted);
    }
    
    /**
     * Get microphone audio track (deprecated — mic now managed by LiveKit natively)
     */
    async getMicrophoneAudio() {
        console.log('[AUDIO] getMicrophoneAudio — mic is managed natively by LiveKit');
        return null;
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
            this._isScreenSharing = false; // Clear screen share state
            this._screenShareParticipant = null;
            this._screenVideoElements = [];
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
        // Reduced logging — only log on changes
        
        // Always try to get from room first (more accurate)
        if (!this.room) {
            return this.knownParticipants;
        }
        
        // Get remote participants from room
        let participants = [];
        
        // Try room.remoteParticipants (Map)
        if (this.room.remoteParticipants) {
            if (this.room.remoteParticipants instanceof Map) {
                const size = this.room.remoteParticipants.size;
                if (size > 0) {
                    participants = Array.from(this.room.remoteParticipants.values());
                }
            } else if (typeof this.room.remoteParticipants === 'object') {
                participants = Object.values(this.room.remoteParticipants);
            }
        }
        
        // Try room.participants (Map with all participants)
        if (participants.length === 0 && this.room.participants) {
            if (this.room.participants instanceof Map) {
                const size = this.room.participants.size;
                if (size > 0) {
                    participants = Array.from(this.room.participants.values());
                    // Filter out local participant
                    participants = participants.filter(p => p.identity !== this.localParticipant?.identity);
                }
            }
        }
        
        // Update knownParticipants with current room state
        this.knownParticipants = participants;
        
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
     * Set volume for a specific user (per-user volume control).
     * Uses LiveKit's internal setVolume API with a very aggressive exponential curve.
     * @param {string} userId - The participant identity (user_id)
     * @param {number} volume - 0 to 300
     */
    setUserVolume(userId, volume) {
        const safeVolume = Math.min(300, Math.max(0, volume));
        
        // Aggressive exponential curve (Power of 3)
        // 100% -> 1x
        // 200% -> 8x
        // 300% -> 27x
        let gain;
        if (safeVolume <= 100) {
            gain = safeVolume / 100;
        } else {
            gain = Math.pow(safeVolume / 100, 3);
        }
        
        // Save preference
        localStorage.setItem(`voice_chat_user_vol_${userId}`, safeVolume);
        
        if (!this.room) return;
        
        const targetId = String(userId);
        let updated = 0;
        
        this.room.remoteParticipants.forEach((participant) => {
            if (String(participant.identity) === targetId) {
                participant.trackPublications.forEach((pub) => {
                    if (pub.kind === 'audio' && pub.source === 'microphone') {
                        if (pub.setVolume) {
                            pub.setVolume(gain);
                            updated++;
                            console.log(`[VOL-USER] Set track volume for ${targetId} to ${safeVolume}% (gain: ${gain.toFixed(2)}x)`);
                        }
                    }
                });
            }
        });
        
        // Fallback: DOM volume
        this.audioElements.forEach(audio => {
            if (String(audio.participantId) === targetId) {
                // If gain is 0, force mute to ensure absolute silence
                if (gain === 0) {
                    audio.element.muted = true;
                    audio.element.volume = 0;
                } else {
                    audio.element.muted = false;
                    audio.element.volume = Math.min(1, gain);
                }
            }
        });
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
    
    /**
     * Start screen sharing with system audio.
     * Uses LiveKit's native setScreenShareEnabled — captures screen + system audio.
     * System audio only works on Chromium browsers (Chrome, Edge, Tauri WebView2).
     */
    async startScreenShare() {
        console.log('[SCREEN] ===== START SCREEN SHARE =====');
        
        if (!this.room || this.room.state !== 'connected') {
            console.warn('[SCREEN] Room not connected, cannot share screen');
            return false;
        }
        
        if (this._isScreenSharing) {
            console.warn('[SCREEN] Already sharing screen');
            return false;
        }
        
        try {
            // Import LiveKit for Track class
            const livekit = await import('https://cdn.jsdelivr.net/npm/livekit-client@2/+esm');
            const { Track, createLocalScreenTracks, ScreenSharePresets } = livekit;
            
            // Get quality setting from localStorage
            const quality = localStorage.getItem('voice_chat_screen_quality') || '4k';
            console.log('[SCREEN] Using quality:', quality);
            
            // Define quality presets
            let videoConstraints, encodingSettings, audioBitrate;
            
            switch(quality) {
                case '1080p':
                    videoConstraints = {
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 },
                        frameRate: { ideal: 30, max: 30 },
                        displaySurface: 'monitor',
                    };
                    encodingSettings = { maxBitrate: 5_000_000, maxFramerate: 30 };
                    audioBitrate = 128_000;
                    break;
                case '1440p':
                    videoConstraints = {
                        width: { ideal: 2560, max: 2560 },
                        height: { ideal: 1440, max: 1440 },
                        frameRate: { ideal: 60, max: 60 },
                        displaySurface: 'monitor',
                    };
                    encodingSettings = { maxBitrate: 10_000_000, maxFramerate: 60 };
                    audioBitrate = 256_000;
                    break;
                case '4k':
                    videoConstraints = {
                        width: { ideal: 3840, max: 3840 },
                        height: { ideal: 2160, max: 2160 },
                        frameRate: { ideal: 60, max: 60 },
                        displaySurface: 'monitor',
                    };
                    encodingSettings = { maxBitrate: 20_000_000, maxFramerate: 60 };
                    audioBitrate = 512_000;
                    break;
                case 'auto':
                default:
                    // Default high quality
                    videoConstraints = {
                        width: { ideal: 3840, max: 3840 },
                        height: { ideal: 2160, max: 2160 },
                        frameRate: { ideal: 60, max: 60 },
                        displaySurface: 'monitor',
                    };
                    encodingSettings = { maxBitrate: 20_000_000, maxFramerate: 60 };
                    audioBitrate = 512_000;
                    break;
            }
            
            // STEP 1: Get display media with quality constraints
            console.log('[SCREEN] Requesting displayMedia with quality:', quality);
            
            // Check if user wants system audio
            const screenAudioEnabled = localStorage.getItem('voice_chat_screen_audio') !== 'false';
            console.log('[SCREEN] System audio enabled:', screenAudioEnabled);
            
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: videoConstraints,
                audio: screenAudioEnabled, // System audio (Chromium only)
            });
            
            console.log('[SCREEN] Display stream acquired');
            
            // Log the actual resolution we got
            const videoTrack = displayStream.getVideoTracks()[0];
            const settings = videoTrack.getSettings();
            console.log('[SCREEN] Actual capture resolution:', settings.width, 'x', settings.height, '@', settings.frameRate, 'fps');
            console.log('[SCREEN] Content hint:', videoTrack.contentHint);
            
            // Set content hint for screen content — tells the encoder to preserve detail
            videoTrack.contentHint = 'detail';
            
            // STEP 2: Create LocalVideoTrack from the stream
            // ULTRA: Maximum quality settings
            const LocalVideoTrack = livekit.LocalVideoTrack;
            const localScreenTrack = new LocalVideoTrack(videoTrack, {
                source: Track.Source.ScreenShare,
                // Use quality settings
                simulcast: false,
                videoEncoding: encodingSettings,
                scalabilityMode: 'L1T1', // Single layer, max quality
            });
            
            // STEP 3: Publish the video track
            await this.localParticipant.publishTrack(localScreenTrack, {
                source: Track.Source.ScreenShare,
                simulcast: false,
                videoEncoding: encodingSettings,
                scalabilityMode: 'L1T1',
            });
            console.log('[SCREEN] Video track published at', encodingSettings.maxBitrate / 1_000_000, 'Mbps,', encodingSettings.maxFramerate, 'fps');
            
            // STEP 4: Publish audio track if available
            // Use quality settings
            const audioTracks = displayStream.getAudioTracks();
            if (audioTracks.length > 0) {
                const LocalAudioTrack = livekit.LocalAudioTrack;
                const localScreenAudio = new LocalAudioTrack(audioTracks[0], {
                    source: Track.Source.ScreenShareAudio,
                });
                await this.localParticipant.publishTrack(localScreenAudio, {
                    source: Track.Source.ScreenShareAudio,
                    audioBitrate: audioBitrate,
                });
                console.log('[SCREEN] Audio track published at', audioBitrate / 1000, 'kbps');
            }
            
            // Handle when user stops sharing via browser UI
            videoTrack.addEventListener('ended', () => {
                console.log('[SCREEN] User stopped sharing via browser UI');
                this._isScreenSharing = false;
                this._screenShareParticipant = null;
                if (window.livekitCallbacks && window.livekitCallbacks.onLocalScreenShareStopped) {
                    window.livekitCallbacks.onLocalScreenShareStopped();
                }
            });
            
            console.log('[SCREEN] ✅ Screen share started successfully!');
            // State is updated by LocalTrackPublished event handler
            return true;
        } catch (error) {
            console.error('[SCREEN] Failed to start screen share:', error);
            // User cancelled the screen picker dialog — not an error
            if (error.name === 'NotAllowedError' || error.message?.includes('Permission denied')) {
                console.log('[SCREEN] User cancelled screen share picker');
                return false;
            }
            throw error;
        }
    }
    
    /**
     * Stop screen sharing.
     * Unpublishes all screen share tracks (video + audio).
     */
    async stopScreenShare() {
        console.log('[SCREEN] ===== STOP SCREEN SHARE =====');
        
        if (!this.localParticipant) {
            console.warn('[SCREEN] No localParticipant');
            return;
        }
        
        try {
            // Find and unpublish all screen share tracks manually
            const Track = this._Track;
            if (Track && this.localParticipant.trackPublications) {
                for (const [sid, pub] of this.localParticipant.trackPublications) {
                    if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
                        console.log('[SCREEN] Unpublishing track:', sid, 'source:', pub.source);
                        if (pub.track) {
                            await this.localParticipant.unpublishTrack(pub.track);
                            pub.track.stop();
                        }
                    }
                }
            }
            this._isScreenSharing = false;
            console.log('[SCREEN] ✅ Screen share stopped');
        } catch (error) {
            console.error('[SCREEN] Error stopping screen share:', error);
            this._isScreenSharing = false;
        }
    }
    
    /**
     * Check if currently sharing screen
     */
    isScreenSharing() {
        return this._isScreenSharing;
    }
    
    /**
     * Get the identity of who is currently sharing their screen
     * Returns null if nobody is sharing
     */
    getScreenShareParticipant() {
        return this._screenShareParticipant;
    }
    
    /**
     * Apply Krisp AI noise cancellation to a published audio track.
     * Krisp runs locally in the browser — no audio sent to external servers.
     * Falls back gracefully if Krisp is not supported or fails to load.
     */
    async _applyKrisp(publication) {
        try {
            // If we already have a processor, apply it to this new track (e.g. after reconnect/mute/volume change)
            if (this._krispProcessor) {
                console.log('[KRISP] Re-applying existing processor to new track...');
                if (publication.track && publication.track.setProcessor) {
                    await publication.track.setProcessor(this._krispProcessor);
                    await this._krispProcessor.setEnabled(true);
                    console.log('[KRISP] ✅ Re-applied Krisp to new track');
                }
                return;
            }
            
            // Dynamic import of Krisp noise filter
            console.log('[KRISP] Loading Krisp noise filter...');
            const krispModule = await import('https://cdn.jsdelivr.net/npm/@livekit/krisp-noise-filter@0.2/+esm');
            
            // Check browser support
            if (krispModule.isKrispNoiseFilterSupported && !krispModule.isKrispNoiseFilterSupported()) {
                console.warn('[KRISP] Not supported on this browser — using browser-native noise suppression');
                this._krispSupported = false;
                return;
            }
            
            // Create and apply the processor
            this._krispProcessor = krispModule.KrispNoiseFilter();
            
            if (publication.track && publication.track.setProcessor) {
                await publication.track.setProcessor(this._krispProcessor);
                await this._krispProcessor.setEnabled(true);
                this._krispSupported = true;
                console.log('[KRISP] ✅ Krisp AI noise cancellation ACTIVE — teclado, ventilador, ruido ambiente filtrado');
            } else {
                console.warn('[KRISP] Track does not support setProcessor');
                this._krispSupported = false;
            }
        } catch (e) {
            console.warn('[KRISP] Failed to apply Krisp:', e.message);
            console.warn('[KRISP] Falling back to browser-native noise suppression');
            this._krispSupported = false;
            this._krispProcessor = null;
        }
    }
}

// Create singleton instance
const livekitClient = new LiveKitClient();

// Export for use in other scripts
window.livekitClient = livekitClient;

console.log('LiveKit client loaded successfully');
